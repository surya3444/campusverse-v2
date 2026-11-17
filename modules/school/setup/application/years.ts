// Academic years over time: a year runs, ends, and is closed once its records are final. A closed
// year is read-only (attendance, marks, subject teachers); reopening it needs a reason and is
// recorded in the Activity Log.
import type { Db } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { institutionResource, SetupError } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;

export const YEAR_CLOSED = 'school.year.closed.v1';
export const YEAR_REOPENED = 'school.year.reopened.v1';

async function changeYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; yearId: string; close: boolean; reason: string | null },
) {
  const resource = await institutionResource(db, actor, input.institutionId);
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const [y] = await tx.execute<{ label: string; status: string; ended: boolean }>(sql`
        select label, status, upper(valid_during) <= app_today() as ended from school_year
        where org_id = app_current_org() and institution_id = ${input.institutionId} and id = ${input.yearId}
        for update`);
      if (!y) throw new SetupError('year_not_found');
      if (input.close) {
        if (y.status === 'closed') throw new SetupError('year_closed');
        // A running year can't be locked: attendance and marks are still being taken.
        if (!y.ended) throw new SetupError('year_not_ended');
      } else if (y.status !== 'closed') throw new SetupError('year_not_closed');
      // Reopened, a year takes back its place by date (planned, active or ended).
      await tx.execute(sql`
        update school_year set status = ${input.close ? 'closed' : 'active'}
        where org_id = app_current_org() and id = ${input.yearId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.setup.manage',
          entityType: 'school_year',
          entityId: input.yearId,
          dataClass: 'operational',
          detail: { step: input.close ? 'close_year' : 'reopen_year', label: y.label },
          ...(input.reason ? { reason: input.reason } : {}),
        },
        events: [
          {
            type: input.close ? YEAR_CLOSED : YEAR_REOPENED,
            payload: { institutionId: input.institutionId, yearId: input.yearId },
          },
        ],
      };
    },
  );
}

/** Locks an ended year: its attendance, marks and subject teachers can no longer change. */
export function closeYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; yearId: string },
): Promise<void> {
  return changeYear(db, permissions, actor, { ...input, close: true, reason: null });
}

/** Opens a closed year again for corrections. The reason goes to the Activity Log. */
export async function reopenYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; yearId: string; reason: string },
): Promise<void> {
  if (input.reason.trim().length < 5) throw new SetupError('reason_required');
  return changeYear(db, permissions, actor, {
    ...input,
    close: false,
    reason: input.reason.trim(),
  });
}
