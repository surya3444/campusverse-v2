import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { udiseReadiness, type ReturnsDeps } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: ReturnsDeps = { db, permissions: createPermissions(null) };
let t: SeededTenant;
let office: Actor;
let clerk: Actor;

beforeAll(async () => {
  t = await seedTenant(db, 'Returns');
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['school.returns.read']),
  };
  clerk = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['people.student.read']),
  };
});
afterAll(() => close());

describe('UDISE+ readiness', () => {
  it('lists each current student with what is missing, and counts it', async () => {
    const before = await udiseReadiness(deps, office, t.institutionId);
    const row = before.rows.find((r) => r.personId === t.studentId);
    expect(row).toBeDefined();
    expect(row!.classLabel).toBeTruthy();
    expect(row!.missing).toContain('pen');
    expect(before.missing.pen).toBeGreaterThanOrEqual(1);

    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update student_profile set pen = '20230101234', apaar_status = 'refused', apaar_note = 'Declined',
          gender = 'female'
        where person_id = ${t.studentId}`),
    );
    const after = await udiseReadiness(deps, office, t.institutionId);
    const fixed = after.rows.find((r) => r.personId === t.studentId)!;
    expect(fixed.pen).toBe('20230101234');
    expect(fixed.missing).not.toContain('pen');
    expect(fixed.missing).not.toContain('apaar');
  });

  it('staff without the permission are refused', async () => {
    await expect(udiseReadiness(deps, clerk, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});
