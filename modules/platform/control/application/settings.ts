// Plans, feature flags and emergency switches. Immediate and audited; switches are owner-only
// and need a reason. Customer-specific changes are also written into the customer's audit log.
import { eachTenant, type Db, type Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { assertStaffCan, controlStep, ControlError, inCustomer, type Staff } from './common.js';
import { loadCustomer } from './customers.js';

export type Plan = {
  code: string;
  name: string;
  studentLimit: number | null;
  pricePaise: number;
  features: string[];
  customers: number;
};

export async function listPlans(db: Db, staff: Staff): Promise<Plan[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<Plan>(sql`
      select p.code, p.name, p.student_limit as "studentLimit", p.price_paise::int as "pricePaise",
        p.features, (select count(*)::int from control.customer c where c.plan_code = p.code) as customers
      from control.plan p order by p.price_paise, p.code`)),
  ];
}

export async function savePlan(db: Db, staff: Staff, p: Omit<Plan, 'customers'>): Promise<void> {
  await controlStep(
    db,
    staff,
    'plans.manage',
    { action: 'plan.saved', detail: { code: p.code, pricePaise: p.pricePaise } },
    async (tx) => {
      const [unknown] = await tx.execute<{ key: string }>(sql`
        select k as key from unnest(${`{${p.features.join(',')}}`}::text[]) k
        where k not in (select key from control.flag)`);
      if (unknown) throw new ControlError('unknown_flag', { key: unknown.key });
      await tx.execute(sql`
        insert into control.plan (code, name, student_limit, price_paise, features)
        values (${p.code}, ${p.name}, ${p.studentLimit}, ${p.pricePaise}, ${`{${p.features.join(',')}}`}::text[])
        on conflict (code) do update set name = excluded.name, student_limit = excluded.student_limit,
          price_paise = excluded.price_paise, features = excluded.features`);
    },
  );
}

export type FlagRow = {
  key: string;
  description: string;
  defaultOn: boolean;
  overrides: { orgId: string; customer: string; enabled: boolean }[];
};

export async function listFlags(db: Db, staff: Staff): Promise<FlagRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<FlagRow>(sql`
      select f.key, f.description, f.default_on as "defaultOn",
        coalesce((select json_agg(json_build_object('orgId', o.org_id, 'customer', c.name, 'enabled', o.enabled) order by c.name)
          from control.flag_override o join control.customer c on c.org_id = o.org_id where o.key = f.key), '[]') as overrides
      from control.flag f order by f.key`)),
  ];
}

/**
 * Is a feature on for this customer? A customer override wins; otherwise the flag's default,
 * if the customer's plan includes it.
 */
export async function flagOn(db: Db | Tx, key: string, orgId: string): Promise<boolean> {
  const [r] = await db.execute<{ on: boolean | null }>(sql`
    select coalesce(
      (select enabled from control.flag_override where key = ${key} and org_id = ${orgId}),
      (select f.default_on and f.key = any(p.features) from control.flag f cross join control.customer c
        join control.plan p on p.code = c.plan_code where f.key = ${key} and c.org_id = ${orgId}),
      (select default_on from control.flag where key = ${key})) as on`);
  return r?.on ?? false;
}

/** enabled null removes the override (back to plan and default). */
export async function setFlag(
  db: Db,
  staff: Staff,
  input: { key: string; orgId: string; enabled: boolean | null },
): Promise<void> {
  assertStaffCan(staff, 'flags.set');
  await loadCustomer(db, input.orgId);
  await inCustomer(
    db,
    staff,
    input.orgId,
    { action: 'flag.changed', detail: { key: input.key, enabled: input.enabled } },
    async (tx) => {
      if (input.enabled === null) {
        await tx.execute(sql`
          delete from control.flag_override where key = ${input.key} and org_id = ${input.orgId}`);
        return;
      }
      const [f] = await tx.execute(sql`select 1 from control.flag where key = ${input.key}`);
      if (!f) throw new ControlError('unknown_flag');
      await tx.execute(sql`
        insert into control.flag_override (key, org_id, enabled) values (${input.key}, ${input.orgId}, ${input.enabled})
        on conflict (key, org_id) do update set enabled = excluded.enabled`);
    },
  );
}

export async function setFlagDefault(
  db: Db,
  staff: Staff,
  input: { key: string; defaultOn: boolean },
): Promise<void> {
  await controlStep(
    db,
    staff,
    'flags.default',
    { action: 'flag.default_changed', detail: input },
    async (tx) => {
      const [f] = await tx.execute(sql`
        update control.flag set default_on = ${input.defaultOn} where key = ${input.key} returning key`);
      if (!f) throw new ControlError('unknown_flag');
    },
  );
}

export type SwitchKey = 'messaging_off' | 'payments_off' | 'writes_off';
export type SwitchRow = {
  id: string;
  key: SwitchKey;
  orgId: string | null;
  customer: string | null;
  reason: string;
  setBy: string;
  setAt: string;
};

export async function listSwitches(db: Db, staff: Staff): Promise<SwitchRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<SwitchRow>(sql`
      select w.id::text, w.key, w.org_id::text as "orgId", c.name as customer, w.reason,
        s.name as "setBy", w.set_at::text as "setAt"
      from control.switch w join control.staff s on s.id = w.set_by
      left join control.customer c on c.org_id = w.org_id order by w.set_at desc`)),
  ];
}

