// Public API of Privacy & Consent (rule book §13.12): the consent ledger (notices by version and
// language, one row per decision), coverage, data-rights requests and the breach register.
// Never label core data "exempt" here; the legal basis is still a counsel question.
import type { Db, Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

type Permissions = ReturnType<typeof createPermissions>;

// The guide's consent.changed.v1, in the domain.entity.verb.v1 shape every event uses.
export const CONSENT_CHANGED = 'platform.consent.changed.v1';

export type ConsentDecision = 'granted' | 'withdrawn';
export type ConsentSource = 'app' | 'office' | 'paper' | 'import';

export async function publishNotice(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { purpose: string; version: number; language: string; body: string },
): Promise<string> {
  return command(
    db,
    permissions,
    actor,
    { permission: 'platform.consent.publish_notice', resource: { orgId: actor.orgId } },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into consent_notice (org_id, purpose, version, language, body_sha256, body)
        values (app_current_org(), ${input.purpose}, ${input.version}, ${input.language},
          ${createHash('sha256').update(input.body).digest('hex')}, ${input.body})
        returning id::text`);
      if (!row) throw new Error('publishNotice: insert returned no row');
      return {
        result: row.id,
        audit: {
          action: 'platform.consent.publish_notice',
          entityType: 'consent_notice',
          entityId: row.id,
          dataClass: 'operational',
          detail: { purpose: input.purpose, version: input.version, language: input.language },
        },
      };
    },
  );
}

/**
 * Records a guardian's decision. In the app a guardian decides only for themselves, as a
 * guardian of that student (the permission's guardian relation); office staff record paper forms.
 */
export async function recordConsent(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    studentId: string;
    guardianId: string;
    noticeId: string;
    decision: ConsentDecision;
    source: ConsentSource;
    evidenceFileId?: string;
  },
): Promise<string> {
  if (input.source === 'app' && input.guardianId !== actor.personId) {
    throw new Error('recordConsent: in the app a guardian can only record their own decision');
  }
  return command(
    db,
    permissions,
    actor,
    {
      permission: 'platform.consent.record',
      resource: { orgId: actor.orgId, subjectPersonId: input.studentId },
    },
    async (tx) => {
      const [row] = await tx.execute<{ id: string; purpose: string; version: number }>(sql`
        insert into consent_record (org_id, student_person_id, guardian_person_id, notice_id,
          purpose, decision, source, evidence_file_id, recorded_by_account_id)
        select app_current_org(), ${input.studentId}, ${input.guardianId}, n.id, n.purpose,
          ${input.decision}, ${input.source}, ${input.evidenceFileId ?? null}, ${actor.accountId}
        from consent_notice n
        where n.org_id = app_current_org() and n.id = ${input.noticeId}
          and exists (
            select 1 from guardian_link g
            where g.org_id = app_current_org() and g.student_person_id = ${input.studentId}
              and g.guardian_person_id = ${input.guardianId} and g.valid_during @> app_today()
          )
        returning id::text, purpose,
          (select c.version from consent_notice c
           where c.org_id = consent_record.org_id and c.id = consent_record.notice_id) as version`);
      if (!row)
        throw new Error('recordConsent: unknown notice, or not a current guardian of this student');
      return {
        result: row.id,
        audit: {
          action: 'platform.consent.record',
          entityType: 'consent_record',
          entityId: row.id,
          dataClass: 'personal',
          detail: { purpose: row.purpose, decision: input.decision, source: input.source },
        },
        events: [
          {
            type: CONSENT_CHANGED,
            payload: {
              recordId: row.id,
              studentId: input.studentId,
              guardianId: input.guardianId,
              purpose: row.purpose,
              noticeVersion: row.version,
              decision: input.decision,
            },
          },
        ],
      };
    },
  );
}

export type CurrentConsent = {
  guardianId: string;
  decision: ConsentDecision;
  noticeVersion: number;
  recordedAt: string;
};

/** The latest decision of each guardian of a student for one purpose. Call inside withTenant. */
export async function currentConsent(
  tx: Tx,
  input: { studentId: string; purpose: string },
): Promise<CurrentConsent[]> {
  const rows = await tx.execute<CurrentConsent>(sql`
    select distinct on (r.guardian_person_id)
      r.guardian_person_id::text as "guardianId", r.decision, n.version as "noticeVersion",
      r.recorded_at::text as "recordedAt"
    from consent_record r join consent_notice n on n.org_id = r.org_id and n.id = r.notice_id
    where r.org_id = app_current_org() and r.student_person_id = ${input.studentId}
      and r.purpose = ${input.purpose}
    order by r.guardian_person_id, r.id desc`);
  return [...rows];
}

export {
  BREACH_RECORDED,
  NOTICE_PUBLISHED,
  PrivacyError,
  RIGHTS_REQUEST_CLOSED,
  RIGHTS_REQUEST_RECORDED,
  breaches,
  markBreachStep,
  notices,
  privacyOverview,
  publishNextNotice,
  recordBreach,
  recordRightsRequest,
  rightsRequests,
  setRightsRequestState,
  type BreachRow,
  type BreachStep,
  type NoticeRow,
  type PrivacyDeps,
  type PrivacyOverview,
  type PurposeCoverage,
  type RequestView,
  type RightsRequestRow,
} from './application/privacy.js';
export {
  CERT_IN_HOURS,
  PURPOSES,
  REQUEST_TARGET_DAYS,
  certInStatus,
  coveragePercent,
  requestDueAt,
  requestOverdue,
  type CertInStatus,
  type Purpose,
  type RequestKind,
  type RequestState,
} from './domain/privacy.js';
export { studentConsent, type StudentConsent } from './application/student.js';
export {
  GUARDIAN_DOCUMENTS,
  GUARDIAN_VERIFIED,
  consentCounts,
  guardianChecks,
  revokeGuardianCheck,
  verifyGuardian,
  type CheckMethod,
  type GuardianCheck,
  type GuardianDocument,
} from './application/guardians.js';
