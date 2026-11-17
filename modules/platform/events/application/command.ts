import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { emit, type EventInput } from './outbox.js';

type Permissions = ReturnType<typeof createPermissions>;

export type CommandOutcome<T> = {
  result: T;
  audit: AuditEntry | AuditEntry[];
  events?: EventInput[];
};

/**
 * The write use-case pattern, in one transaction: tenant context, permission check, the work,
 * audit rows and outbox events. If any step fails, nothing is written.
 */
export async function command<T>(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  check: { permission: string; resource: Resource },
  work: (tx: Tx) => Promise<CommandOutcome<T>>,
): Promise<T> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, check.permission, check.resource);
    const outcome = await work(tx);
    const audits = Array.isArray(outcome.audit) ? outcome.audit : [outcome.audit];
    if (audits.length === 0) throw new Error('command: every write needs an audit entry');
    for (const entry of audits) await writeAudit(tx, actor, entry);
    for (const event of outcome.events ?? []) await emit(tx, event);
    return outcome.result;
  });
}
