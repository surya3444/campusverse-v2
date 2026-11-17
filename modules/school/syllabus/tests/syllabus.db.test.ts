// Syllabus across modules (docs/specs/SYLLABUS.md): units only from people who teach the subject in
// that class (or manage), ticks only for sections they teach, coverage and behind flags, units in
// use kept, lesson plans fixed after the next day, and last year's syllabus copied forward.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  classSubjects,
  commitCopy,
  deleteUnit,
  lessonPlans,
  previewCopy,
  saveLessonPlan,
  saveUnit,
  schoolCoverage,
  syllabusPlan,
  tickUnit,
  type SyllabusDeps,
} from '@campusverse/school-syllabus';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: SyllabusDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let teacher: Actor;
let stranger: Actor;
let head: Actor;
let classId: string;
let subjectId: string;
let sectionId: string;
let today: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Syllabus');
  // The seed's class teacher of 5-A gets the teacher's syllabus grants.
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (${t.orgId}, 'syllabus_teacher', 'Teacher') returning id::text`);
    for (const p of ['school.syllabus.read', 'school.syllabus.teach'])
      await tx.execute(
        sql`insert into role_grant (org_id, role_id, permission) values (${t.orgId}, ${r?.id}, ${p})`,
      );
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (${t.orgId}, ${t.teacherId}, ${r?.id}, 'organisation', ${t.orgId})`);
  });
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
  stranger = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['school.syllabus.read', 'school.syllabus.teach']),
  };
  head = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'school.syllabus.read',
      'school.syllabus.teach',
      'school.syllabus.manage',
    ]),
  };
  const classes = await classSubjects(deps, teacher, t.institutionId);
  classId = classes[0]?.classId ?? '';
  subjectId = classes[0]?.subjects.find((s) => s.name === 'English')?.subjectId ?? '';
  ({ sectionId, today } = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ sectionId: string; today: string }>(sql`
      select id::text as "sectionId", app_today()::text as today from school_section
      where org_id = app_current_org() and class_id = ${classId}`);
    return r ?? { sectionId: '', today: '' };
  }));
});
afterAll(() => close());

describe('the plan', () => {
  it('lets the class teacher plan units, not a teacher from elsewhere', async () => {
    const classes = await classSubjects(deps, teacher, t.institutionId);
    expect(classes[0]).toMatchObject({
      className: 'Class 5',
      subjects: expect.arrayContaining([expect.objectContaining({ name: 'English', mine: true })]),
    });
    const unit = {
      institutionId: t.institutionId,
      classId,
      subjectId,
      id: null,
      title: 'Synthetic Grammar: Nouns',
      plannedMonth: '2026-08-01',
      periods: 6,
      notes: '',
    };
    await saveUnit(deps, teacher, unit);
    expect(await code(saveUnit(deps, stranger, { ...unit, title: 'Not theirs' }))).toBe('denied');
    await saveUnit(deps, head, {
      ...unit,
      title: 'Synthetic Letter Writing',
      plannedMonth: '2027-02-01',
    });
    const plan = await syllabusPlan(deps, stranger, {
      institutionId: t.institutionId,
      classId,
      subjectId,
    });
    expect(plan.units.map((u) => [u.position, u.title])).toEqual([
      [1, 'Synthetic Poems'],
      [2, 'Synthetic Grammar: Nouns'],
      [3, 'Synthetic Letter Writing'],
    ]);
    // June and August are due by November; only June is ticked: 5-A is behind.
    expect(plan.sections[0]).toMatchObject({
      total: 3,
      done: 1,
      expected: 2,
      behind: true,
      percent: 33,
    });
    expect(plan.canEdit).toBe(false);
  });
});

