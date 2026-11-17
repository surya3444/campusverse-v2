// Case grants (rule book §10.3): written here, read by the snapshot. Callers have already checked
// the permission and write the audit row in the same transaction.
import type { Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type CaseGrant = {
  id: string;
  granteeId: string;
  permission: string;
  subjectId: string;
  reason: string;
  grantedById: string;
  grantedAt: string;
  expiresAt: string;
  endedAt: string | null;
};

const bump = (tx: Tx) =>
  tx.execute(sql`
    update organisation set permission_version = permission_version + 1 where id = app_current_org()`);

export async function insertCaseGrant(
  tx: Tx,
  input: {
    granteeId: string;
    permission: string;
    subjectId: string;
    reason: string;
    grantedById: string;
    hours: number;
  },
): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into access_case_grant (org_id, grantee_person_id, permission, subject_person_id, reason,
      granted_by_person_id, expires_at)
    values (app_current_org(), ${input.granteeId}, ${input.permission}, ${input.subjectId}, ${input.reason},
      ${input.grantedById}, now() + make_interval(hours => ${input.hours}))
    returning id::text`);
  if (!row) throw new Error('insertCaseGrant: no row');
  await bump(tx);
  return row.id;
}

/** Ends a running grant; false if it had already ended or expired. */
export async function endCaseGrant(
  tx: Tx,
  id: string,
  byPersonId: string,
): Promise<CaseGrant | null> {
  const [row] = await tx.execute<CaseGrant>(sql`
    update access_case_grant set ended_at = now(), ended_by_person_id = ${byPersonId}
    where org_id = app_current_org() and id = ${id} and ended_at is null and expires_at > now()
    returning id::text, grantee_person_id::text as "granteeId", permission, subject_person_id::text as "subjectId",
      reason, granted_by_person_id::text as "grantedById", granted_at::text as "grantedAt",
      expires_at::text as "expiresAt", ended_at::text as "endedAt"`);
  if (row) await bump(tx);
  return row ?? null;
}

/** Running grants and those that closed in the last 30 days, newest first. */
export async function listCaseGrants(tx: Tx): Promise<CaseGrant[]> {
  return [
    ...(await tx.execute<CaseGrant>(sql`
      select id::text, grantee_person_id::text as "granteeId", permission, subject_person_id::text as "subjectId",
        reason, granted_by_person_id::text as "grantedById", granted_at::text as "grantedAt",
        expires_at::text as "expiresAt", ended_at::text as "endedAt"
      from access_case_grant
      where org_id = app_current_org() and greatest(coalesce(ended_at, expires_at), expires_at) > now() - interval '30 days'
      order by granted_at desc limit 200`)),
  ];
}
