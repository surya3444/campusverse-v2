// College Exams & Results (rule book §13.2; P0 item 12): marks by course, locks, results graded on
// the credits pack's scale with SGPA, published only by a second person through the workflow engine.
import { decideRegistration, register, saveWindow } from '@campusverse/academics-registration';
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
import { setAbcId } from '@campusverse/people-records';
import { parseFieldKeys } from '@campusverse/crypto';
import {
  abcCreditFile,
  decideReexam,
  decideResults,
  markReexam,
  reexamBoard,
  requestReexam,
  examBoard,
  gradeCard,
  marksSheet,
  saveMarks,
  sendResults,
  setCourseLock,
  type ExamDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const keys = parseFieldKeys(env.FIELD_KEYS);
const deps: ExamDeps = { db, permissions: createPermissions(null), keys };

let t: SeededTenant;
let dean: Actor;
let teacher: Actor;
let coe: Actor;
let principal: Actor;
let batchId: string;
const ids: Record<string, string> = {};
const students: string[] = [];

beforeAll(async () => {
  t = await seedTenant(db, 'Exams');
  const collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'VTU', 'Synthetic Exam College'
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
    'academics.registration.manage',
    'academics.registration.approve',
  ]);
  teacher = await actor(['academics.exam.marks']);
  coe = await actor(['academics.exam.marks', 'academics.exam.manage', 'academics.structure.read']);
  principal = await actor(['academics.exam.publish', 'academics.structure.read']);
  const programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BSC-CS',
    name: 'B.Sc. Computer Science',
    level: 'ug',
    termKind: 'semester',
    terms: 6,
    framework: null,
  });
  const regulationId = await draftRegulation(deps, dean, {
    programId,
    code: 'R26',
    effectiveFrom: '2026-06-01',
    minCredits: null,
  });
  for (const [code, kind, credits] of [
    ['CS101', 'core', 4],
    ['CS102', 'core', 3],
    ['CS151', 'elective', 3],
  ] as const)
    ids[code] = await setCurriculumCourse(deps, dean, {
      regulationId,
      code,
      title: `Course ${code}`,
      termNumber: 1,
      kind,
      lecture: credits,
      tutorial: 0,
      practical: 0,
      credits,
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
    endsOn: '2026-11-30',
  });
  const sectionId = (await batchView(deps, dean, batchId)).sectionList[0]!.id;
  for (const n of [1, 2])
    students.push(
      await enrolStudent(deps, dean, {
        batchId,
        sectionId,
        name: `Synthetic Examinee ${n}`,
        dateOfBirth: null,
        registerNumber: `26CS00${n}`,
      }),
    );
  // The second student registered the elective too (approved by someone other than the dean).
  await saveWindow(deps, dean, {
    batchId,
    opensOn: '2020-01-01',
    closesOn: '2099-12-31',
    minCredits: 0,
    maxCredits: 30,
    caps: [],
  });
  const regId = await register(deps, dean, {
    batchId,
    studentId: students[1]!,
    electiveIds: [ids.CS151!],
  });
  const approver = await actor(['academics.registration.approve', 'academics.structure.read']);
  await decideRegistration(deps, approver, {
    registrationId: regId,
    decision: 'approve',
    note: null,
  });
});
afterAll(() => close());

const marks = (courseId: string, rows: [number, number | null, number | null, boolean?][]) =>
  saveMarks(deps, teacher, {
    batchId,
    courseId,
    rows: rows.map(([i, cie, see, absent]) => ({
      studentId: students[i]!,
      cie,
      see,
      absent: absent ?? false,
    })),
  });

