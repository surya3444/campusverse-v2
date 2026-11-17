// Guardian verification (rule book §13.4 Consent at Entry; DPDP s.9 and Rule 10): before a
// guardian's consent for a child counts, the institution confirms they are an identifiable adult,
// from details it already holds or an identity document shown. Only the document's kind is kept.
import type { Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { PrivacyError, type PrivacyDeps } from './privacy.js';

const VERIFY = 'platform.consent.verify_guardian';
export const GUARDIAN_VERIFIED = 'platform.consent.guardian_verified.v1';

export const GUARDIAN_DOCUMENTS = [
  'aadhaar',
  'pan',
  'passport',
  'driving_licence',
  'voter_id',
  'other',
] as const;
export type GuardianDocument = (typeof GUARDIAN_DOCUMENTS)[number];
/** What the screens offer. A DigiLocker token arrives through the Integrations Hub, later. */
export type CheckMethod = 'known_record' | 'document_seen';

export type GuardianCheck = {
  verifiedAt: string;
  method: CheckMethod | 'digilocker_token';
  document: GuardianDocument | null;
};

/** The current verification of each guardian (absent: not verified). Call inside the tenant. */
export async function guardianChecks(
  tx: Tx,
  guardianIds: string[],
): Promise<Record<string, GuardianCheck>> {
  if (guardianIds.length === 0) return {};
  const rows = await tx.execute<GuardianCheck & { guardianId: string; outcome: string }>(sql`
    select distinct on (guardian_person_id) guardian_person_id::text as "guardianId", outcome,
      checked_at::text as "verifiedAt", method, document
    from consent_guardian_check
    where org_id = app_current_org() and guardian_person_id = any(${`{${guardianIds.join(',')}}`}::uuid[])
    order by guardian_person_id, id desc`);
  return Object.fromEntries(
    rows
      .filter((r) => r.outcome === 'verified')
      .map((r) => [
        r.guardianId,
        { verifiedAt: r.verifiedAt, method: r.method, document: r.document },
      ]),
  );
}

async function assertGuardian(tx: Tx, guardianId: string) {
  const [g] = await tx.execute(sql`
    select 1 from guardian_link where org_id = app_current_org() and guardian_person_id = ${guardianId}
      and valid_during @> app_today() limit 1`);
  if (!g) throw new PrivacyError('not_a_guardian');
}

/** Records that a current guardian was checked as an identifiable adult. */
export async function verifyGuardian(
  deps: PrivacyDeps,
  actor: Actor,
  input: {
    guardianId: string;
    method: CheckMethod;
    document: GuardianDocument | null;
    note: string | null;
  },
): Promise<void> {
  if ((input.method as string) === 'digilocker_token') throw new PrivacyError('method_unavailable');
  if (input.method === 'document_seen' && !input.document)
    throw new PrivacyError('document_required');
  const document = input.method === 'document_seen' ? input.document : null;
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: VERIFY, resource: { orgId: actor.orgId, subjectPersonId: input.guardianId } },
    async (tx) => {
      await assertGuardian(tx, input.guardianId);
      await tx.execute(sql`
        insert into consent_guardian_check (org_id, guardian_person_id, outcome, method, document, note,
          checked_by_person_id)
        values (app_current_org(), ${input.guardianId}, 'verified', ${input.method}, ${document},
          ${input.note?.trim() || null}, ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'platform.consent.verify_guardian',
          entityType: 'person',
          entityId: input.guardianId,
          dataClass: 'personal',
          detail: { method: input.method, document },
        },
        events: [{ type: GUARDIAN_VERIFIED, payload: { guardianId: input.guardianId } }],
      };
    },
  );
}

/** Withdraws a verification made in error; the guardian's consent stops counting until checked again. */
export async function revokeGuardianCheck(
  deps: PrivacyDeps,
  actor: Actor,
  input: { guardianId: string; note: string },
): Promise<void> {
  const note = input.note.trim();
  if (!note) throw new PrivacyError('note_required');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: VERIFY, resource: { orgId: actor.orgId, subjectPersonId: input.guardianId } },
    async (tx) => {
      await assertGuardian(tx, input.guardianId);
      await tx.execute(sql`
        insert into consent_guardian_check (org_id, guardian_person_id, outcome, note, checked_by_person_id)
        values (app_current_org(), ${input.guardianId}, 'revoked', ${note}, ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'platform.consent.revoke_guardian_check',
          entityType: 'person',
          entityId: input.guardianId,
          dataClass: 'personal',
          detail: { note },
        },
      };
    },
  );
}

/**
 * Students whose consent for a purpose counts today: their latest decision is a grant, by a
 * guardian verified as an identifiable adult (DPDP Rule 10). Call inside the tenant.
 */
export async function consentCounts(
  tx: Tx,
  studentIds: string[],
  purpose: string,
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const latest = await tx.execute<{ studentId: string; guardianId: string; decision: string }>(sql`
    select distinct on (student_person_id) student_person_id::text as "studentId",
      guardian_person_id::text as "guardianId", decision
    from consent_record
    where org_id = app_current_org() and purpose = ${purpose}
      and student_person_id = any(${`{${studentIds.join(',')}}`}::uuid[])
    order by student_person_id, id desc`);
  const granted = latest.filter((r) => r.decision === 'granted');
  const checks = await guardianChecks(
    tx,
    granted.map((r) => r.guardianId),
  );
  return new Set(granted.filter((r) => checks[r.guardianId]).map((r) => r.studentId));
}
