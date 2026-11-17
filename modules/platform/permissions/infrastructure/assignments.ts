// Role assignments and duties, written only through these functions. Call them inside the
// calling use case's command(), which has already checked its own permission.
import type { Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type RoleScope = { type: 'organisation' | 'campus' | 'institution'; id: string };

/** Gives a person a role (by template key) at a scope, unless they already hold it today. */
export async function assignRole(
  tx: Tx,
  input: { personId: string; roleKey: string; scope: RoleScope; importBatchId?: string | null },
): Promise<void> {
  const [role] = await tx.execute<{ id: string }>(sql`
    select id::text from role where org_id = app_current_org() and key = ${input.roleKey}`);
  if (!role) throw new Error(`assignRole: no role ${input.roleKey} in this school`);
  await tx.execute(sql`
    insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id, import_batch_id)
    select app_current_org(), ${input.personId}, ${role.id}, ${input.scope.type}, ${input.scope.id},
      ${input.importBatchId ?? null}
    where not exists (
      select 1 from role_assignment where org_id = app_current_org() and person_id = ${input.personId}
        and role_id = ${role.id} and scope_id = ${input.scope.id} and valid_during @> app_today())`);
}

/**
 * Ends every role and duty a person holds, after `lastDay` (inclusive). Used when someone leaves:
 * their access ends everywhere in the organisation at once. Anything due to start later becomes
 * an empty range, which grants nothing.
 */
export async function endAllRoles(tx: Tx, personId: string, lastDay: string): Promise<number> {
  const end = sql`(${lastDay}::date + 1)`;
  const roles = await tx.execute(sql`
    update role_assignment set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${end}))
    where org_id = app_current_org() and person_id = ${personId}
      and (upper_inf(valid_during) or upper(valid_during) > ${end})`);
  const duties = await tx.execute(sql`
    update staff_duty set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${end}))
    where org_id = app_current_org() and person_id = ${personId} and upper(valid_during) > ${end}`);
  return roles.count + duties.count;
}

/** Import undo: removes the role assignments a batch created. */
export async function removeImportedRoles(tx: Tx, importBatchId: string): Promise<void> {
  await tx.execute(sql`
    delete from role_assignment where org_id = app_current_org() and import_batch_id = ${importBatchId}`);
}

export type HeldRole = {
  roleKey: string;
  roleName: string;
  scopeType: string;
  scopeId: string;
  from: string;
  until: string | null;
};

/** The roles a person holds or held, newest first. Call inside the tenant. */
export async function rolesOf(tx: Tx, personId: string): Promise<HeldRole[]> {
  return [
    ...(await tx.execute<HeldRole>(sql`
      select r.key as "roleKey", r.name as "roleName", ra.scope_type as "scopeType", ra.scope_id::text as "scopeId",
        lower(ra.valid_during)::text as "from", (upper(ra.valid_during) - 1)::text as "until"
      from role_assignment ra join role r on r.org_id = ra.org_id and r.id = ra.role_id
      -- Ranges emptied by an exit never took effect: not part of anyone's history.
      where ra.org_id = app_current_org() and ra.person_id = ${personId} and not isempty(ra.valid_during)
      order by lower(ra.valid_during) desc`)),
  ];
}

/** Role keys each person holds today, for many people at once. Call inside the tenant. */
export async function currentRoleKeys(tx: Tx, personIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (personIds.length === 0) return out;
  const rows = await tx.execute<{ personId: string; key: string }>(sql`
    select distinct ra.person_id::text as "personId", r.key
    from role_assignment ra join role r on r.org_id = ra.org_id and r.id = ra.role_id
    where ra.org_id = app_current_org() and ra.valid_during @> app_today()
      and ra.person_id in (${sql.join(
        personIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
  for (const r of rows) out.set(r.personId, [...(out.get(r.personId) ?? []), r.key]);
  return out;
}
