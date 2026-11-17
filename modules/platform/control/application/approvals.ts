// Maker-checker: suspending or reactivating a customer and support access need a second person.
// The database refuses an approval by the person who asked (CHECK constraint) as well.
import type { Db } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { assertStaffCan, ControlError, inCustomer, type Staff } from './common.js';
import { applyStatus, type CustomerStatus } from './customers.js';

export type ApprovalRow = {
  id: string;
  kind: 'customer_status' | 'support_access';
  orgId: string;
  customer: string;
  payload: Record<string, string | number>;
  reason: string;
  requestedBy: string;
  requestedById: string;
  state: string;
  decidedBy: string | null;
  createdAt: string;
};

export async function listApprovals(db: Db, staff: Staff): Promise<ApprovalRow[]> {
  assertStaffCan(staff, 'customers.read');
  return [
    ...(await db.execute<ApprovalRow>(sql`
      select a.id::text, a.kind, a.org_id::text as "orgId", c.name as customer, a.payload, a.reason,
        r.name as "requestedBy", a.requested_by::text as "requestedById", a.state,
        d.name as "decidedBy", a.created_at::text as "createdAt"
      from control.approval a join control.customer c on c.org_id = a.org_id
      join control.staff r on r.id = a.requested_by left join control.staff d on d.id = a.decided_by
      order by a.state = 'requested' desc, a.created_at desc limit 100`)),
  ];
}

export async function decideApproval(
  db: Db,
  staff: Staff,
  input: { approvalId: string; approve: boolean },
): Promise<void> {
  assertStaffCan(staff, 'approvals.decide');
  const [a] = await db.execute<{
    kind: ApprovalRow['kind'];
    orgId: string;
    payload: { status?: CustomerStatus; minutes?: number };
    reason: string;
    requestedBy: string;
  }>(sql`
    select kind, org_id::text as "orgId", payload, reason, requested_by::text as "requestedBy"
    from control.approval where id = ${input.approvalId} and state = 'requested'`);
  if (!a) throw new ControlError('approval_not_found');
  if (a.requestedBy === staff.staffId) throw new ControlError('maker_cannot_approve');
  const action = !input.approve
    ? 'approval.rejected'
    : a.kind === 'customer_status'
      ? 'customer.status_changed'
      : 'support.access_granted';
  await inCustomer(
    db,
    staff,
    a.orgId,
    {
      action,
      reason: a.reason,
      detail: { approvalId: input.approvalId, kind: a.kind, status: a.payload.status ?? null },
    },
    async (tx) => {
      const [done] = await tx.execute(sql`
        update control.approval set state = ${input.approve ? 'approved' : 'rejected'},
          decided_by = ${staff.staffId}, decided_at = now()
        where id = ${input.approvalId} and state = 'requested' returning id`);
      if (!done) throw new ControlError('approval_not_found');
      if (!input.approve) return;
      if (a.kind === 'customer_status' && a.payload.status)
        await applyStatus(tx, a.orgId, a.payload.status);
      if (a.kind === 'support_access')
        await tx.execute(sql`
          insert into control.support_grant (approval_id, staff_id, org_id, starts_at, expires_at)
          values (${input.approvalId}, ${a.requestedBy}, ${a.orgId}, now(),
            now() + ${`${a.payload.minutes ?? 60} minutes`}::interval)`);
    },
  );
}
