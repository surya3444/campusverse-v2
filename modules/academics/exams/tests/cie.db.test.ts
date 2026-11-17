// CIE components (rule book §13.2: "CIE Plan: weighted components from the regulation";
// "Gradebook: marks per component"): the plan is set on the regulation's course and frozen with
// it; teachers enter a score per component and the internal mark is worked out. Synthetic data.
import {
  addBatch,
  addProgram,
  batchView,
  draftRegulation,
  enrolStudent,
  publishRegulation,
  setCurriculumCourse,
} from '@campusverse/academics-structure';
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { marksSheet, saveMarks, type ExamDeps } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: ExamDeps = { db, permissions: createPermissions(null) };
const PLAN = [
  { name: 'Test 1', maxMarks: 50, weight: 40 },
  { name: 'Test 2', maxMarks: 50, weight: 40 },
  { name: 'Assignment', maxMarks: 10, weight: 20 },
];

let t: SeededTenant;
let dean: Actor;
let teacher: Actor;
let batchId: string;
let regulationId: string;
let courseId: string;
let plainId: string;
let student: string;

beforeAll(async () => {
  t = await seedTenant(db, 'Cie');
  const collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'VTU', 'Synthetic CIE College'
      from institution where org_id = app_current_org() and id = ${t.institutionId} returning id::text`);
    return r!.id;
  });
  const actor = async (grants: string[]): Promise<Actor> => ({
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, grants),
  });
  dean = await actor([
    'academics.structure.read',
    'academics.structure.manage',
    'academics.enrolment.manage',
  ]);
  teacher = await actor(['academics.exam.marks']);
  const programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BCOM',
    name: 'B.Com.',
    level: 'ug',
    termKind: 'semester',
    terms: 6,
    framework: null,
  });
  regulationId = await draftRegulation(deps, dean, {
    programId,
    code: 'R26',
    effectiveFrom: '2026-06-01',
    minCredits: null,
  });
  const course = (code: string, cieComponents: typeof PLAN | null) =>
    setCurriculumCourse(deps, dean, {
      regulationId,
      code,
      title: `Course ${code}`,
      termNumber: 1,
      kind: 'core',
      lecture: 4,
      tutorial: 0,
      practical: 0,
      credits: 4,
      cieComponents,
    });
  await expect(
    course('CM101', [{ name: 'Test 1', maxMarks: 50, weight: 60 }]),
  ).rejects.toMatchObject({ code: 'cie_plan_invalid' });
  courseId = await course('CM101', PLAN);
  plainId = await course('CM102', null);
  await publishRegulation(deps, dean, regulationId);
  batchId = await addBatch(deps, dean, {
    programId,
    regulationId,
    startYear: 2026,
    label: null,
    intake: null,
    sections: ['A'],
    capacity: 60,
    startsOn: '2026-07-01',
    endsOn: '2026-11-30',
  });
  const sectionId = (await batchView(deps, dean, batchId)).sectionList[0]!.id;
  student = await enrolStudent(deps, dean, {
    batchId,
    sectionId,
    name: 'Synthetic Commerce Student',
    dateOfBirth: null,
    registerNumber: '26CM001',
  });
});
afterAll(() => close());

describe('CIE components', () => {
  it('freezes the plan with the regulation', async () => {
    await expect(
      setCurriculumCourse(deps, dean, {
        regulationId,
        code: 'CM101',
        title: 'Course CM101',
        termNumber: 1,
        kind: 'core',
        lecture: 4,
        tutorial: 0,
        practical: 0,
        credits: 4,
        cieComponents: null,
      }),
    ).rejects.toMatchObject({ code: 'regulation_published' });
  });

  it('takes a score per component and works the internal mark out', async () => {
    const sheet = await marksSheet(deps, teacher, { batchId, courseId });
    expect(sheet.components).toEqual(PLAN);
    expect(sheet.rows[0]).toMatchObject({ scores: [null, null, null], cie: null });
    const save = (row: Partial<Parameters<typeof saveMarks>[2]['rows'][number]>) =>
      saveMarks(deps, teacher, {
        batchId,
        courseId,
        rows: [{ studentId: student, cie: null, see: 50, absent: false, ...row }],
      });
    await expect(save({ cie: 30 })).rejects.toMatchObject({ code: 'scores_needed' });
    await expect(save({ scores: [51, 30, 8] })).rejects.toMatchObject({
      code: 'mark_out_of_range',
    });
    await save({ scores: [45, null, 8] });
    expect((await marksSheet(deps, teacher, { batchId, courseId })).rows[0]).toMatchObject({
      scores: [45, null, 8],
      cie: null,
    });
    await save({ scores: [45, 30, 8] });
    // (40×45/50 + 40×30/50 + 20×8/10) ÷ 100 × 40 = 30.4.
    expect((await marksSheet(deps, teacher, { batchId, courseId })).rows[0]).toMatchObject({
      scores: [45, 30, 8],
      cie: 30.4,
      see: 50,
    });
    // A course without components keeps one typed internal mark.
    await expect(
      saveMarks(deps, teacher, {
        batchId,
        courseId: plainId,
        rows: [{ studentId: student, cie: 30, see: 40, absent: false, scores: [1] }],
      }),
    ).rejects.toMatchObject({ code: 'no_components' });
  });
});
