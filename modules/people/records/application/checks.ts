// Safety checks for staff who work with children: police verification for everyone, and a valid
// driving licence and medical fitness for drivers. Append-only; the latest check of a kind counts.
import { withTenant } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { requiredChecks, type CheckKind } from '../domain/checks.js';
import { checkRoles, latestChecks, lines, today, type StaffCheck } from './check-queries.js';
import { PeopleError, personResource, type PeopleDeps } from './records.js';

export const STAFF_CHECK_RECORDED = 'people.staff.check_recorded.v1';

/** One staff member's checks: what their roles need, the state of each, and the history. */
export async function staffChecks(deps: PeopleDeps, actor: Actor, personId: string) {
  const resource = await personResource(deps, actor, 'people.staff.read', personId, 'staff');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'people.staff.read', resource);
    const on = await today(tx);
    const roles = (await checkRoles(tx, [personId])).get(personId) ?? [];
    const required = requiredChecks(roles);
    const history = await tx.execute<StaffCheck>(sql`
      select id::text, kind, reference, checked_on::text as "checkedOn", valid_until::text as "validUntil",
        note, recorded_at::text as "recordedAt"
      from staff_check where org_id = app_current_org() and person_id = ${personId}
      order by checked_on desc, recorded_at desc`);
    return {
      required,
      lines: lines(required, (await latestChecks(tx, [personId])).get(personId) ?? [], on),
      history: [...history],
    };
  });
}

/** Records a check (a renewal is a new row). Needs the right to update the staff record. */
export async function recordStaffCheck(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: {
    kind: CheckKind;
    reference?: string | null | undefined;
    checkedOn: string;
    validUntil?: string | null | undefined;
    note?: string | null | undefined;
  },
): Promise<string> {
  const resource = await personResource(deps, actor, 'people.staff.update', personId, 'staff');
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.update', resource },
    async (tx) => {
      const [staff] = await tx.execute(sql`
        select 1 from staff_profile where org_id = app_current_org() and person_id = ${personId}`);
      if (!staff) throw new PeopleError('not_staff');
      if (input.checkedOn > (await today(tx))) throw new PeopleError('check_in_future');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into staff_check (org_id, person_id, kind, reference, checked_on, valid_until, note,
          recorded_by_person_id)
        values (app_current_org(), ${personId}, ${input.kind}, ${input.reference?.trim() || null},
          ${input.checkedOn}::date, ${input.validUntil ?? null}::date, ${input.note?.trim() || null},
          ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('staff check: no row');
      return {
        result: row.id,
        audit: {
          action: 'people.staff.update',
          entityType: 'staff_check',
          entityId: row.id,
          dataClass: 'personal',
          detail: { personId, kind: input.kind, validUntil: input.validUntil ?? null },
        },
        events: [{ type: STAFF_CHECK_RECORDED, payload: { personId, kind: input.kind } }],
      };
    },
  );
}
