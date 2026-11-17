// OBE (rule book §13.2; P1 item 17): versioned programme outcomes, COs with the CO–PO/PSO matrix
// and tagged items, and direct attainment from a published term's marks, POs from COs only.
// All data synthetic.
import { saveMarks } from '@campusverse/academics-exams';
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
import {
  attainment,
  courseOutcomes,
  draftOutcomeSet,
  outcomeSets,
  publishOutcomeSet,
  saveCourseOutcomes,
  saveOutcomeSet,
  type ObeDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: ObeDeps = { db, permissions: createPermissions(null) };
const SETTINGS = {
  targetPercent: 60,
  level1Percent: 50,
  level2Percent: 60,
  level3Percent: 70,
  cieWeight: 40,
  targetLevel: 2,
};

let t: SeededTenant;
let dean: Actor;
let iqac: Actor;
let viewer: Actor;
let teacher: Actor;
let programId: string;
let regulationId: string;
let batchId: string;
const course: Record<string, string> = {};
const students: string[] = [];

beforeAll(async () => {
  t = await seedTenant(db, 'Obe');
  const collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'VTU', 'Synthetic OBE College'
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
  iqac = await actor(['academics.obe.manage']);
  viewer = await actor(['academics.obe.read']);
  teacher = await actor(['academics.exam.marks']);
  programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BE-CS',
    name: 'B.E. Computer Science',
    level: 'ug',
    termKind: 'semester',
    terms: 8,
    framework: null,
  });
  regulationId = await draftRegulation(deps, dean, {
    programId,
    code: 'R26',
    effectiveFrom: '2026-06-01',
    minCredits: null,
  });
  course.CS101 = await setCurriculumCourse(deps, dean, {
    regulationId,
    code: 'CS101',
    title: 'Programming',
    termNumber: 1,
    kind: 'core',
    lecture: 3,
    tutorial: 0,
    practical: 2,
    credits: 4,
  });
  course.CS102 = await setCurriculumCourse(deps, dean, {
    regulationId,
    code: 'CS102',
    title: 'Discrete Maths',
    termNumber: 1,
    kind: 'core',
    lecture: 4,
    tutorial: 0,
    practical: 0,
    credits: 4,
    cieComponents: [
      { name: 'Test', maxMarks: 50, weight: 70 },
      { name: 'Assignment', maxMarks: 10, weight: 30 },
    ],
  });
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
    endsOn: '2026-12-15',
  });
  const sectionId = (await batchView(deps, dean, batchId)).sectionList[0]!.id;
  for (const n of [1, 2, 3, 4])
    students.push(
      await enrolStudent(deps, dean, {
        batchId,
        sectionId,
        name: `Synthetic Engineer ${n}`,
        dateOfBirth: null,
        registerNumber: `26CS00${n}`,
      }),
    );
  // CS101: internal (of 40) 30, 20, 26, 25; end exam (of 60) 40, absent, 30, 36.
  await saveMarks(deps, teacher, {
    batchId,
    courseId: course.CS101,
    rows: [
      [30, 40, false],
      [20, null, true],
      [26, 30, false],
      [25, 36, false],
    ].map(([cie, see, absent], i) => ({
      studentId: students[i]!,
      cie: cie as number,
      see: see as number | null,
      absent: absent as boolean,
    })),
  });
  // CS102: test (of 50) 40, 20, 30, 45 → 3 of 4 reach 60%.
  await saveMarks(deps, teacher, {
    batchId,
    courseId: course.CS102,
    rows: [
      [40, 2],
      [20, 9],
      [30, 6],
      [45, 10],
    ].map((scores, i) => ({ studentId: students[i]!, cie: null, see: 45, absent: false, scores })),
  });
});
afterAll(() => close());

