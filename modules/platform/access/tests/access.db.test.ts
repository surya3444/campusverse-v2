import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AccessError,
  CATALOGUE,
  accessOverview,
  assignAccess,
  createRole,
  decideGrant,
  endAccess,
  setRolePermissions,
} from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let ownerA: Actor;
let ownerB: Actor;
let ownerBAssignment: string;
let teacher: Actor;
let accountsRoleId: string;

const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });

/** A person holding the given role key at organisation scope; returns the person and assignment. */
async function personWithRole(name: string, roleKey: string) {
  return withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), ${name}) returning id::text`);
    const [a] = await tx.execute<{ id: string }>(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select app_current_org(), ${p!.id}, id, 'organisation', app_current_org() from role where key = ${roleKey}
      returning id::text`);
    return { personId: p!.id, assignmentId: a!.id };
  });
}

beforeAll(async () => {
  t = await seedTenant(db, 'Access');
  // The owner role: every catalogue permission, as installRoles gives it.
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (app_current_org(), 'owner', 'Owner') returning id::text`);
    for (const p of Object.keys(CATALOGUE))
      await tx.execute(
        sql`insert into role_grant (org_id, role_id, permission) values (app_current_org(), ${r!.id}, ${p})`,
      );
  });
  ownerA = actor((await personWithRole('Synthetic Owner A', 'owner')).personId);
  const b = await personWithRole('Synthetic Owner B', 'owner');
  ownerB = actor(b.personId);
  ownerBAssignment = b.assignmentId;
  teacher = actor(t.teacherId);
});

afterAll(() => close());

const canTeacher = (permission: string, institutionId: string) =>
  withTenant(db, t.orgId, async (tx) => {
    const [place] = await tx.execute<{ campus: string }>(sql`
      select campus_id::text as campus from institution where org_id = app_current_org() and id = ${t.institutionId}`);
    return (
      await permissions.can(tx, teacher, permission, {
        orgId: t.orgId,
        place: { campusId: place!.campus, institutionId },
      })
    ).allowed;
  });

describe('building a role', () => {
  it('adds ordinary permissions now and holds sensitive ones for a second owner', async () => {
    ({ roleId: accountsRoleId } = await createRole(db, permissions, ownerA, {
      name: 'Accounts clerk',
    }));
    const plan = await setRolePermissions(db, permissions, ownerA, accountsRoleId, [
      'finance.invoice.read',
      'finance.refund.approve',
    ]);
    expect(plan).toEqual({
      add: ['finance.invoice.read'],
      request: ['finance.refund.approve'],
      remove: [],
    });
    const view = await accessOverview(db, permissions, ownerA);
    const role = view.roles.find((r) => r.id === accountsRoleId);
    expect(role).toMatchObject({
      permissions: ['finance.invoice.read'],
      pending: ['finance.refund.approve'],
    });
  });

  it('refuses people without role management, and writes nothing', async () => {
    await expect(createRole(db, permissions, teacher, { name: 'Shadow' })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const view = await accessOverview(db, permissions, ownerA);
    expect(view.roles.some((r) => r.name === 'Shadow')).toBe(false);
  });

  it('keeps the owner and parent roles locked', async () => {
    const view = await accessOverview(db, permissions, ownerA);
    const parent = view.roles.find((r) => r.key === 'parent')!;
    await expect(setRolePermissions(db, permissions, ownerA, parent.id, [])).rejects.toMatchObject({
      code: 'locked',
    });
  });
});

describe('four eyes', () => {
  it('never lets the requester approve their own sensitive grant, in code or in the database', async () => {
    const view = await accessOverview(db, permissions, ownerA);
    const req = view.requests.find((q) => q.roleId === accountsRoleId && q.decision === null)!;
    await expect(
      decideGrant(db, permissions, ownerA, req.id, { decision: 'approved' }),
    ).rejects.toMatchObject({ code: 'own_request' });
    // Even a direct write is refused by the table's check.
    const direct = await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update role_grant_request set decision = 'approved', decided_by_person_id = requested_by_person_id,
          decided_at = now() where org_id = app_current_org() and id = ${req.id}`),
    ).catch((e: { cause?: { code?: string } }) => e.cause?.code);
    expect(direct).toBe('23514');
  });

  it('refuses confirming alone while another owner exists', async () => {
    const view = await accessOverview(db, permissions, ownerA);
    const req = view.requests.find((q) => q.roleId === accountsRoleId && q.decision === null)!;
    await expect(
      decideGrant(db, permissions, ownerA, req.id, { decision: 'confirmed_alone' }),
    ).rejects.toMatchObject({ code: 'not_alone' });
  });

  it('applies the grant once a second owner approves, and records who approved', async () => {
    const view = await accessOverview(db, permissions, ownerB);
    const req = view.requests.find((q) => q.roleId === accountsRoleId && q.decision === null)!;
    await decideGrant(db, permissions, ownerB, req.id, { decision: 'approved' });
    const after = await accessOverview(db, permissions, ownerA);
    expect(after.roles.find((r) => r.id === accountsRoleId)?.permissions).toContain(
      'finance.refund.approve',
    );
    expect(after.requests.find((q) => q.id === req.id)).toMatchObject({
      decision: 'approved',
      decidedBy: ownerB.personId,
      requestedBy: ownerA.personId,
    });
  });
});

describe('assigning access', () => {
  it('gives the role at one institution only, starting today', async () => {
    expect(await canTeacher('finance.invoice.read', t.institutionId)).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    await assignAccess(db, permissions, ownerA, {
      personId: t.teacherId,
      roleId: accountsRoleId,
      scope: { type: 'institution', id: t.institutionId },
      from: today,
      until: null,
    });
    expect(await canTeacher('finance.invoice.read', t.institutionId)).toBe(true);
    expect(await canTeacher('finance.invoice.read', randomUUID())).toBe(false);
  });

  it('refuses to hand out a role holding permissions the assigner lacks', async () => {
    // The seeded principal can't assign anything at all.
    await expect(
      assignAccess(db, permissions, actor(t.principalId), {
        personId: t.teacherId,
        roleId: accountsRoleId,
        scope: { type: 'organisation', id: t.orgId },
        from: '2026-01-01',
        until: null,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('never removes the last owner', async () => {
    const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
    await endAccess(db, permissions, ownerA, ownerBAssignment, yesterday);
    const view = await accessOverview(db, permissions, ownerA);
    expect(view.owners).toEqual([ownerA.personId]);
    const [mine] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select a.id::text from role_assignment a join role r on r.org_id = a.org_id and r.id = a.role_id
        where a.org_id = app_current_org() and r.key = 'owner' and a.person_id = ${ownerA.personId}`),
    );
    const err = await endAccess(db, permissions, ownerA, mine!.id, yesterday).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AccessError);
    expect((err as AccessError).code).toBe('last_owner');
  });
});
