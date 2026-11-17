import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_CHANGED, currentConsent, publishNotice, recordConsent } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let admin: Actor;
let guardian: Actor;
let otherParent: Actor;
let noticeId: string;

beforeAll(async () => {
  t = await seedTenant(db, 'Consent');
  await grantPermission(db, t.orgId, 'parent', 'platform.consent.record', 'guardian');
  // An organisation-wide admin, since notices apply to the whole organisation.
  const adminPersonId = await seedAdmin(db, t.orgId, [
    'platform.consent.publish_notice',
    'platform.consent.record',
  ]);
  admin = { accountId: randomUUID(), orgId: t.orgId, personId: adminPersonId };
  guardian = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };

  // A parent role holder who is not this student's guardian.
  const strangerId = await withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Stranger') returning id::text`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select app_current_org(), ${p!.id}, id, 'organisation', app_current_org() from role where key = 'parent'`);
    return p!.id;
  });
  otherParent = { accountId: randomUUID(), orgId: t.orgId, personId: strangerId };

  noticeId = await publishNotice(db, permissions, admin, {
    purpose: 'whatsapp_updates',
    version: 1,
    language: 'en',
    body: 'Synthetic notice: we send school updates on WhatsApp.',
  });
});

afterAll(() => close());

const consent = () =>
  withTenant(db, t.orgId, (tx) =>
    currentConsent(tx, { studentId: t.studentId, purpose: 'whatsapp_updates' }),
  );

describe('consent ledger', () => {
  it('records decisions as a ledger; the latest per guardian is current', async () => {
    const base = { studentId: t.studentId, guardianId: t.guardianId, noticeId };
    await recordConsent(db, permissions, guardian, { ...base, decision: 'granted', source: 'app' });
    expect(await consent()).toMatchObject([
      { guardianId: t.guardianId, decision: 'granted', noticeVersion: 1 },
    ]);

    await recordConsent(db, permissions, guardian, {
      ...base,
      decision: 'withdrawn',
      source: 'app',
    });
    expect(await consent()).toMatchObject([{ decision: 'withdrawn' }]);

    const [rows] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number; events: number; audits: number }>(sql`
        select
          (select count(*)::int from consent_record where purpose = 'whatsapp_updates') as n,
          (select count(*)::int from ops.outbox where org_id = ${t.orgId} and type = ${CONSENT_CHANGED}) as events,
          (select count(*)::int from audit_event where action = 'platform.consent.record') as audits`),
    );
    expect(rows).toEqual({ n: 2, events: 2, audits: 2 });
  });

  it('a guardian cannot record for someone else in the app', async () => {
    await expect(
      recordConsent(db, permissions, guardian, {
        studentId: t.studentId,
        guardianId: t.principalId,
        noticeId,
        decision: 'granted',
        source: 'app',
      }),
    ).rejects.toThrow(/own decision/);
  });

  it("a parent cannot decide for a child who isn't theirs", async () => {
    await expect(
      recordConsent(db, permissions, otherParent, {
        studentId: t.studentId,
        guardianId: otherParent.personId,
        noticeId,
        decision: 'granted',
        source: 'app',
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied', reason: 'no_relationship' });
  });

  it('office staff record a paper form, but only for a real guardian of the student', async () => {
    await recordConsent(db, permissions, admin, {
      studentId: t.studentId,
      guardianId: t.guardianId,
      noticeId,
      decision: 'granted',
      source: 'paper',
    });
    expect(await consent()).toMatchObject([{ decision: 'granted' }]);

    await expect(
      recordConsent(db, permissions, admin, {
        studentId: t.studentId,
        guardianId: otherParent.personId,
        noticeId,
        decision: 'granted',
        source: 'paper',
      }),
    ).rejects.toThrow(/not a current guardian/);
  });

  it('the ledger cannot be edited', async () => {
    const code = await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`update consent_record set decision = 'granted'`),
    ).then(
      () => 'updated',
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(code).toBe('42501');
  });

  it('notice versions are kept, with a hash of the exact text', async () => {
    await publishNotice(db, permissions, admin, {
      purpose: 'whatsapp_updates',
      version: 2,
      language: 'en',
      body: 'Synthetic notice v2.',
    });
    const rows = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ version: number; hash: string }>(sql`
        select version, body_sha256 as hash from consent_notice
        where purpose = 'whatsapp_updates' order by version`),
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