const publishTerm = () =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into exam_result (org_id, batch_id, term_number, state, grading, requested_by_person_id, decided_at)
      values (app_current_org(), ${batchId}, 1, 'published', '{"ciePercent":40}'::jsonb, ${dean.personId}, now())`),
  );

describe('OBE', () => {
  let setId: string;

  it('drafts, saves and publishes versioned programme outcomes; a published set is frozen', async () => {
    await expect(
      draftOutcomeSet(deps, viewer, { programId, effectiveFrom: '2026-06-01' }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    setId = await draftOutcomeSet(deps, iqac, { programId, effectiveFrom: '2026-06-01' });
    await expect(
      draftOutcomeSet(deps, iqac, { programId, effectiveFrom: '2026-06-01' }),
    ).rejects.toMatchObject({
      code: 'draft_exists',
    });
    await expect(publishOutcomeSet(deps, iqac, setId)).rejects.toMatchObject({
      code: 'no_outcomes',
    });
    const outcomes = [
      { kind: 'peo' as const, code: 'PEO1', statement: 'Graduates build careers in computing' },
      { kind: 'po' as const, code: 'PO1', statement: 'Apply engineering knowledge' },
      { kind: 'po' as const, code: 'PO2', statement: 'Analyse problems' },
      { kind: 'pso' as const, code: 'PSO1', statement: 'Design software systems' },
    ];
    await expect(
      saveOutcomeSet(deps, iqac, {
        setId,
        vision: null,
        mission: null,
        ...SETTINGS,
        level2Percent: 40,
        outcomes,
      }),
    ).rejects.toMatchObject({ code: 'settings_invalid' });
    await saveOutcomeSet(deps, iqac, {
      setId,
      vision: 'Synthetic vision',
      mission: 'Synthetic mission',
      ...SETTINGS,
      outcomes,
    });
    await publishOutcomeSet(deps, iqac, setId);
    await expect(
      saveOutcomeSet(deps, iqac, { setId, vision: null, mission: null, ...SETTINGS, outcomes }),
    ).rejects.toMatchObject({ code: 'set_published' });
    const [s] = await outcomeSets(deps, viewer, programId);
    expect(s).toMatchObject({ version: 1, status: 'published', vision: 'Synthetic vision' });
    expect(s!.outcomes.map((o) => o.code)).toEqual(['PEO1', 'PO1', 'PO2', 'PSO1']);
  });

  it('keeps COs with their matrix row and the items that measure them', async () => {
    await saveCourseOutcomes(deps, iqac, {
      regulationId,
      courseId: course.CS101!,
      cos: [
        {
          code: 'CO1',
          statement: 'Write small programs',
          mappings: { PO1: 3, PO2: 1 },
          items: ['cie', 'see'],
        },
        { code: 'CO2', statement: 'Trace and debug code', mappings: { PO2: 2 }, items: ['see'] },
      ],
    });
    await expect(
      saveCourseOutcomes(deps, iqac, {
        regulationId,
        courseId: course.CS101!,
        cos: [{ code: 'CO1', statement: 'Write programs', mappings: { PEO1: 2 }, items: ['see'] }],
      }),
    ).rejects.toMatchObject({ code: 'course_outcomes_invalid' });
    // CS101 has no internal components to tag.
    await expect(
      saveCourseOutcomes(deps, iqac, {
        regulationId,
        courseId: course.CS101!,
        cos: [{ code: 'CO1', statement: 'Write programs', mappings: {}, items: ['cie:0'] }],
      }),
    ).rejects.toMatchObject({ code: 'course_outcomes_invalid' });
    await saveCourseOutcomes(deps, iqac, {
      regulationId,
      courseId: course.CS102!,
      cos: [
        {
          code: 'CO1',
          statement: 'Reason with sets and logic',
          mappings: { PSO1: 3 },
          items: ['cie:0'],
        },
      ],
    });
    const v = await courseOutcomes(deps, viewer, { regulationId, courseId: course.CS102! });
    expect(v.components).toEqual([
      { name: 'Test', maxMarks: 50 },
      { name: 'Assignment', maxMarks: 10 },
    ]);
    expect(v.cos[0]).toMatchObject({ code: 'CO1', items: ['cie:0'] });
  });

  it('works out direct attainment from a published term; POs only from COs', async () => {
    await expect(attainment(deps, viewer, { batchId, term: 1 })).rejects.toMatchObject({
      code: 'term_not_published',
    });
    await publishTerm();
    const a = await attainment(deps, viewer, { batchId, term: 1 });
    const cs101 = a.courses.find((c) => c.code === 'CS101')!;
    // CO1: internal 3 of 4 (level 3), end exam 2 of 4 (level 1) → 0.4×3 + 0.6×1 = 1.8. CO2: level 1.
    expect(cs101.cos.map((c) => [c.code, c.level, c.met])).toEqual([
      ['CO1', 1.8, false],
      ['CO2', 1, false],
    ]);
    expect(a.courses.find((c) => c.code === 'CS102')!.cos[0]).toMatchObject({
      level: 3,
      met: true,
    });
    // PO1: 1.8. PO2: (1.8×1 + 1×2) ÷ 3 = 1.27. PSO1: 3. PEOs aren't attained directly.
    expect(a.outcomes.map((o) => [o.code, o.value, o.met])).toEqual([
      ['PO1', 1.8, false],
      ['PO2', 1.27, false],
      ['PSO1', 3, true],
    ]);
  });

  it('carries every CO’s mappings into a new version by code', async () => {
    const v2 = await draftOutcomeSet(deps, iqac, { programId, effectiveFrom: '2027-06-01' });
    await publishOutcomeSet(deps, iqac, v2);
    const a = await attainment(deps, viewer, { batchId, term: 1 });
    expect(a.set.version).toBe(2);
    expect(a.outcomes.map((o) => [o.code, o.value])).toEqual([
      ['PO1', 1.8],
      ['PO2', 1.27],
      ['PSO1', 3],
    ]);
  });
});
