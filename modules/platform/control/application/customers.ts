// Customers: the list, one customer's page, plan changes, status changes (through approval),
// and what the guard asks on every school request.
import { eachTenant, withTenant, type Db, type Tx } from '@campusverse/db';
import { lastActivity } from '@campusverse/platform-audit';
import { sql } from 'drizzle-orm';
import { adminAudit, assertStaffCan, ControlError, inCustomer, type Staff } from './common.js';

/** What control needs from other modules, wired by the API. Counts and codes only. */
export type ControlPorts = {
  /** Active students in the current tenant (people records). */
  students: (tx: Tx) => Promise<number>;
  /** Deliveries since a time, by channel and state (communications). */
  deliveries: (tx: Tx, since: string) => Promise<{ channel: string; state: string; n: number }[]>;
  /** What support may see under a grant: setup state, import results, failures. No names. */
  supportSummary: (tx: Tx) => Promise<Record<string, unknown>>;
  /** Signs up a school with its owner (school setup). Calls registerCustomer itself. */
  provision: (input: NewCustomer) => Promise<{ orgId: string; institutionId: string }>;
};

export type NewCustomer = {
  schoolName: string;
  state: string;
  board: string;
  ownerName: string;
  ownerPhone: string;
};

export type CustomerStatus = 'active' | 'suspended' | 'closed';

/** Called in the signup transaction: every organisation is a customer from its first moment. */
export async function registerCustomer(
  tx: Tx,
  input: { orgId: string; name: string; planCode?: string },
): Promise<void> {
  await tx.execute(sql`
    insert into control.customer (org_id, name, plan_code)
    values (${input.orgId}, ${input.name}, ${input.planCode ?? 'pilot'}) on conflict do nothing`);
}

/** For the API guard: may this organisation's people use the app, and may they write? */
export async function customerAccess(
  db: Db,
  orgId: string,
): Promise<{ status: CustomerStatus; writesOff: boolean }> {
  const [r] = await db.execute<{ status: CustomerStatus | null; writesOff: boolean }>(sql`
    select (select status from control.customer where org_id = ${orgId}) as status,
      exists (select 1 from control.switch where key = 'writes_off'
        and (org_id is null or org_id = ${orgId})) as "writesOff"`);
  // Organisations made before the customer table (seeded test data) count as active.
  return { status: r?.status ?? 'active', writesOff: r?.writesOff ?? false };
}

export type CustomerSummary = {
  orgId: string;
  name: string;
  status: CustomerStatus;
  planCode: string;
  planName: string;
  studentLimit: number | null;
  students: number;
  lastActivity: string | null;
  createdAt: string;
};

/** Newest first, 50 at a time, optionally by name. Counts come from each tenant under RLS. */
export async function listCustomers(
  db: Db,
  staff: Staff,
  ports: ControlPorts,
  q: { search?: string | undefined; status?: CustomerStatus | undefined } = {},
): Promise<CustomerSummary[]> {
  assertStaffCan(staff, 'customers.read');
  const rows = await db.execute<Omit<CustomerSummary, 'students' | 'lastActivity'>>(sql`
    select c.org_id::text as "orgId", c.name, c.status, c.plan_code as "planCode", p.name as "planName",
      p.student_limit as "studentLimit", c.created_at::text as "createdAt"
    from control.customer c join control.plan p on p.code = c.plan_code
    where (${q.search ?? null}::text is null or c.name ilike ${`%${q.search ?? ''}%`})
      and (${q.status ?? null}::text is null or c.status = ${q.status ?? null})
    order by c.created_at desc limit 50`);
  const counts = await eachTenant(
    db,
    rows.map((r) => r.orgId),
    async (tx) => ({ students: await ports.students(tx), lastActivity: await lastActivity(tx) }),
  );
  return rows.map((r, i) => ({ ...r, ...(counts[i] ?? { students: 0, lastActivity: null }) }));
}

export async function loadCustomer(tx: Db | Tx, orgId: string) {
  const [c] = await tx.execute<{ orgId: string; name: string; status: CustomerStatus }>(sql`
    select org_id::text as "orgId", name, status from control.customer where org_id = ${orgId}`);
  if (!c) throw new ControlError('customer_not_found');
  return c;
}

/** Plan changes are immediate and audited on both sides. Over the limit is shown, never blocked. */
export async function setPlan(db: Db, staff: Staff, orgId: string, planCode: string) {
  assertStaffCan(staff, 'customers.plan');
  const c = await loadCustomer(db, orgId);
  await inCustomer(
    db,
    staff,
    orgId,
    { action: 'customer.plan_changed', detail: { planCode } },
    async (tx) => {
      const [p] = await tx.execute(sql`select 1 from control.plan where code = ${planCode}`);
      if (!p) throw new ControlError('plan_not_found');
      await tx.execute(
        sql`update control.customer set plan_code = ${planCode} where org_id = ${c.orgId}`,
      );
    },
  );
}

