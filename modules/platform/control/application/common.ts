// Shared plumbing: the signed-in staff member, permission checks, and the audited steps every
// admin action runs through. Nothing here bypasses RLS: a customer is reached only by withTenant.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit } from '@campusverse/platform-audit';
import { sql } from 'drizzle-orm';
import { staffCan, type StaffAction, type StaffRole } from '../domain/roles.js';

export type Staff = { staffId: string; name: string; email: string; role: StaffRole };

export class ControlError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Control: ${code}`);
    this.name = 'ControlError';
  }
}

export function assertStaffCan(staff: Staff, action: StaffAction): void {
  if (!staffCan(staff.role, action)) throw new ControlError('forbidden', { action });
}

type Entry = {
  action: string;
  orgId?: string | null;
  reason?: string | null;
  detail?: Record<string, string | number | boolean | null>;
};

export async function adminAudit(tx: Tx, staff: Staff | null, e: Entry): Promise<void> {
  await tx.execute(sql`
    insert into control.admin_audit (staff_id, action, org_id, reason, detail)
    values (${staff?.staffId ?? null}, ${e.action}, ${e.orgId ?? null}, ${e.reason ?? null},
      ${JSON.stringify(e.detail ?? {})}::jsonb)`);
}

/** A control-only change (plans, flags, switches, staff): the work and its audit row together. */
export async function controlStep<T>(
  db: Db,
  staff: Staff,
  action: StaffAction,
  entry: Entry,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertStaffCan(staff, action);
  return db.transaction(async (tx) => {
    const result = await work(tx);
    await adminAudit(tx, staff, entry);
    return result;
  });
}

/**
 * Work inside one customer's tenant, as the audited service function the guide asks for: the
 * customer's own audit log records it (the school sees it), and so does the admin audit.
 */
export async function inCustomer<T>(
  db: Db,
  staff: Staff | null,
  orgId: string,
  entry: Entry & { entityType?: string },
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(db, orgId, async (tx) => {
    const result = await work(tx);
    await writeAudit(tx, null, {
      action: `platform.${entry.action}`,
      entityType: entry.entityType ?? 'organisation',
      entityId: orgId,
      dataClass: 'operational',
      ...(entry.reason ? { reason: entry.reason } : {}),
      detail: { ...entry.detail, campusVerseStaff: staff?.name ?? 'system' },
    });
    await adminAudit(tx, staff, { ...entry, orgId });
    return result;
  });
}
