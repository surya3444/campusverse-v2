// Permission matrix against real Postgres and Redis: allowed and denied cases for each role,
// scope, relationship and state, including restricted guardians, expiry and cache invalidation.
import { loadEnv } from '@campusverse/config';
import { createDb, createRedis, schema, withTenant } from '@campusverse/db';
import { seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPermissions, type Actor, type Decision, type Resource } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const permissions = createPermissions(redis);

let a: SeededTenant;
let b: SeededTenant;
// Extra people in tenant A, created below.
const p = {} as Record<
  | 'restrictedGuardian'
  | 'noLoginGuardian'
  | 'feePayer'
  | 'expiredPrincipal'
  | 'expiredDuty'
  | 'otherStudent',
  string
>;
let otherSchool: { campusId: string; institutionId: string };

const actor = (orgId: string, personId: string): Actor => ({ accountId: 'n/a', orgId, personId });
const check = (who: Actor, permission: string, r: Resource): Promise<Decision> =>
  withTenant(db, who.orgId, (tx) => permissions.can(tx, who, permission, r));

beforeAll(async () => {
  a = await seedTenant(db, 'Matrix A');
  b = await seedTenant(db, 'Matrix B');

  await withTenant(db, a.orgId, async (tx) => {
    const names = Object.keys({
      restrictedGuardian: 0,
      noLoginGuardian: 0,
      feePayer: 0,
      expiredPrincipal: 0,
      expiredDuty: 0,
      otherStudent: 0,
    }) as (keyof typeof p)[];
    const rows = await tx
      .insert(schema.person)
      .values(names.map((n) => ({ orgId: a.orgId, legalName: `Synthetic ${n}` })))
      .returning({ id: schema.person.id });
    names.forEach((n, i) => (p[n] = rows[i]!.id));

    const roles = await tx.select().from(schema.role).where(eq(schema.role.orgId, a.orgId));
    const principalRole = roles.find((r) => r.key === 'principal')!.id;
    const parentRole = roles.find((r) => r.key === 'parent')!.id;

    await tx.insert(schema.roleGrant).values({
      orgId: a.orgId,
      roleId: parentRole,
      permission: 'finance.invoice.read',
      relation: 'guardian',
      guardianFlag: 'is_fee_payer',
    });

    const parent = {
      orgId: a.orgId,
      roleId: parentRole,
      scopeType: 'organisation' as const,
      scopeId: a.orgId,
    };
    await tx.insert(schema.roleAssignment).values([
      { ...parent, personId: p.restrictedGuardian },
      { ...parent, personId: p.noLoginGuardian },
      { ...parent, personId: p.feePayer },
      {
        orgId: a.orgId,
        personId: p.expiredPrincipal,
        roleId: principalRole,
        scopeType: 'institution',
        scopeId: a.institutionId,
        validDuring: sql`daterange(app_today() - 30, app_today())`,
      },
    ]);
    const link = { orgId: a.orgId, studentPersonId: a.studentId, relationship: 'father' as const };
    await tx.insert(schema.guardianLink).values([
      {
        ...link,
        guardianPersonId: p.restrictedGuardian,
        // Fee payer too, so only the restriction stands between them and the invoices.
        isFeePayer: true,
        restrictedAt: new Date(),
        restrictionReason: 'Court order on file',
      },
      { ...link, guardianPersonId: p.noLoginGuardian, canLogin: false },
      { ...link, guardianPersonId: p.feePayer, relationship: 'guardian', isFeePayer: true },
    ]);
    await tx.insert(schema.staffDuty).values({
      orgId: a.orgId,
      personId: p.expiredDuty,
      duty: 'exam_superintendent',
      roleId: principalRole,
      scopeType: 'institution',
      scopeId: a.institutionId,
      validDuring: sql`daterange(app_today() - 10, app_today() - 3)`,
    });

    const [campus2] = await tx
      .insert(schema.campus)
      .values({ orgId: a.orgId, name: 'Matrix A North Campus' })
      .returning({ id: schema.campus.id });
    const [school2] = await tx
      .insert(schema.institution)
      .values({
        orgId: a.orgId,
        campusId: campus2!.id,
        legalEntityId: a.legalEntityId,
        type: 'school',
        authorityCode: 'CBSE',
        name: 'Matrix A North School',
      })
      .returning({ id: schema.institution.id });
    otherSchool = { campusId: campus2!.id, institutionId: school2!.id };
  });
});

afterAll(async () => {
  redis.disconnect();
  await close();
});

const READ = 'people.student.read';
const INVOICES = 'finance.invoice.read';

