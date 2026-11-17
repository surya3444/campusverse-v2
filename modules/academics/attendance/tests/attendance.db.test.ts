// College attendance (rule book §13.2: "period-wise (college)"; "Shortage & Condonation"): a
// teacher takes periods course by course; percentages per student per course against the credits
// pack's thresholds; a condonable shortage condoned through the workflow engine. Synthetic data.
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
  attendanceBoard,
  attendanceSheet,
  decideCondonation,
  requestCondonation,
  takeAttendance,
  type AttendanceDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: AttendanceDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let dean: Actor;
let teacher: Actor;
let hod: Actor;
let clerk: Actor;
let batchId: string;
let sectionId: string;
const course: Record<string, string> = {};
const students: string[] = [];

beforeAll(async () => {
  t = await seedTenant(db, 'CourseAttendance');
  const collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'VTU', 'Synthetic Attendance College'
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
  teacher = await actor(['academics.attendance.mark']);
  hod = await actor(['academics.attendance.read', 'academics.attendance.condone']);
  clerk = await actor(['academics.structure.read']);
  const programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BA',
    name: 'B.A.',
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
  for (const code of ['HI101', 'EN101'])
    course[code] = await setCurriculumCourse(deps, dean, {
      regulationId,
      code,
      title: `Course ${code}`,
      termNumber: 1,
      kind: 'core',
      lecture: 4,
      tutorial: 0,
      practical: 0,
      credits: 4,
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
  sectionId = (await batchView(deps, dean, batchId)).sectionList[0]!.id;
  for (const n of [1, 2])
    students.push(
      await enrolStudent(deps, dean, {
        batchId,
        sectionId,
        name: `Synthetic Attendee ${n}`,
        dateOfBirth: null,
        registerNumber: `26BA00${n}`,
      }),
    );
});
afterAll(() => close());

const take = (
  who: Actor,
  onDate: string,
  statuses: ['present' | 'absent' | 'on_duty', 'present' | 'absent' | 'on_duty'],
  code = 'HI101',
  period = 1,
) =>
  takeAttendance(deps, who, {
    batchId,
    sectionId,
    courseId: course[code]!,
    onDate,
    period,
    marks: students.map((studentId, i) => ({ studentId, status: statuses[i]! })),
  });

describe('college attendance', () => {
  it('takes periods within the term, one course per period, retaking replaces', async () => {
    await expect(take(clerk, '2026-08-03', ['present', 'present'])).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    await expect(take(teacher, '2026-06-29', ['present', 'present'])).rejects.toMatchObject({
      code: 'date_outside_term',
    });
    await expect(take(teacher, '2099-01-05', ['present', 'present'])).rejects.toMatchObject({
      code: 'date_outside_term',
    });
    await take(teacher, '2026-08-03', ['present', 'absent']);
    await expect(
      take(teacher, '2026-08-03', ['present', 'present'], 'EN101'),
    ).rejects.toMatchObject({
      code: 'period_taken',
    });
    await take(teacher, '2026-08-03', ['present', 'present'], 'EN101', 2);
    await take(teacher, '2026-08-04', ['on_duty', 'present']);
    await take(teacher, '2026-08-05', ['present', 'absent']);
    // Retaken: student 2 was marked absent on the 5th by mistake.
    await take(teacher, '2026-08-05', ['present', 'present']);
    await take(teacher, '2026-08-06', ['present', 'absent']);
    const sheet = await attendanceSheet(deps, teacher, {
      batchId,
      sectionId,
      courseId: course.HI101!,
      onDate: '2026-08-05',
      period: 1,
    });
    expect(sheet.students.map((s) => s.status)).toEqual(['present', 'present']);
    expect(sheet.taken).not.toBeNull();
  });

  it('works out each student’s standing against the pack (75%, condonable from 65%)', async () => {
    const board = await attendanceBoard(deps, hod, batchId);
    expect(board.rules).toEqual({ minimumPercent: 75, condonableFromPercent: 65 });
    expect(board.courses.map((c) => [c.code, c.sessions])).toEqual([
      ['EN101', 1],
      ['HI101', 4],
    ]);
    const [a, b] = board.students;
    expect(a!.courses[course.HI101!]).toMatchObject({ held: 4, attended: 4, standing: 'eligible' });
    // Student 2: absent on the 3rd and the 6th of four → 50%, short.
    expect(b!.courses[course.HI101!]).toMatchObject({
      held: 4,
      attended: 2,
      basisPoints: 5000,
      standing: 'short',
    });
    expect(b!.courses[course.EN101!]).toMatchObject({ standing: 'eligible' });
  });

  it('condones a condonable shortage only, through the workflow engine', async () => {
    await expect(
      requestCondonation(deps, teacher, {
        batchId,
        courseId: course.HI101!,
        studentId: students[1]!,
        reason: 'Hospitalised',
      }),
    ).rejects.toMatchObject({ code: 'not_condonable' });
    // One more class attended: 3 of 5 = 60% (still short); another: 4 of 6 = 66.66%, condonable.
    await take(teacher, '2026-08-07', ['present', 'present']);
    await take(teacher, '2026-08-10', ['present', 'present']);
    const id = await requestCondonation(deps, teacher, {
      batchId,
      courseId: course.HI101!,
      studentId: students[1]!,
      reason: 'Hospitalised for a week (synthetic)',
    });
    await expect(
      requestCondonation(deps, teacher, {
        batchId,
        courseId: course.HI101!,
        studentId: students[1]!,
        reason: 'Again',
      }),
    ).rejects.toMatchObject({ code: 'condonation_open' });
    await expect(
      decideCondonation(deps, teacher, { condonationId: id, approve: true, note: null }),
    ).rejects.toMatchObject({ code: 'own_request' });
    let board = await attendanceBoard(deps, hod, batchId);
    expect(board.students[1]!.courses[course.HI101!]).toMatchObject({
      basisPoints: 6666,
      standing: 'condonable',
      condonation: { state: 'pending', approval: { mine: true } },
    });
    expect(
      await decideCondonation(deps, hod, { condonationId: id, approve: true, note: null }),
    ).toBe('granted');
    board = await attendanceBoard(deps, hod, batchId);
    expect(board.students[1]!.courses[course.HI101!]).toMatchObject({ standing: 'condoned' });
  });
});