/** Suspending, closing or reactivating needs a second person: this only asks. */
export async function requestStatusChange(
  db: Db,
  staff: Staff,
  input: { orgId: string; status: CustomerStatus; reason: string },
): Promise<{ approvalId: string }> {
  assertStaffCan(staff, 'customers.status');
  const c = await loadCustomer(db, input.orgId);
  if (c.status === input.status) throw new ControlError('already_in_status');
  return db.transaction(async (tx) => {
    const [a] = await tx.execute<{ id: string }>(sql`
      insert into control.approval (kind, org_id, payload, reason, requested_by)
      values ('customer_status', ${input.orgId}, ${JSON.stringify({ status: input.status })}::jsonb,
        ${input.reason.trim()}, ${staff.staffId}) returning id::text`);
    await adminAudit(tx, staff, {
      action: 'approval.requested',
      orgId: input.orgId,
      reason: input.reason,
      detail: { kind: 'customer_status', status: input.status },
    });
    return { approvalId: a?.id ?? '' };
  });
}

/** Applied inside the approving transaction: the guard's row and the organisation together. */
export async function applyStatus(tx: Tx, orgId: string, status: CustomerStatus) {
  await tx.execute(sql`update control.customer set status = ${status} where org_id = ${orgId}`);
  await tx.execute(sql`update organisation set status = ${status} where id = app_current_org()`);
}

/** Signs up a school (replacing the CLI) and puts it on a plan; audited on both sides. */
export async function createCustomer(
  db: Db,
  staff: Staff,
  ports: ControlPorts,
  input: NewCustomer & { planCode: string },
): Promise<{ orgId: string; institutionId: string }> {
  assertStaffCan(staff, 'customers.create');
  const [p] = await db.execute(sql`select 1 from control.plan where code = ${input.planCode}`);
  if (!p) throw new ControlError('plan_not_found');
  const created = await ports.provision(input);
  await inCustomer(
    db,
    staff,
    created.orgId,
    { action: 'customer.created', detail: { planCode: input.planCode, board: input.board } },
    (tx) =>
      tx.execute(sql`
        update control.customer set plan_code = ${input.planCode} where org_id = ${created.orgId}`),
  );
  return created;
}

export type CustomerDetail = CustomerSummary & {
  flags: { key: string; description: string; on: boolean; override: boolean | null }[];
  switches: { id: string; key: string; global: boolean; reason: string; setAt: string }[];
  pending: { id: string; kind: string; reason: string; requestedBy: string }[];
  grants: { id: string; staff: string; expiresAt: string }[];
  deliveries: { channel: string; state: string; n: number }[];
  audit: { at: string; staff: string | null; action: string; reason: string | null }[];
};

export async function customerDetail(
  db: Db,
  staff: Staff,
  ports: ControlPorts,
  orgId: string,
): Promise<CustomerDetail> {
  assertStaffCan(staff, 'customers.read');
  const [c] = await db.execute<Omit<CustomerSummary, 'students' | 'lastActivity'>>(sql`
    select c.org_id::text as "orgId", c.name, c.status, c.plan_code as "planCode", p.name as "planName",
      p.student_limit as "studentLimit", c.created_at::text as "createdAt"
    from control.customer c join control.plan p on p.code = c.plan_code where c.org_id = ${orgId}`);
  if (!c) throw new ControlError('customer_not_found');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const inside = await withTenant(db, orgId, async (tx) => ({
    students: await ports.students(tx),
    lastActivity: await lastActivity(tx),
    deliveries: await ports.deliveries(tx, since),
  }));
  // Same rule as flagOn: the override, else the default if the plan includes the flag.
  const flags = await db.execute<CustomerDetail['flags'][number]>(sql`
    select f.key, f.description, o.enabled as override,
      coalesce(o.enabled, f.default_on and f.key = any(p.features)) as on
    from control.flag f cross join control.customer c join control.plan p on p.code = c.plan_code
    left join control.flag_override o on o.key = f.key and o.org_id = c.org_id
    where c.org_id = ${orgId} order by f.key`);
  return {
    ...c,
    ...inside,
    flags: [...flags],
    switches: [
      ...(await db.execute<CustomerDetail['switches'][number]>(sql`
        select id::text, key, org_id is null as global, reason, set_at::text as "setAt"
        from control.switch where org_id is null or org_id = ${orgId} order by set_at desc`)),
    ],
    pending: [
      ...(await db.execute<CustomerDetail['pending'][number]>(sql`
        select a.id::text, a.kind, a.reason, s.name as "requestedBy" from control.approval a
        join control.staff s on s.id = a.requested_by
        where a.org_id = ${orgId} and a.state = 'requested' order by a.created_at`)),
    ],
    grants: [
      ...(await db.execute<CustomerDetail['grants'][number]>(sql`
        select g.id::text, s.name as staff, g.expires_at::text as "expiresAt"
        from control.support_grant g join control.staff s on s.id = g.staff_id
        where g.org_id = ${orgId} and g.ended_at is null and g.expires_at > now()`)),
    ],
    audit: [
      ...(await db.execute<CustomerDetail['audit'][number]>(sql`
        select a.at::text, s.name as staff, a.action, a.reason from control.admin_audit a
        left join control.staff s on s.id = a.staff_id
        where a.org_id = ${orgId} order by a.at desc limit 20`)),
    ],
  };
}

/** This customer's monthly Verse AI token budget, from their plan. 0 when not a customer. */
export async function aiMonthlyTokens(db: Db | Tx, orgId: string): Promise<number> {
  const [r] = await db.execute<{ tokens: number }>(sql`
    select p.ai_monthly_tokens as tokens from control.customer c
    join control.plan p on p.code = c.plan_code where c.org_id = ${orgId}`);
  return r?.tokens ?? 0;
}
