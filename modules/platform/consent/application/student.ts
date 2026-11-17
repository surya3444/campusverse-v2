// A student's consent, purpose by purpose (rule book §13.4 Consent at Entry, §16.5): the latest
// notice for each purpose and each current guardian's decision. A guardian sees their own child
// (the permission's guardian relation); office staff see any student to record paper forms.
import { withTenant } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { PURPOSES } from '../domain/privacy.js';
import { guardianChecks, type GuardianCheck } from './guardians.js';
import type { PrivacyDeps } from './privacy.js';

export type StudentConsent = {
  studentId: string;
  /** The person asking, so a guardian's screen knows which decisions are theirs. */
  me: string;
  /** `verified` null: not yet checked as an identifiable adult, so their consent doesn't count yet. */
  guardians: { personId: string; name: string; verified: GuardianCheck | null }[];
  purposes: {
    purpose: string;
    /** Latest version per language. Empty: nothing to decide yet. */
    notices: { id: string; version: number; language: string; body: string }[];
    decisions: {
      guardianId: string;
      decision: 'granted' | 'withdrawn';
      noticeVersion: number;
      recordedAt: string;
      source: string;
    }[];
  }[];
};

export async function studentConsent(
  deps: PrivacyDeps,
  actor: Actor,
  studentId: string,
): Promise<StudentConsent> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'platform.consent.record', {
      orgId: actor.orgId,
      subjectPersonId: studentId,
    });
    const guardians = await tx.execute<{ personId: string }>(sql`
      select distinct guardian_person_id::text as "personId" from guardian_link
      where org_id = app_current_org() and student_person_id = ${studentId}
        and valid_during @> app_today() and restricted_at is null`);
    const notices = await tx.execute<{
      id: string;
      purpose: string;
      version: number;
      language: string;
      body: string;
    }>(sql`
      select distinct on (purpose, language) id::text, purpose, version, language, body
      from consent_notice where org_id = app_current_org()
      order by purpose, language, version desc`);
    const decisions = await tx.execute<{
      purpose: string;
      guardianId: string;
      decision: 'granted' | 'withdrawn';
      noticeVersion: number;
      recordedAt: string;
      source: string;
    }>(sql`
      select distinct on (r.purpose, r.guardian_person_id) r.purpose,
        r.guardian_person_id::text as "guardianId", r.decision, n.version as "noticeVersion",
        r.recorded_at::text as "recordedAt", r.source
      from consent_record r join consent_notice n on n.org_id = r.org_id and n.id = r.notice_id
      where r.org_id = app_current_org() and r.student_person_id = ${studentId}
      order by r.purpose, r.guardian_person_id, r.id desc`);
    const names = await displayNames(
      tx,
      guardians.map((g) => g.personId),
    );
    const checks = await guardianChecks(
      tx,
      guardians.map((g) => g.personId),
    );
    const known = new Set<string>(PURPOSES);
    const purposes = [
      ...PURPOSES,
      ...new Set(notices.map((n) => n.purpose).filter((p) => !known.has(p))),
    ];
    return {
      studentId,
      me: actor.personId,
      guardians: guardians.map((g) => ({
        personId: g.personId,
        name: names[g.personId] ?? '',
        verified: checks[g.personId] ?? null,
      })),
      purposes: purposes
        .map((purpose) => ({
          purpose,
          notices: notices
            .filter((n) => n.purpose === purpose)
            .map((n) => ({ id: n.id, version: n.version, language: n.language, body: n.body })),
          decisions: decisions
            .filter((d) => d.purpose === purpose)
            .map((d) => ({
              guardianId: d.guardianId,
              decision: d.decision,
              noticeVersion: d.noticeVersion,
              recordedAt: d.recordedAt,
              source: d.source,
            })),
        }))
        // A purpose matters once it has a notice or a decision on record.
        .filter((p) => p.notices.length > 0 || p.decisions.length > 0),
    };
  });
}
