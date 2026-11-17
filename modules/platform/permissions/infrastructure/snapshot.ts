import { schema, type Redis, type Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import type { GuardianFlag, PermissionSnapshot, ScopeType } from '../domain/evaluate.js';

const TTL_SECONDS = 15 * 60;

/**
 * Loads the actor's permission snapshot, from Redis when fresh, else from Postgres.
 * The key carries the org's permission_version and today's IST date, so any role, duty or
 * guardian change, and every midnight, produces a new key instead of deleting old ones.
 * Must run inside withTenant() for actor.orgId.
 */
export async function loadSnapshot(
  tx: Tx,
  redis: Redis | null,
  actor: { orgId: string; personId: string },
): Promise<PermissionSnapshot> {
  const [meta] = await tx.execute<{ version: number; today: string }>(sql`
    select permission_version as version, app_today()::text as today
    from organisation where id = ${actor.orgId}`);
  // RLS hides the organisation unless the transaction is scoped to it.
  if (!meta) throw new Error('loadSnapshot: transaction is not scoped to the actor organisation');

  const key = `perm:${actor.orgId}:${actor.personId}:${meta.today}:${meta.version}`;
  const cached = redis ? await quietly(() => redis.get(key)) : null;
  if (cached) return JSON.parse(cached) as PermissionSnapshot;

  const snapshot = await fromPostgres(tx, actor);
  if (redis) await quietly(() => redis.set(key, JSON.stringify(snapshot), 'EX', TTL_SECONDS));
  return snapshot;
}

async function fromPostgres(
  tx: Tx,
  { orgId, personId }: { orgId: string; personId: string },
): Promise<PermissionSnapshot> {
  const grants = await tx.execute<{
    permission: string;
    scope_type: ScopeType;
    scope_id: string;
    relation: 'self' | 'guardian' | null;
    guardian_flag: GuardianFlag | null;
  }>(sql`
    select g.permission, a.scope_type, a.scope_id::text, g.relation, g.guardian_flag
    from (
      select role_id, scope_type, scope_id from role_assignment
      where org_id = ${orgId} and person_id = ${personId} and valid_during @> app_today()
      union all
      select role_id, scope_type, scope_id from staff_duty
      where org_id = ${orgId} and person_id = ${personId} and valid_during @> app_today()
    ) a
    join role_grant g on g.org_id = ${orgId} and g.role_id = a.role_id`);

  const links = await tx.execute<{ student: string } & Record<GuardianFlag, boolean>>(sql`
    select student_person_id::text as student,
      is_fee_payer, can_pickup, academic_messages, fee_messages, location_access
    from guardian_link
    where org_id = ${orgId} and guardian_person_id = ${personId}
      and valid_during @> app_today() and restricted_at is null and can_login`);

  // Case grants still running; the evaluation checks the expiry against the clock as well.
  const cases = await tx.execute<{
    id: string;
    permission: string;
    subjectPersonId: string;
    expiresAt: string;
  }>(sql`
    select id::text, permission, subject_person_id::text as "subjectPersonId",
      to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "expiresAt"
    from access_case_grant
    where org_id = ${orgId} and grantee_person_id = ${personId} and ended_at is null
      and expires_at > now()`);

  return {
    orgId,
    personId,
    cases: [...cases],
    grants: grants.map((g) => ({
      permission: g.permission,
      scopeType: g.scope_type,
      scopeId: g.scope_id,
      relation: g.relation,
      guardianFlag: g.guardian_flag,
    })),
    guardianOf: Object.fromEntries(
      links.map((l) => [l.student, schema.GUARDIAN_FLAGS.filter((f) => l[f])]),
    ),
  };
}

/** Cache calls never fail the request: a Redis outage just means reading Postgres. */
async function quietly<T>(op: () => Promise<T>): Promise<T | null> {
  try {
    return await op();
  } catch {
    return null;
  }
}