describe('permission matrix', () => {
  // [case, actor, permission, resource, expected]
  const cases: [string, () => Actor, string, () => Resource, true | string][] = [
    [
      'principal reads a student in their school',
      () => actor(a.orgId, a.principalId),
      READ,
      () => student(),
      true,
    ],
    [
      'principal is out of scope in another school',
      () => actor(a.orgId, a.principalId),
      READ,
      () => student({ place: otherSchool }),
      'out_of_scope',
    ],
    [
      'principal cannot read at organisation level',
      () => actor(a.orgId, a.principalId),
      READ,
      () => ({ orgId: a.orgId }),
      'out_of_scope',
    ],
    [
      'principal lacks an ungranted permission',
      () => actor(a.orgId, a.principalId),
      'finance.receipt.void',
      () => student(),
      'no_grant',
    ],
    [
      'principal is denied when module state is closed',
      () => actor(a.orgId, a.principalId),
      READ,
      () => student({ stateAllows: false }),
      'state_closed',
    ],
    [
      'principal of tenant A cannot reach tenant B data',
      () => actor(a.orgId, a.principalId),
      READ,
      () => ({ orgId: b.orgId, place: { campusId: b.campusId, institutionId: b.institutionId } }),
      'other_tenant',
    ],
    [
      'ended assignment grants nothing',
      () => actor(a.orgId, p.expiredPrincipal),
      READ,
      () => student(),
      'no_grant',
    ],
    [
      'active exam duty grants its role',
      () => actor(a.orgId, a.teacherId),
      READ,
      () => student(),
      true,
    ],
    [
      'ended exam duty grants nothing',
      () => actor(a.orgId, p.expiredDuty),
      READ,
      () => student(),
      'no_grant',
    ],
    [
      'guardian reads their own child',
      () => actor(a.orgId, a.guardianId),
      READ,
      () => student(),
      true,
    ],
    [
      'guardian cannot read another child',
      () => actor(a.orgId, a.guardianId),
      READ,
      () => student({ subjectPersonId: p.otherStudent }),
      'no_relationship',
    ],
    [
      'guardian who is not fee payer cannot see invoices',
      () => actor(a.orgId, a.guardianId),
      INVOICES,
      () => student(),
      'no_relationship',
    ],
    [
      'fee-paying guardian sees invoices',
      () => actor(a.orgId, p.feePayer),
      INVOICES,
      () => student(),
      true,
    ],
    [
      'restricted guardian is blocked from the record',
      () => actor(a.orgId, p.restrictedGuardian),
      READ,
      () => student(),
      'no_relationship',
    ],
    [
      'restricted guardian is blocked from invoices',
      () => actor(a.orgId, p.restrictedGuardian),
      INVOICES,
      () => student(),
      'no_relationship',
    ],
    [
      'guardian without app login is blocked',
      () => actor(a.orgId, p.noLoginGuardian),
      READ,
      () => student(),
      'no_relationship',
    ],
    [
      'student with no role gets nothing',
      () => actor(a.orgId, a.studentId),
      READ,
      () => student(),
      'no_grant',
    ],
  ];

  it.each(cases)('%s', async (_, who, permission, resource, expected) => {
    const decision = await check(who(), permission, resource());
    expect(decision).toEqual(
      expected === true ? { allowed: true } : { allowed: false, reason: expected },
    );
  });

  it("refuses to evaluate inside another tenant's transaction", async () => {
    const who = actor(a.orgId, a.principalId);
    await expect(
      withTenant(db, b.orgId, (tx) => permissions.can(tx, who, READ, student())),
    ).rejects.toThrow(/not scoped/);
  });

  it('assertCan throws PermissionDenied with the reason', async () => {
    const who = actor(a.orgId, a.studentId);
    await expect(
      withTenant(db, a.orgId, (tx) => permissions.assertCan(tx, who, READ, student())),
    ).rejects.toMatchObject({ name: 'PermissionDenied', reason: 'no_grant' });
  });
});

describe('permission cache', () => {
  it('serves from Redis and goes stale the moment a role changes', async () => {
    const t = await seedTenant(db, 'Cache');
    const who = actor(t.orgId, t.principalId);
    const r: Resource = {
      orgId: t.orgId,
      place: { campusId: t.campusId, institutionId: t.institutionId },
      subjectPersonId: t.studentId,
    };
    const ask = () => withTenant(db, t.orgId, (tx) => permissions.can(tx, who, READ, r));

    expect((await ask()).allowed).toBe(true);
    expect(await redis.keys(`perm:${t.orgId}:${t.principalId}:*`)).toHaveLength(1);

    // End the assignment today. The trigger bumps the org's permission_version.
    await withTenant(db, t.orgId, (tx) =>
      tx
        .update(schema.roleAssignment)
        .set({ validDuring: sql`daterange(lower(valid_during), app_today())` })
        .where(
          and(
            eq(schema.roleAssignment.orgId, t.orgId),
            eq(schema.roleAssignment.personId, t.principalId),
          ),
        ),
    );
    expect(await ask()).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('restricting a guardian takes effect immediately despite a warm cache', async () => {
    const t = await seedTenant(db, 'Restrict');
    const who = actor(t.orgId, t.guardianId);
    const r: Resource = { orgId: t.orgId, subjectPersonId: t.studentId };
    const ask = () => withTenant(db, t.orgId, (tx) => permissions.can(tx, who, READ, r));

    expect((await ask()).allowed).toBe(true);
    await withTenant(db, t.orgId, (tx) =>
      tx
        .update(schema.guardianLink)
        .set({ restrictedAt: new Date(), restrictionReason: 'Safeguarding review' })
        .where(eq(schema.guardianLink.guardianPersonId, t.guardianId)),
    );
    expect(await ask()).toEqual({ allowed: false, reason: 'no_relationship' });
  });

  it('falls back to Postgres when Redis is down', async () => {
    const dead = createRedis('redis://localhost:1');
    dead.on('error', () => {});
    const offline = createPermissions(dead);
    const who = actor(a.orgId, a.principalId);
    const decision = await withTenant(db, a.orgId, (tx) => offline.can(tx, who, READ, student()));
    expect(decision).toEqual({ allowed: true });
    dead.disconnect();
  });
});

function student(over: Partial<Resource> = {}): Resource {
  return {
    orgId: a.orgId,
    place: { campusId: a.campusId, institutionId: a.institutionId },
    subjectPersonId: a.studentId,
    ...over,
  };
}
