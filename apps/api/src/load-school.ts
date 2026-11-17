// Development only: a large synthetic school for load tests (Milestone 17). 40 sections of 35
// students (1,400), a class teacher with a login per section, and parents with logins. Prints
// a JSON fixture (tokens, ids) for the k6 scripts in load/. Synthetic names and numbers only.
//   pnpm --filter @campusverse/api load-school > /tmp/load-fixture.json
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant, type Tx } from '@campusverse/db';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStudentProfile,
  linkGuardian,
} from '@campusverse/people-records';
import { devSignIn, inviteAccount } from '@campusverse/platform-identity';
import { assignRole, createPermissions } from '@campusverse/platform-permissions';
import { enrol } from '@campusverse/school-enrolment';
import { applyStructure, provisionSchool } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';

const env = loadEnv();
if (env.APP_ENV !== 'development') throw new Error('load-school runs in development only');

const SECTIONS_PER_CLASS = 4;
const STUDENTS_PER_SECTION = 35;
const PARENTS_WITH_LOGIN = 300;

const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const iso = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

const school = await provisionSchool(db, {
  schoolName: 'Synthetic Load School',
  group: null,
  board: 'CBSE',
  state: 'KA',
  owner: { name: 'Owner Load Synthetic', phone: phone().slice(3) },
});
const owner = {
  accountId: school.ownerAccountId,
  orgId: school.orgId,
  personId: school.ownerPersonId,
};
await applyStructure(db, permissions, owner, school.institutionId, {
  board: 'CBSE',
  yearLabel: '2026-27',
  starts: iso(-60),
  ends: iso(300),
  classes: Array.from({ length: 10 }, (_, i) => ({
    code: String(i + 1),
    sections: SECTIONS_PER_CLASS,
    capacity: 40,
  })),
});

async function person(tx: Tx, name: string, mobile: string | null) {
  const id = await createPerson(tx, { legalName: name, source: 'signup' });
  if (mobile) await addPhone(tx, id, mobile);
  return id;
}

const teachers: { personId: string; accountId: string; sectionId: string; students: string[] }[] =
  [];
const parents: { personId: string; accountId: string; childId: string }[] = [];

const sections = await withTenant(db, school.orgId, (tx) =>
  tx.execute<{ id: string }>(
    sql`select id::text from school_section where org_id = app_current_org() order by id`,
  ),
);
let n = 0;
for (const s of sections) {
  await withTenant(db, school.orgId, async (tx) => {
    const mobile = phone();
    const teacherId = await person(tx, `Teacher Synthetic ${n}`, mobile);
    await assignRole(tx, {
      personId: teacherId,
      roleKey: 'teacher',
      scope: { type: 'institution', id: school.institutionId },
    });
    await tx.execute(sql`
      insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, valid_during)
      values (app_current_org(), ${s.id}, ${teacherId}, 'class_teacher', daterange(${iso(-60)}::date, null))`);
    const login = await inviteAccount(tx, {
      orgId: school.orgId,
      personId: teacherId,
      phone: mobile,
    });
    const students: string[] = [];
    for (let r = 1; r <= STUDENTS_PER_SECTION; r++, n++) {
      const id = await createPerson(tx, {
        legalName: `Student Synthetic ${n}`,
        source: 'admission',
      });
      await ensureStudentProfile(tx, id);
      await addMembership(tx, {
        personId: id,
        institutionId: school.institutionId,
        kind: 'student',
        from: iso(-60),
        until: iso(301),
      });
      await enrol(tx, {
        personId: id,
        institutionId: school.institutionId,
        sectionId: s.id,
        admissionNumber: `LOAD-${n}`,
        rollNumber: r,
        from: iso(-60),
        until: iso(301),
      });
      students.push(id);
      if (parents.length < PARENTS_WITH_LOGIN && r <= 8) {
        const pm = phone();
        const parentId = await person(tx, `Parent Synthetic ${n}`, pm);
        await assignRole(tx, {
          personId: parentId,
          roleKey: 'parent',
          scope: { type: 'organisation', id: school.orgId },
        });
        await linkGuardian(tx, {
          guardianId: parentId,
          studentId: id,
          relationship: 'mother',
          primary: true,
        });
        const pl = await inviteAccount(tx, { orgId: school.orgId, personId: parentId, phone: pm });
        parents.push({ personId: parentId, accountId: pl.accountId, childId: id });
      }
    }
    teachers.push({ personId: teacherId, accountId: login.accountId, sectionId: s.id, students });
  });
}

const session = async (accountId: string) =>
  (await devSignIn(db, accountId, 'Load test')).accessToken;
console.log(
  JSON.stringify({
    orgId: school.orgId,
    institutionId: school.institutionId,
    owner: { personId: owner.personId, token: await session(owner.accountId) },
    teachers: await Promise.all(
      teachers.map(async (t) => ({ ...t, token: await session(t.accountId) })),
    ),
    parents: await Promise.all(
      parents.map(async (p) => ({ ...p, token: await session(p.accountId) })),
    ),
  }),
);
await close();
