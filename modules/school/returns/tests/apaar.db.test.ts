// APAAR reconciliation (rule book §15; P0 item 15): a UDISE+ list matched by PEN and name; an ID
// is stored only where APAAR consent counts (granted by a verified guardian), sealed like any other.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileApaar, type ReturnsDeps } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: ReturnsDeps = {
  db,
  permissions: createPermissions(null),
  keys: parseFieldKeys(env.FIELD_KEYS),
};
let t: SeededTenant;
let office: Actor;
let viewer: Actor;
const PEN = '20240101777';

beforeAll(async () => {
  t = await seedTenant(db, 'Apaar');
  const actor = async (grants: string[]): Promise<Actor> => ({
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, grants),
  });
  office = await actor(['school.returns.read', 'people.student.update']);
  viewer = await actor(['school.returns.read']);
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`update student_profile set pen = ${PEN} where person_id = ${t.studentId}`),
  );
});
afterAll(() => close());

const csv = (lines: string[]) => ['Student Name,PEN,APAAR ID', ...lines].join('\n');

describe('APAAR reconciliation', () => {
  it('matches by PEN and name, and stores nothing without consent', async () => {
    const r = await reconcileApaar(deps, office, {
      institutionId: t.institutionId,
      csv: csv([
        `Synthetic Student Apaar,${PEN},111122223333`,
        'Someone Else,20249999999,111122224444',
        'Bad Number,123,111122225555',
      ]),
      apply: true,
    });
    expect(r.rows.map((x) => x.outcome)).toEqual(['no_consent', 'unknown_pen', 'invalid_pen']);
    expect(r.stored).toBe(0);
    const mismatch = await reconcileApaar(deps, office, {
      institutionId: t.institutionId,
      csv: csv([`Different Child,${PEN},111122223333`]),
      apply: false,
    });
    expect(mismatch.rows[0]?.outcome).toBe('name_mismatch');
    await expect(
      reconcileApaar(deps, office, {
        institutionId: t.institutionId,
        csv: 'Name,PEN\nX,1',
        apply: false,
      }),
    ).rejects.toMatchObject({ code: 'missing_columns' });
  });

  it('stores the ID, sealed, once a verified guardian has allowed APAAR', async () => {
    await withTenant(db, t.orgId, async (tx) => {
      const body = 'Synthetic notice: we create or link your child’s APAAR ID.';
      const [n] = await tx.execute<{ id: string }>(sql`
        insert into consent_notice (org_id, purpose, version, language, body_sha256, body)
        values (app_current_org(), 'apaar_id', 1, 'en', ${createHash('sha256').update(body).digest('hex')}, ${body})
        returning id::text`);
      await tx.execute(sql`
        insert into consent_record (org_id, student_person_id, guardian_person_id, notice_id, purpose, decision, source)
        values (app_current_org(), ${t.studentId}, ${t.guardianId}, ${n!.id}, 'apaar_id', 'granted', 'paper')`);
    });
    // Granted, but the guardian isn't verified yet: still no consent that counts.
    const unverified = await reconcileApaar(deps, office, {
      institutionId: t.institutionId,
      csv: csv([`Synthetic Student Apaar,${PEN},111122223333`]),
      apply: false,
    });
    expect(unverified.rows[0]?.outcome).toBe('no_consent');
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into consent_guardian_check (org_id, guardian_person_id, outcome, method, checked_by_person_id)
        values (app_current_org(), ${t.guardianId}, 'verified', 'known_record', ${office.personId})`),
    );
    const dry = await reconcileApaar(deps, office, {
      institutionId: t.institutionId,
      csv: csv([`Synthetic Student Apaar,${PEN},111122223333`]),
      apply: false,
    });
    expect(dry).toMatchObject({ stored: 0, counts: { store: 1 } });
    await expect(
      reconcileApaar(deps, viewer, {
        institutionId: t.institutionId,
        csv: csv([`Synthetic Student Apaar,${PEN},111122223333`]),
        apply: true,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    const done = await reconcileApaar(deps, office, {
      institutionId: t.institutionId,
      csv: csv([`Synthetic Student Apaar,${PEN},111122223333`]),
      apply: true,
    });
    expect(done.stored).toBe(1);
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ status: string; last4: string; sealed: Buffer }>(sql`
        select apaar_status as status, apaar_last4 as last4, apaar_sealed as sealed
        from student_profile where person_id = ${t.studentId}`),
    );
    expect(row).toMatchObject({ status: 'present', last4: '3333' });
    expect(row!.sealed.includes(Buffer.from('111122223333'))).toBe(false);
  });
});
