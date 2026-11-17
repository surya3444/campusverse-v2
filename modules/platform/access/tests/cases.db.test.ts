import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseGrants, dataClassOf, endCase, explainAccess, grantCase } from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const deps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let dpo: Actor;
let principal: Actor;
let viewer: Actor;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const can = (who: Actor, permission: string, subjectPersonId: string) =>
  withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ campusId: string }>(sql`
      select campus_id::text as "campusId" from institution where id = ${t.institutionId}`);
    return deps.permissions.can(tx, who, permission, {
      orgId: t.orgId,
      place: { campusId: p!.campusId, institutionId: t.institutionId },
      subjectPersonId,
    });
  });

beforeAll(async () => {
  t = await seedTenant(db, 'Cases');
  dpo = actor(await seedAdmin(db, t.orgId, ['platform.privacy.manage', 'platform.role.read']));
  principal = actor(await seedAdmin(db, t.orgId, ['health.report.read']));
  viewer = actor(await seedAdmin(db, t.orgId, ['platform.role.read']));
});
afterAll(() => close());

describe('case grants and the four-part check (rule book §10.3)', () => {
  it('every permission has a data class; health records are sensitive, totals are not', () => {
    expect(dataClassOf('health.record.read')).toBe('sensitive');
    expect(dataClassOf('health.report.read')).toBe('internal');
    expect(dataClassOf('payroll.run.approve')).toBe('financial');
    expect(dataClassOf('people.student.read')).toBe('personal');
  });

  it('a principal sees totals, not a named record, until the DPO grants it for a case', async () => {
    expect(await can(principal, 'health.record.read', t.studentId)).toMatchObject({
      allowed: false,
    });
    await expect(
      grantCase(deps, dpo, {
        granteeId: principal.personId,
        permission: 'people.student.read',
        subjectId: t.studentId,
        reason: 'Not a sensitive permission at all',
        hours: 24,
      }),
    ).rejects.toMatchObject({ code: 'not_sensitive' });
    await expect(
      grantCase(deps, dpo, {
        granteeId: dpo.personId,
        permission: 'health.record.read',
        subjectId: t.studentId,
        reason: 'Granting it to myself for a case',
        hours: 24,
      }),
    ).rejects.toMatchObject({ code: 'own_request' });
    await expect(
      grantCase(deps, principal, {
        granteeId: viewer.personId,
        permission: 'health.record.read',
        subjectId: t.studentId,
        reason: 'The principal can’t grant cases',
        hours: 24,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });

    const id = await grantCase(deps, dpo, {
      granteeId: principal.personId,
      permission: 'health.record.read',
      subjectId: t.studentId,
      reason: 'Parent complaint about care in the sick room',
      hours: 500,
    });
    expect(await can(principal, 'health.record.read', t.studentId)).toEqual({
      allowed: true,
      case: id,
    });
    // Only that permission, only that student.
    expect(await can(principal, 'health.record.read', t.guardianId)).toMatchObject({
      allowed: false,
    });
    expect(await can(principal, 'health.record.update', t.studentId)).toMatchObject({
      allowed: false,
    });

    const rows = await caseGrants(deps, dpo);
    expect(rows[0]).toMatchObject({ id, running: true, permission: 'health.record.read' });
    // Capped at a week.
    expect(
      new Date(rows[0]!.expiresAt).getTime() - new Date(rows[0]!.grantedAt).getTime(),
    ).toBeLessThanOrEqual(7 * 24 * 3_600_000);
    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ dataClass: string; reason: string }>(sql`
        select data_class as "dataClass", reason from audit_event
        where action = 'platform.access.case_grant' and entity_id = ${t.studentId}`),
    );
    expect(audit).toEqual({
      dataClass: 'sensitive',
      reason: 'Parent complaint about care in the sick room',
    });

    // The explanation shows the case, and that no role carries the permission.
    const why = await explainAccess(deps, viewer, {
      personId: principal.personId,
      permission: 'health.record.read',
      institutionId: t.institutionId,
      subjectId: t.studentId,
    });
    expect(why).toMatchObject({
      decision: { allowed: true, case: id },
      dataClass: 'sensitive',
      roles: [],
    });

    await endCase(deps, dpo, id);
    expect(await can(principal, 'health.record.read', t.studentId)).toMatchObject({
      allowed: false,
    });
    await expect(endCase(deps, dpo, id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update access_case_grant set reason = 'changed later' where id = ${id}`),
      ),
    ).rejects.toThrow();
  });

  it('explains a role’s reach and a missing grant', async () => {
    const yes = await explainAccess(deps, viewer, {
      personId: principal.personId,
      permission: 'health.report.read',
      institutionId: t.institutionId,
      subjectId: null,
    });
    expect(yes).toMatchObject({ decision: { allowed: true }, dataClass: 'internal' });
    expect(yes.roles).toHaveLength(1);
    expect(yes.roles[0]).toMatchObject({ scope: 'organisation', reaches: true });
    const no = await explainAccess(deps, viewer, {
      personId: principal.personId,
      permission: 'payroll.run.approve',
      institutionId: t.institutionId,
      subjectId: null,
    });
    expect(no).toMatchObject({
      decision: { allowed: false, reason: 'no_grant' },
      dataClass: 'financial',
      roles: [],
    });
    await expect(
      explainAccess(deps, principal, {
        personId: viewer.personId,
        permission: 'health.report.read',
        institutionId: null,
        subjectId: null,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
  });
});