describe('college exams and results', () => {
  it('takes marks per course, within the scale, from the students who take it', async () => {
    const sheet = await marksSheet(deps, teacher, { batchId, courseId: ids.CS151! });
    expect(sheet).toMatchObject({ cieMax: 40, seeMax: 60, locked: false });
    expect(sheet.rows.map((r) => r.registerNumber)).toEqual(['26CS002']);
    await expect(marks(ids.CS101!, [[0, 45, 50]])).rejects.toMatchObject({
      code: 'mark_out_of_range',
    });
    await expect(marks(ids.CS151!, [[0, 30, 40]])).rejects.toMatchObject({ code: 'not_taking' });
    await marks(ids.CS101!, [
      [0, 38, 54],
      [1, 30, 30],
    ]);
    await marks(ids.CS102!, [
      [0, 32, 38],
      [1, 35, null, true],
    ]);
    await marks(ids.CS151!, [[1, 20, 35]]);
    const board = await examBoard(deps, coe, batchId);
    expect(board.courses.map((c) => [c.code, c.students, c.entered])).toEqual([
      ['CS101', 2, 2],
      ['CS102', 2, 2],
      ['CS151', 1, 1],
    ]);
    // Student 1: O (92) and A (70) → (4×10 + 3×8) ÷ 7 = 9.14.
    expect(board.students[0]).toMatchObject({
      registerNumber: '26CS001',
      sgpa: 9.14,
      creditsEarned: 7,
    });
    // Student 2: B+ (60), F (absent from the end exam), B (55) → (4×7 + 3×0 + 3×6) ÷ 10 = 4.6.
    expect(board.students[1]).toMatchObject({ sgpa: 4.6, credits: 10, creditsEarned: 7 });
    expect(board.ready).toBe(false);
  });

  it('locks complete courses only; nobody changes locked marks', async () => {
    await expect(
      setCourseLock(deps, teacher, { batchId, courseId: ids.CS101!, locked: true }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await saveMarks(deps, teacher, {
      batchId,
      courseId: ids.CS151!,
      rows: [{ studentId: students[1]!, cie: 20, see: null, absent: false }],
    });
    await expect(
      setCourseLock(deps, coe, { batchId, courseId: ids.CS151!, locked: true }),
    ).rejects.toMatchObject({ code: 'marks_incomplete', details: { missing: 1 } });
    await marks(ids.CS151!, [[1, 20, 35]]);
    for (const c of ['CS101', 'CS102', 'CS151'])
      await setCourseLock(deps, coe, { batchId, courseId: ids[c]!, locked: true });
    await expect(marks(ids.CS101!, [[0, 39, 54]])).rejects.toMatchObject({ code: 'locked' });
    expect((await examBoard(deps, coe, batchId)).ready).toBe(true);
  });

  it('publishes results only with a second person; then the grade card shows them, frozen', async () => {
    expect((await gradeCard(deps, principal, { batchId, studentId: students[0]! })).terms).toEqual(
      [],
    );
    const resultId = await sendResults(deps, coe, batchId);
    await expect(sendResults(deps, coe, batchId)).rejects.toMatchObject({ code: 'result_exists' });
    await expect(
      setCourseLock(deps, coe, { batchId, courseId: ids.CS101!, locked: false }),
    ).rejects.toMatchObject({ code: 'result_exists' });
    await expect(
      decideResults(deps, coe, { resultId, approve: true, note: null }),
    ).rejects.toMatchObject({ code: 'own_request' });
    expect(await decideResults(deps, principal, { resultId, approve: true, note: null })).toBe(
      'published',
    );
    const card = await gradeCard(deps, principal, { batchId, studentId: students[1]! });
    expect(card).toMatchObject({ registerNumber: '26CS002' });
    expect(card.terms[0]).toMatchObject({ term: 1, sgpa: 4.6, cgpa: 4.6, creditsEarned: 7 });
    expect(card.terms[0]!.courses.map((c) => [c.code, c.grade])).toEqual([
      ['CS101', 'B+'],
      ['CS102', 'F'],
      ['CS151', 'B'],
    ]);
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update exam_grade set grade = 'O' where result_id = ${resultId}`),
      ),
    ).rejects.toThrow();
  });

  it('exports a published term’s credits for ABC and NAD, with full IDs, as a restricted export', async () => {
    await expect(abcCreditFile(deps, coe, { batchId, term: 1 })).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    const registrar = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, [
        'academics.exam.manage',
        'people.student.reveal',
        'people.student.update',
      ]),
    };
    await setAbcId(
      { db, permissions: deps.permissions, keys, placements: [] },
      registrar,
      students[0]!,
      '123412341234',
    );
    await expect(abcCreditFile(deps, registrar, { batchId, term: 2 })).rejects.toMatchObject({
      code: 'not_published',
    });
    const file = await abcCreditFile(deps, registrar, { batchId, term: 1 });
    expect(file).toMatchObject({ students: 2, rows: 5 });
    expect(file.withoutAbc.map((s) => s.name)).toEqual(['Synthetic Examinee 2']);
    const lines = file.csv.split('\n');
    expect(lines[0]).toBe(
      'ABC ID,APAAR ID,Register number,Name,Date of birth,Gender,Programme,Batch,Term,Course code,Course title,Credits,Grade,Grade point,Result,SGPA,CGPA,Result date',
    );
    expect(lines.find((l) => l.startsWith('123412341234,'))).toMatch(
      /^123412341234,,26CS001,Synthetic Examinee 1,,,BSC-CS,2026–29,1,CS101,Course CS101,4,O,10,PASS,9.14,9.14,/,
    );
    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ dataClass: string }>(sql`
        select data_class as "dataClass" from audit_event where action = 'academics.results.abc_export'`),
    );
    expect(audit?.dataClass).toBe('restricted');
  });

  it('re-exams: supplementary for a failed course, revaluation never lowers; the new grade counts once approved', async () => {
    const ask = (who: Actor, i: number, code: string, kind: 'revaluation' | 'supplementary') =>
      requestReexam(deps, who, {
        batchId,
        term: 1,
        studentId: students[i]!,
        courseId: ids[code]!,
        kind,
      });
    await expect(ask(teacher, 1, 'CS102', 'supplementary')).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    await expect(ask(coe, 0, 'CS101', 'supplementary')).rejects.toMatchObject({
      code: 'reexam_not_allowed',
    });
    // Absent from the end exam: there is no script to revalue.
    await expect(ask(coe, 1, 'CS102', 'revaluation')).rejects.toMatchObject({
      code: 'reexam_not_allowed',
    });
    let board = await reexamBoard(deps, coe, batchId);
    expect(board.failed.map((f) => [f.code, f.grade])).toEqual([['CS102', 'F']]);
    expect(board.seeMax).toBe(60);

    const supp = await ask(coe, 1, 'CS102', 'supplementary');
    await expect(ask(coe, 1, 'CS102', 'supplementary')).rejects.toMatchObject({
      code: 'reexam_open',
    });
    await expect(
      markReexam(deps, teacher, { reexamId: supp, see: 61, absent: false }),
    ).rejects.toMatchObject({ code: 'mark_out_of_range' });
    // Internal 35 carried over + 45 = 80 → A+.
    expect(await markReexam(deps, teacher, { reexamId: supp, see: 45, absent: false })).toEqual({
      grade: 'A+',
      changed: true,
    });
    await expect(
      decideReexam(deps, teacher, { reexamId: supp, approve: true, note: null }),
    ).rejects.toMatchObject({ code: 'own_request' });
    // Not counted until approved.
    let card = await gradeCard(deps, principal, { batchId, studentId: students[1]! });
    expect(card.terms[0]).toMatchObject({ sgpa: 4.6, creditsEarned: 7 });
    expect(await decideReexam(deps, principal, { reexamId: supp, approve: true, note: null })).toBe(
      'approved',
    );
    card = await gradeCard(deps, principal, { batchId, studentId: students[1]! });
    // (4×7 + 3×9 + 3×6) ÷ 10 = 7.3, all ten credits earned.
    expect(card.terms[0]).toMatchObject({ sgpa: 7.3, cgpa: 7.3, creditsEarned: 10 });
    expect(card.terms[0]!.courses.find((c) => c.code === 'CS102')).toMatchObject({
      grade: 'A+',
      total: 80,
    });
    board = await reexamBoard(deps, coe, batchId);
    expect(board.failed).toEqual([]);
    expect(board.reexams[0]).toMatchObject({
      kind: 'supplementary',
      state: 'approved',
      oldGrade: 'F',
      grade: 'A+',
    });

    // Revaluation of student 1's A (70): a lower mark leaves it; a better one raises it.
    const reval = await ask(coe, 0, 'CS102', 'revaluation');
    expect(await markReexam(deps, teacher, { reexamId: reval, see: 30, absent: false })).toEqual({
      grade: 'A',
      changed: false,
    });
    expect(await markReexam(deps, teacher, { reexamId: reval, see: 49, absent: false })).toEqual({
      grade: 'A+',
      changed: true,
    });
    expect((await reexamBoard(deps, principal, batchId)).reexams[0]?.approval).toMatchObject({
      mine: true,
    });
    await decideReexam(deps, principal, { reexamId: reval, approve: true, note: null });
    card = await gradeCard(deps, principal, { batchId, studentId: students[0]! });
    // (4×10 + 3×9) ÷ 7 = 9.57.
    expect(card.terms[0]).toMatchObject({ sgpa: 9.57 });
  });
});
