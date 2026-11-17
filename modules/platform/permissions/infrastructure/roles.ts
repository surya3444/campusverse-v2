// Roles and their grants, edited only through these functions, inside the calling use case's
// command() (platform/access), which has checked its own permission and writes the audit row.
// Every write here bumps permission_version through the table triggers, so cached snapshots
// go stale at once.
import type { Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type RoleRow = {
  id: string;
  key: string;
  name: string;
  /** Plain grants only (no guardian or self relation): what the role lets its holders do. */
  permissions: string[];
  /** Grants that apply only to the holder's own data or their children's. */
  relational: string[];
  holders: number;
};

export async function listRoles(tx: Tx): Promise<RoleRow[]> {
  return [
    ...(await tx.execute<RoleRow>(sql`
      select r.id::text, r.key, r.name,
        coalesce(array_agg(g.permission order by g.permission) filter (where g.permission is not null and g.relation is null), '{}') as permissions,
        coalesce(array_agg(g.permission order by g.permission) filter (where g.relation is not null), '{}') as relational,
        (select count(distinct a.person_id)::int from role_assignment a
          where a.org_id = r.org_id and a.role_id = r.id and a.valid_during @> app_today()) as holders
      from role r left join role_grant g on g.org_id = r.org_id and g.role_id = r.id
      where r.org_id = app_current_org()
      group by r.org_id, r.id, r.key, r.name
      order by r.created_at`)),
  ];
}

export async function roleById(tx: Tx, roleId: string): Promise<RoleRow | null> {
  return (await listRoles(tx)).find((r) => r.id === roleId) ?? null;
}

export async function createRole(tx: Tx, key: string, name: string): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into role (org_id, key, name) values (app_current_org(), ${key}, ${name}) returning id::text`);
  if (!row) throw new Error('createRole: insert returned no row');
  return row.id;
}

/**
 * What every staff role allows about oneself only: changing one's own profile (photo, email,
 * language) and checking oneself in. Nothing about anyone else.
 */
export async function addSelfGrants(tx: Tx, roleId: string): Promise<void> {
  await tx.execute(sql`
    insert into role_grant (org_id, role_id, permission, relation)
    values (app_current_org(), ${roleId}, 'people.profile.update_own', 'self'),
      (app_current_org(), ${roleId}, 'staff.attendance.check_in', 'self')
    on conflict do nothing`);
}

export async function renameRole(tx: Tx, roleId: string, name: string): Promise<void> {
  await tx.execute(sql`
    update role set name = ${name} where org_id = app_current_org() and id = ${roleId}`);
}

export async function addGrant(tx: Tx, roleId: string, permission: string): Promise<void> {
  await tx.execute(sql`
    insert into role_grant (org_id, role_id, permission) values (app_current_org(), ${roleId}, ${permission})
    on conflict do nothing`);
}

export async function removeGrant(tx: Tx, roleId: string, permission: string): Promise<void> {
  await tx.execute(sql`
    delete from role_grant
    where org_id = app_current_org() and role_id = ${roleId} and permission = ${permission}
      and relation is null`);
}

/** Every plain permission the person holds today, at any scope (roles and duties). */
export async function heldPermissions(tx: Tx, personId: string): Promise<Set<string>> {
  const rows = await tx.execute<{ permission: string }>(sql`
    select distinct g.permission from (
      select role_id from role_assignment
      where org_id = app_current_org() and person_id = ${personId} and valid_during @> app_today()
      union all
      select role_id from staff_duty
      where org_id = app_current_org() and person_id = ${personId} and valid_during @> app_today()
    ) a join role_grant g on g.org_id = app_current_org() and g.role_id = a.role_id
    where g.relation is null`);
  return new Set(rows.map((r) => r.permission));
}

export type Assignment = {
  id: string;
  personId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  scopeType: 'organisation' | 'campus' | 'institution';
  scopeId: string;
  from: string;
  until: string | null;
  current: boolean;
};

/** Assignments that are current or still to come, by person. */
export async function listAssignments(tx: Tx, personId?: string): Promise<Assignment[]> {
  return [
    ...(await tx.execute<Assignment>(sql`
      select ra.id::text, ra.person_id::text as "personId", r.id::text as "roleId", r.key as "roleKey",
        r.name as "roleName", ra.scope_type as "scopeType", ra.scope_id::text as "scopeId",
        lower(ra.valid_during)::text as "from", (upper(ra.valid_during) - 1)::text as "until",
        ra.valid_during @> app_today() as current
      from role_assignment ra join role r on r.org_id = ra.org_id and r.id = ra.role_id
      where ra.org_id = app_current_org() and not isempty(ra.valid_during)
        and (upper_inf(ra.valid_during) or upper(ra.valid_during) > app_today())
        and (${personId ?? null}::uuid is null or ra.person_id = ${personId ?? null}::uuid)
      order by ra.person_id, lower(ra.valid_during)`)),
  ];
}

export async function addAssignment(
  tx: Tx,
  input: {
    personId: string;
    roleId: string;
    scopeType: Assignment['scopeType'];
    scopeId: string;
    from: string;
    until: string | null;
  },
): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id, valid_during)
    values (app_current_org(), ${input.personId}, ${input.roleId}, ${input.scopeType}, ${input.scopeId},
      daterange(${input.from}::date, ${input.until === null ? null : sql`${input.until}::date + 1`}))
    returning id::text`);
  if (!row) throw new Error('addAssignment: insert returned no row');
  return row.id;
}

/** Ends an assignment after `lastDay` (inclusive); one not yet started becomes empty. */
export async function endAssignment(
  tx: Tx,
  assignmentId: string,
  lastDay: string,
): Promise<boolean> {
  const end = sql`(${lastDay}::date + 1)`;
  const r = await tx.execute(sql`
    update role_assignment
    set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${end}))
    where org_id = app_current_org() and id = ${assignmentId}
      and (upper_inf(valid_during) or upper(valid_during) > ${end})`);
  return r.count > 0;
}

/** People who hold the owner role today. */
export async function currentOwners(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ person_id: string }>(sql`
    select distinct a.person_id::text from role_assignment a
    join role r on r.org_id = a.org_id and r.id = a.role_id and r.key = 'owner'
    where a.org_id = app_current_org() and a.valid_during @> app_today()`);
  return rows.map((r) => r.person_id);
}

/**
 * People who hold a permission at a campus today: through the organisation, the campus, or an
 * institution on it. For alerts such as "a child was found on the bus" (staff grants only).
 */
export async function holdersAt(tx: Tx, permission: string, campusId: string): Promise<string[]> {
  const rows = await tx.execute<{ person_id: string }>(sql`
    select distinct a.person_id::text from role_assignment a
    join role_grant g on g.org_id = a.org_id and g.role_id = a.role_id
      and g.permission = ${permission} and g.relation is null
    where a.org_id = app_current_org() and a.valid_during @> app_today()
      and (a.scope_type = 'organisation'
        or (a.scope_type = 'campus' and a.scope_id = ${campusId})
        or (a.scope_type = 'institution' and a.scope_id in (
          select id from institution where org_id = app_current_org() and campus_id = ${campusId})))`);
  return rows.map((r) => r.person_id);
}
