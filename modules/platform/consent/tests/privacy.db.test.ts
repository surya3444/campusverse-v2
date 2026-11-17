import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BREACH_RECORDED,
  breaches,
  markBreachStep,
  privacyOverview,
  publishNextNotice,
  recordBreach,
  recordConsent,
  recordRightsRequest,
  revokeGuardianCheck,
  rightsRequests,
  setRightsRequestState,
  studentConsent,
  verifyGuardian,
  type PrivacyDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: PrivacyDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let dpo: Actor;
let clerk: Actor;
let guardian: Actor;

beforeAll(async () => {
  t = await seedTenant(db, 'Privacy');
  await grantPermission(db, t.orgId, 'parent', 'platform.consent.record', 'guardian');
  dpo = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'platform.privacy.manage',
      'platform.consent.publish_notice',
    ]),
  };
  // Staff who can publish notices but do not run the privacy console.
  clerk = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['platform.consent.publish_notice']),
  };
  guardian = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
});

afterAll(() => close());

describe('privacy console', () => {
  it('publishes notice versions per purpose and language, counting up', async () => {
    const one = await publishNextNotice(deps, dpo, {
      purpose: 'health_records',
      language: 'en',
      body: 'Synthetic notice: the nurse keeps allergies and conditions.',
    });
    const two = await publishNextNotice(deps, clerk, {
      purpose: 'health_records',
      language: 'en',
      body: 'Synthetic notice v2: the nurse keeps allergies, conditions and blood group.',
    });
    const hindi = await publishNextNotice(deps, dpo, {
      purpose: 'health_records',
      language: 'hi',
      body: 'Synthetic Hindi notice text for the health record purpose.',
    });
    expect([one.version, two.version, hindi.version]).toEqual([1, 2, 1]);
  });

  it('shows coverage from the latest guardian decision per student', async () => {
    const [notice] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select id::text from consent_notice where purpose = 'health_records' and language = 'en'
        order by version desc limit 1`),
    );
    await recordConsent(db, deps.permissions, guardian, {
      studentId: t.studentId,
      guardianId: t.guardianId,
      noticeId: notice!.id,
      decision: 'granted',
      source: 'app',
    });
    // Not counted until the guardian is verified as an identifiable adult (DPDP Rule 10).
    let o = await privacyOverview(deps, dpo);
    let health = o.purposes.find((p) => p.purpose === 'health_records');
    expect(health).toMatchObject({ granted: 0, awaitingVerification: 1 });
    const office = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, ['platform.consent.verify_guardian']),
    };
    await expect(
      verifyGuardian(deps, clerk, {
        guardianId: t.guardianId,
        method: 'known_record',
        document: null,
        note: null,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      verifyGuardian(deps, office, {
        guardianId: t.guardianId,
        method: 'document_seen',
        document: null,
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'document_required' });
    await expect(
      verifyGuardian(deps, office, {
        guardianId: t.studentId,
        method: 'known_record',
        document: null,
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'not_a_guardian' });
    await verifyGuardian(deps, office, {
      guardianId: t.guardianId,
      method: 'document_seen',
      document: 'voter_id',
      note: 'Seen at the front office',
    });
    o = await privacyOverview(deps, dpo);
    health = o.purposes.find((p) => p.purpose === 'health_records');
    expect(health).toMatchObject({
      latestVersion: 2,
      languages: ['en', 'hi'],
      granted: 1,
      awaitingVerification: 0,
    });
    expect(health!.students).toBeGreaterThanOrEqual(1);
    expect(o.guardians.verified).toBeGreaterThanOrEqual(1);
    expect(
      (await studentConsent(deps, guardian, t.studentId)).guardians.find(
        (g) => g.personId === t.guardianId,
      )?.verified,
    ).toMatchObject({ method: 'document_seen', document: 'voter_id' });

    // A verification made in error is revoked with a reason; then verified again from records.
    await expect(
      revokeGuardianCheck(deps, office, { guardianId: t.guardianId, note: ' ' }),
    ).rejects.toMatchObject({ code: 'note_required' });
    await revokeGuardianCheck(deps, office, {
      guardianId: t.guardianId,
      note: 'Wrong person checked',
    });
    expect(
      (await privacyOverview(deps, dpo)).purposes.find((p) => p.purpose === 'health_records'),
    ).toMatchObject({ granted: 0, awaitingVerification: 1 });
    await verifyGuardian(deps, office, {
      guardianId: t.guardianId,
      method: 'known_record',
      document: null,
      note: null,
    });
    // Every check is kept: verified, revoked, verified again.
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from consent_guardian_check where guardian_person_id = ${t.guardianId}`),
    );
    expect(row!.n).toBe(3);
    expect(o.purposes.find((p) => p.purpose === 'apaar_id')).toMatchObject({
      latestVersion: null,
      granted: 0,
    });
  });

  it('shows a student’s consent purpose by purpose to their guardian, not to other staff', async () => {
    const c = await studentConsent(deps, guardian, t.studentId);
    expect(c.me).toBe(t.guardianId);
    expect(c.guardians.map((g) => g.personId)).toContain(t.guardianId);
    const health = c.purposes.find((p) => p.purpose === 'health_records');
    expect(health!.notices.map((n) => [n.language, n.version])).toEqual(
      expect.arrayContaining([
        ['en', 2],
        ['hi', 1],
      ]),
    );
    expect(health!.decisions).toMatchObject([{ guardianId: t.guardianId, decision: 'granted' }]);
    // Purposes with no notice yet are left out.
    expect(c.purposes.find((p) => p.purpose === 'apaar_id')).toBeUndefined();
    await expect(studentConsent(deps, clerk, t.studentId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });

  it('keeps data-rights requests on a clock and needs an outcome to close', async () => {
    const r = await recordRightsRequest(deps, dpo, {
      kind: 'correction',
      requesterName: 'Synthetic Guardian',
      requesterContact: 'guardian@example.test',
      subjectPersonId: t.studentId,
      details: 'Synthetic: the date of birth is wrong.',
      receivedAt: null,
    });
    const [open] = await rightsRequests(deps, dpo, 'open');
    expect(open).toMatchObject({ number: r.number, state: 'open', overdue: false });
    expect(open!.subject).toBeTruthy();

    await expect(
      setRightsRequestState(deps, dpo, { requestId: r.id, state: 'done', outcome: null }),
    ).rejects.toMatchObject({ code: 'outcome_required' });
    await setRightsRequestState(deps, dpo, {
      requestId: r.id,
      state: 'done',
      outcome: 'Corrected from the birth certificate.',
    });
    expect(await rightsRequests(deps, dpo, 'open')).toEqual([]);
    expect((await rightsRequests(deps, dpo, 'closed'))[0]).toMatchObject({
      id: r.id,
      state: 'done',
    });
    await expect(
      setRightsRequestState(deps, dpo, { requestId: r.id, state: 'open', outcome: null }),
    ).rejects.toMatchObject({ code: 'already_closed' });

    // A request received 40 days ago is overdue straight away.
    const late = await recordRightsRequest(deps, dpo, {
      kind: 'access',
      requesterName: 'Synthetic Former Student',
      requesterContact: null,
      subjectPersonId: null,
      details: 'Synthetic: a copy of my records.',
      receivedAt: new Date(Date.now() - 40 * 864e5).toISOString(),
    });
    expect(await rightsRequests(deps, dpo, 'overdue')).toMatchObject([{ number: late.number }]);
  });

  it('records breaches with the CERT-In 6-hour check, steps and events', async () => {
    const b = await recordBreach(deps, dpo, {
      title: 'Synthetic: a laptop was lost',
      description: 'Synthetic: the office laptop with an exported fee list.',
      severity: 'high',
      affectedCount: 40,
      discoveredAt: new Date(Date.now() - 7 * 36e5).toISOString(),
    });
    expect((await breaches(deps, dpo))[0]).toMatchObject({ id: b.id, certIn: 'late' });
    expect((await privacyOverview(deps, dpo)).lateBreaches).toBe(1);

    await markBreachStep(deps, dpo, { breachId: b.id, step: 'board', at: null });
    await markBreachStep(deps, dpo, { breachId: b.id, step: 'close', at: null });
    await expect(
      markBreachStep(deps, dpo, { breachId: b.id, step: 'people', at: null }),
    ).rejects.toMatchObject({ code: 'breach_closed' });

    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ events: number; audits: number }>(sql`
        select
          (select count(*)::int from ops.outbox where org_id = ${t.orgId} and type = ${BREACH_RECORDED}) as events,
          (select count(*)::int from audit_event where action like 'platform.privacy.breach_%') as audits`),
    );
    expect(row).toEqual({ events: 1, audits: 3 });
  });

  it('staff without the privacy permission see nothing and change nothing', async () => {
    await expect(privacyOverview(deps, clerk)).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(rightsRequests(deps, clerk, 'open')).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    await expect(breaches(deps, guardian)).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      recordRightsRequest(deps, clerk, {
        kind: 'grievance',
        requesterName: 'Synthetic',
        requesterContact: null,
        subjectPersonId: null,
        details: 'Synthetic grievance.',
        receivedAt: null,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
  });
});