/** Is this emergency switch on for this customer (or for everyone)? */
export async function switchOn(db: Db | Tx, key: SwitchKey, orgId: string): Promise<boolean> {
  const [r] = await db.execute<{ on: boolean }>(sql`
    select exists (select 1 from control.switch where key = ${key}
      and (org_id is null or org_id = ${orgId})) as on`);
  return r?.on ?? false;
}

/** Immediate, owner-only, with a reason. A customer switch is also logged in the customer's audit. */
export async function setSwitch(
  db: Db,
  staff: Staff,
  input: { key: SwitchKey; orgId: string | null; on: boolean; reason: string },
): Promise<void> {
  assertStaffCan(staff, 'switches.set');
  if (input.reason.trim().length < 3) throw new ControlError('reason_required');
  const work = async (tx: Tx) => {
    if (input.on)
      await tx.execute(sql`
        insert into control.switch (key, org_id, reason, set_by)
        values (${input.key}, ${input.orgId}, ${input.reason.trim()}, ${staff.staffId})
        on conflict do nothing`);
    else
      await tx.execute(sql`
        delete from control.switch where key = ${input.key}
          and org_id is not distinct from ${input.orgId}::uuid`);
  };
  const entry = {
    action: input.on ? 'switch.on' : 'switch.off',
    reason: input.reason,
    detail: { key: input.key },
  };
  if (input.orgId) {
    await loadCustomer(db, input.orgId);
    await inCustomer(db, staff, input.orgId, entry, work);
  } else await controlStep(db, staff, 'switches.set', entry, work);
}

export type AuditRow = {
  id: string;
  at: string;
  staff: string | null;
  action: string;
  orgId: string | null;
  customer: string | null;
  reason: string | null;
  detail: Record<string, unknown>;
};

export async function searchAudit(
  db: Db,
  staff: Staff,
  q: {
    orgId?: string | undefined;
    staffId?: string | undefined;
    action?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<AuditRow[]> {
  assertStaffCan(staff, 'audit.read');
  return [
    ...(await db.execute<AuditRow>(sql`
      select a.id::text, a.at::text, s.name as staff, a.action, a.org_id::text as "orgId",
        c.name as customer, a.reason, a.detail
      from control.admin_audit a left join control.staff s on s.id = a.staff_id
      left join control.customer c on c.org_id = a.org_id
      where (${q.orgId ?? null}::uuid is null or a.org_id = ${q.orgId ?? null}::uuid)
        and (${q.staffId ?? null}::uuid is null or a.staff_id = ${q.staffId ?? null}::uuid)
        and (${q.action ?? null}::text is null or a.action like ${`${q.action ?? ''}%`})
        and (${q.from ?? null}::date is null or a.at >= ${q.from ?? null}::date)
        and (${q.to ?? null}::date is null or a.at < ${q.to ?? null}::date + 1)
      order by a.at desc limit 200`)),
  ];
}

export type DeliveryHealth = {
  outbox: { waiting: number; oldestSeconds: number | null };
  customers: {
    orgId: string;
    customer: string;
    channels: { channel: string; sent: number; delivered: number; failed: number }[];
  }[];
};

/** Is the platform delivering? The event backlog, and each customer's last 24 hours by channel. */
export async function deliveryHealth(
  db: Db,
  staff: Staff,
  ports: {
    deliveries: (tx: Tx, since: string) => Promise<{ channel: string; state: string; n: number }[]>;
  },
): Promise<DeliveryHealth> {
  assertStaffCan(staff, 'health.read');
  const [o] = await db.execute<DeliveryHealth['outbox']>(sql`
    select count(*)::int as waiting,
      extract(epoch from now() - min(occurred_at))::int as "oldestSeconds"
    from ops.outbox where published_at is null`);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // Customers that did anything in the last day (the outbox is global and holds ids only).
  // ponytail: scans the day's outbox; keep a per-day activity table if the outbox grows large.
  const active = await db.execute<{ orgId: string; name: string }>(sql`
    select c.org_id::text as "orgId", c.name from control.customer c
    where c.status = 'active' and exists (select 1 from ops.outbox o
      where o.org_id = c.org_id and o.occurred_at >= ${since}::timestamptz)
    order by c.name limit 200`);
  const counts = await eachTenant(
    db,
    active.map((c) => c.orgId),
    (tx) => ports.deliveries(tx, since),
  );
  const customers: DeliveryHealth['customers'] = [];
  active.forEach((c, i) => {
    const rows = counts[i] ?? [];
    if (rows.length === 0) return;
    const by = new Map<
      string,
      { channel: string; sent: number; delivered: number; failed: number }
    >();
    for (const r of rows) {
      const x = by.get(r.channel) ?? { channel: r.channel, sent: 0, delivered: 0, failed: 0 };
      if (r.state === 'failed') x.failed += r.n;
      else if (r.state === 'delivered' || r.state === 'read') x.delivered += r.n;
      else if (r.state === 'sent') x.sent += r.n;
      by.set(r.channel, x);
    }
    customers.push({ orgId: c.orgId, customer: c.name, channels: [...by.values()] });
  });
  return {
    outbox: { waiting: o?.waiting ?? 0, oldestSeconds: o?.oldestSeconds ?? null },
    customers,
  };
}