describe('ticks and units in use', () => {
  it('ticks for sections the person teaches, once, never in the future', async () => {
    const plan = await syllabusPlan(deps, teacher, {
      institutionId: t.institutionId,
      classId,
      subjectId,
    });
    const nouns = plan.units.find((u) => u.title === 'Synthetic Grammar: Nouns')?.unitId ?? '';
    const tick = (who: Actor, more: Partial<Parameters<typeof tickUnit>[2]> = {}) =>
      tickUnit(deps, who, {
        institutionId: t.institutionId,
        unitId: nouns,
        sectionId,
        done: true,
        ...more,
      });
    expect(await code(tick(stranger))).toBe('denied');
    expect(await code(tick(teacher, { onDate: '2099-01-01' }))).toBe('bad_date');
    await tick(teacher);
    expect(await code(tick(teacher))).toBe('already_done');
    const after = await syllabusPlan(deps, head, {
      institutionId: t.institutionId,
      classId,
      subjectId,
    });
    expect(after.sections[0]).toMatchObject({ done: 2, behind: false });
    // Ticked units stay; unticked unused ones can go.
    expect(
      await code(deleteUnit(deps, teacher, { institutionId: t.institutionId, unitId: nouns })),
    ).toBe('unit_in_use');
    const letters = after.units.find((u) => u.title === 'Synthetic Letter Writing')?.unitId ?? '';
    await deleteUnit(deps, head, { institutionId: t.institutionId, unitId: letters });
    const cov = await schoolCoverage(deps, stranger, t.institutionId);
    expect(cov.rows.find((r) => r.subjectId === subjectId)).toMatchObject({
      units: 2,
      sections: [expect.objectContaining({ done: 2, percent: 100, behind: false })],
    });
  });
});

describe('lesson plans', () => {
  it('one per section, subject and day, editable until the day after', async () => {
    const plan = (who: Actor, onDate: string) =>
      saveLessonPlan(deps, who, {
        institutionId: t.institutionId,
        sectionId,
        subjectId,
        onDate,
        unitId: null,
        plan: 'Synthetic: nouns in the classroom, then a worksheet',
      });
    await plan(teacher, today);
    await plan(teacher, today); // an edit, not a second plan
    expect(await code(plan(stranger, today))).toBe('denied');
    expect(await code(plan(teacher, '2026-07-01'))).toBe('plan_fixed');
    const list = await lessonPlans(deps, stranger, {
      institutionId: t.institutionId,
      sectionId,
      subjectId,
      from: '2026-07-01',
      to: today,
    });
    expect(list.map((l) => [l.onDate, l.editable])).toEqual([
      ['2026-07-01', false],
      [today, true],
    ]);
  });
});

describe('copy from last year', () => {
  it('copies units for subjects with none this year, months moved on a year', async () => {
    const mathsId = await withTenant(db, t.orgId, async (tx) => {
      const [y] = await tx.execute<{ id: string }>(sql`
        insert into school_year (org_id, institution_id, label, valid_during, status)
        values (${t.orgId}, ${t.institutionId}, '2025-26', daterange('2025-04-01', '2026-04-01'), 'closed')
        returning id::text`);
      const [m] = await tx.execute<{ id: string }>(sql`
        insert into school_subject (org_id, institution_id, code, name) values (${t.orgId}, ${t.institutionId}, 'MAT', 'Maths')
        returning id::text`);
      await tx.execute(sql`
        insert into school_syllabus_unit (org_id, year_id, class_id, subject_id, position, title, planned_month)
        values (${t.orgId}, ${y?.id}, ${classId}, ${m?.id}, 1, 'Synthetic Fractions', '2025-07-01'),
          (${t.orgId}, ${y?.id}, ${classId}, ${subjectId}, 1, 'Old English unit', '2025-06-01')`);
      return m?.id ?? '';
    });
    expect(await code(previewCopy(deps, teacher, t.institutionId))).toBe('denied');
    // English already has units this year, so only Maths comes across.
    expect(await previewCopy(deps, head, t.institutionId)).toEqual({
      from: '2025-26',
      to: '2026-27',
      subjects: 1,
      units: 1,
    });
    expect(await commitCopy(deps, head, t.institutionId)).toEqual({ subjects: 1, units: 1 });
    const [copied] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ month: string }>(sql`
        select u.planned_month::text as month from school_syllabus_unit u join school_year y on y.org_id = u.org_id
          and y.id = u.year_id where u.org_id = app_current_org() and u.subject_id = ${mathsId} and y.label = '2026-27'`),
    );
    expect(copied?.month).toBe('2026-07-01');
    expect(await code(commitCopy(deps, head, t.institutionId))).toBe('nothing_to_copy');
  });
});
