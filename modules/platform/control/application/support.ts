// Support access: asked for with a reason and ticket, approved by someone else, read-only,
// at most four hours, and written into the school's own audit log each time it is used.
import type { Db } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { SUPPORT_MINUTES } from '../domain/roles.js';
import { adminAudit, assertStaffCan, ControlError, inCustomer, type Staff } from './common.js';
import { loadCustomer, type ControlPorts } from './customers.js';

export async function requestSupportAccess(
  db: Db,
  staff: Staff,
  input: { orgId: string; reason: string; ticket: string; minutes: number },
): Promise<{ approvalId: string }> {
  assertStaffCan(staff, 'support.request');
  if (input.minutes < SUPPORT_MINUTES.min || input.minutes > SUPPORT_MINUTES.max)
    throw new ControlError('support_minutes');
  await loadCustomer(db, input.orgId);
  return db.transaction(async (tx) => {
    const [a] = await tx.execute<{ id: string }>(sql`
      insert into control.approval (kind, org_id, payload, reason, requested_by)
      values ('support_access', ${input.orgId},
        ${JSON.stringify({ minutes: input.minutes, ticket: input.ticket })}::jsonb,
        ${input.reason.trim()}, ${staff.staffId}) returning id::text`);
    await adminAudit(tx, staff, {
      action: 'approval.requested',
      orgId: input.orgId,
      reason: input.reason,
      detail: { kind: 'support_access', minutes: input.minutes, ticket: input.ticket },
    });
    return { approvalId: a?.id ?? '' };
  });
}

export type GrantRow = {
  id: string;
  orgId: string;
  customer: string;
  staff: string;
  staffId: string;
  reason: string;
  startsAt: string;
  expiresAt: string;
  active: boolean;
};

export async function listGrants(db: Db, staff: Staff): Promise<GrantRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<GrantRow>(sql`
      select g.id::text, g.org_id::text as "orgId", c.name as customer, s.name as staff,
        g.staff_id::text as "staffId", a.reason, g.starts_at::text as "startsAt",
        g.expires_at::text as "expiresAt", (g.ended_at is null and g.expires_at > now()) as active
      from control.support_grant g join control.customer c on c.org_id = g.org_id
      join control.staff s on s.id = g.staff_id join control.approval a on a.id = g.approval_id
      order by g.starts_at desc limit 100`)),
  ];
}

/** The holder or an owner ends access early. */
export async function endGrant(db: Db, staff: Staff, grantId: string): Promise<void> {
  const [g] = await db.execute<{ orgId: string; staffId: string }>(sql`
    select org_id::text as "orgId", staff_id::text as "staffId" from control.support_grant
    where id = ${grantId} and ended_at is null`);
  if (!g) throw new ControlError('grant_not_found');
  if (g.staffId !== staff.staffId) assertStaffCan(staff, 'approvals.decide');
  await inCustomer(
    db,
    staff,
    g.orgId,
    { action: 'support.access_ended', detail: { grantId } },
    (tx) =>
      tx.execute(sql`update control.support_grant set ended_at = now() where id = ${grantId}`),
  );
}

/** What support sees under a live grant: counts, codes and statuses, read-only and logged. */
export async function supportView(
  db: Db,
  staff: Staff,
  ports: ControlPorts,
  orgId: string,
): Promise<Record<string, unknown>> {
  const [g] = await db.execute<{ id: string; expiresAt: string }>(sql`
    select id::text, expires_at::text as "expiresAt" from control.support_grant
    where org_id = ${orgId} and staff_id = ${staff.staffId} and ended_at is null
      and starts_at <= now() and expires_at > now()`);
  if (!g) throw new ControlError('no_support_access');
  return inCustomer(
    db,
    staff,
    orgId,
    { action: 'support.viewed', detail: { grantId: g.id } },
    async (tx) => ({ expiresAt: g.expiresAt, ...(await ports.supportSummary(tx)) }),
  );
}
