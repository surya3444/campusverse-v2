// Queries over staff checks that other use cases in this module share (the staff list, transport
// crew checks). No permission checks here: callers have done their own.
import type { Tx } from '@campusverse/db';
import { currentRoleKeys } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { checkState, requiredChecks, type CheckKind, type CheckState } from '../domain/checks.js';

export type StaffCheck = {
  id: string;
  kind: CheckKind;
  reference: string | null;
  checkedOn: string;
  validUntil: string | null;
  note: string | null;
  recordedAt: string;
};
export type CheckLine = { kind: CheckKind; state: CheckState; latest: StaffCheck | null };

export const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

/** Roles that need checks: work roles held today, or 'support' for staff with no app role. */
export async function checkRoles(tx: Tx, personIds: string[]) {
  const roles = await currentRoleKeys(tx, personIds);
  return new Map(
    personIds.map((id) => {
      const held = roles.get(id) ?? [];
      return [id, held.length > 0 ? held : ['support']];
    }),
  );
}

export async function latestChecks(
  tx: Tx,
  personIds: string[],
): Promise<Map<string, StaffCheck[]>> {
  const out = new Map<string, StaffCheck[]>();
  if (personIds.length === 0) return out;
  const rows = await tx.execute<StaffCheck & { personId: string }>(sql`
    select distinct on (person_id, kind) person_id::text as "personId", id::text, kind, reference,
      checked_on::text as "checkedOn", valid_until::text as "validUntil", note,
      recorded_at::text as "recordedAt"
    from staff_check
    where org_id = app_current_org() and person_id in (${sql.join(
      personIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    order by person_id, kind, checked_on desc, recorded_at desc`);
  for (const { personId, ...c } of rows) out.set(personId, [...(out.get(personId) ?? []), c]);
  return out;
}

export function lines(required: CheckKind[], latest: StaffCheck[], on: string): CheckLine[] {
  // Required checks first, then any other check on file (a PSV badge, say).
  const kinds = [...required, ...latest.map((c) => c.kind).filter((k) => !required.includes(k))];
  return kinds.map((kind) => {
    const c = latest.find((x) => x.kind === kind) ?? null;
    return { kind, state: checkState(c ?? undefined, on), latest: c };
  });
}

/**
 * Checks of many staff at once (the staff list): how many required checks are missing, expired
 * or running out, per person. Call inside the tenant after the list's own permission check.
 */
export async function checksDueOf(tx: Tx, personIds: string[]): Promise<Map<string, CheckLine[]>> {
  const on = await today(tx);
  const roles = await checkRoles(tx, personIds);
  const latest = await latestChecks(tx, personIds);
  return new Map(
    personIds.map((id) => [
      id,
      lines(requiredChecks(roles.get(id) ?? []), latest.get(id) ?? [], on).filter(
        (l) => l.state !== 'ok',
      ),
    ]),
  );
}

/** Which of these checks a person lacks or has expired today (transport crew), or none. */
export async function checksFailing(
  tx: Tx,
  personId: string,
  kinds: readonly CheckKind[],
): Promise<CheckKind[]> {
  const on = await today(tx);
  const latest = (await latestChecks(tx, [personId])).get(personId) ?? [];
  return kinds.filter((k) => {
    const s = checkState(
      latest.find((c) => c.kind === k),
      on,
    );
    return s === 'missing' || s === 'expired';
  });
}
