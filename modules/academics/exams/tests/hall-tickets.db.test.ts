// Hall tickets and eligibility (rule book §13.2: "Attendance, fee and no-dues checks; QR admit
// cards"; §16: "ineligibility notice with reason"): attendance standings and overdue fees decide
// who gets a hall ticket for which courses; the exam office can release one despite fees, with a
// reason; a condonation re-issues the ticket. All data synthetic.
import {
  decideCondonation,
  requestCondonation,
  takeAttendance,
} from '@campusverse/academics-attendance';
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
import type { ObjectStore } from '@campusverse/platform-documents';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  eligibilityBoard,
  hallTicketUrl,
  issueHallTickets,
  sendIneligibilityNotices,
  type ExamDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const objects = new Map<string, Uint8Array>();
const store: ObjectStore = {
  put: async (k, b) => void objects.set(k, b),
  get: async (k) => objects.get(k) ?? null,
  size: async (k) => objects.get(k)?.length ?? null,
  signedUpload: async () => '',
  signedDownload: async (k) => `https://files.invalid/${k}`,
};
const deps: ExamDeps = {
  db,
  permissions: createPermissions(null),
  store,
  verifyBaseUrl: 'https://verify.invalid',
};

let t: SeededTenant;
let dean: Actor;
let teacher: Actor;
let coe: Actor;
let hod: Actor;
let batchId: string;
let sectionId: string;
let collegeId: string;
const course: Record<string, string> = {};
const students: string[] = [];

beforeAll(async () => {
  t = await seedTenant(db, 'HallTickets');
  collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'VTU', 'Synthetic Ticket College'
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
  coe = await actor(['academics.exam.manage', 'academics.structure.read']);
  hod = await actor(['academics.attendance.read', 'academics.attendance.condone']);
  const programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BSC',
    name: 'B.Sc.',
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
  for (const code of ['CH101', 'MA101'])
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
  for (const n of [1, 2, 3])
    students.push(
      await enrolStudent(deps, dean, {
        batchId,
        sectionId,
        name: `Synthetic Candidate ${n}`,
        dateOfBirth: null,
        registerNumber: `26SC00${n}`,
      }),
    );
  // CH101: three periods. Student 2 attends two of three (66.66%, condonable). MA101: none taken.
  for (const [i, second] of (['present', 'absent', 'present'] as const).entries())
    await takeAttendance(deps, teacher, {
      batchId,
      sectionId,
      courseId: course.CH101!,
      onDate: `2026-08-0${i + 3}`,
      period: 1,
      marks: students.map((studentId, j) => ({ studentId, status: j === 1 ? second : 'present' })),
    });
  // Student 3 owes fees that fell due in September.
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into fee_invoice (org_id, legal_entity_id, institution_id, student_person_id, plan_id, plan_family_id,
        instalment_seq, label, issued_on, due_on, total_paise)
      select app_current_org(), i.legal_entity_id, i.id, ${students[2]}, p.id, p.family_id, 1, 'Term 1',
        '2026-08-01', '2026-09-10', 2500000
      from institution i, fee_plan p where i.org_id = app_current_org() and i.id = ${collegeId}
        and p.org_id = app_current_org() limit 1`),
  );
});
afterAll(() => close());

describe('hall tickets and eligibility', () => {
  it('works out who may sit what, and why not', async () => {
    const board = await eligibilityBoard(deps, coe, batchId);
    const [a, b, c] = board.students;
    expect(a).toMatchObject({ ready: true, reasons: [] });
    expect(a!.courses.map((x) => [x.code, x.maySit])).toEqual([
      ['CH101', true],
      ['MA101', true],
    ]);
    expect(b).toMatchObject({
      ready: true,
      reasons: [{ kind: 'attendance', code: 'CH101', standing: 'condonable' }],
    });
    expect(c).toMatchObject({
      ready: false,
      overduePaise: 2500000,
      reasons: [{ kind: 'fees', overduePaise: 2500000 }],
    });
  });

  it('issues tickets to the ready, withholds for fees unless released with a reason', async () => {
    await expect(issueHallTickets(deps, teacher, { batchId })).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    expect(await issueHallTickets(deps, coe, { batchId })).toEqual({
      issued: 2,
      unchanged: 0,
      withheld: 1,
      noCourse: 0,
    });
    expect(await issueHallTickets(deps, coe, { batchId })).toMatchObject({
      issued: 0,
      unchanged: 2,
    });
    await expect(
      issueHallTickets(deps, coe, { batchId, releaseReason: 'Fee plan agreed' }),
    ).rejects.toMatchObject({ code: 'release_reason_needed' });
    expect(
      await issueHallTickets(deps, coe, {
        batchId,
        studentIds: [students[2]!],
        releaseReason: 'Instalment plan agreed (synthetic)',
      }),
    ).toMatchObject({ issued: 1 });
    const board = await eligibilityBoard(deps, coe, batchId);
    expect(board.students[1]!.ticket?.courseIds).toEqual([course.MA101]);
    expect(board.students[2]!.ticket).toMatchObject({
      releasedReason: 'Instalment plan agreed (synthetic)',
    });
    expect(await hallTicketUrl(deps, coe, { batchId, studentId: students[0]! })).toMatch(
      /^https:\/\/files\.invalid\//,
    );
    expect(objects.size).toBe(3);
  });

  it('sends each student with a reason a notice once, and re-issues a ticket after a condonation', async () => {
    expect(await sendIneligibilityNotices(deps, coe, batchId)).toEqual({ students: 2 });
    expect(await sendIneligibilityNotices(deps, coe, batchId)).toEqual({ students: 0 });
    const [m] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ body: string }>(sql`
        select body from notification_message where recipient_person_id = ${students[1]} and kind = 'notice'`),
    );
    expect(m?.body).toContain(
      'attendance in CH101 is below the minimum (a condonation can be asked for)',
    );

    const id = await requestCondonation(deps, teacher, {
      batchId,
      courseId: course.CH101!,
      studentId: students[1]!,
      reason: 'Medical (synthetic)',
    });
    await decideCondonation(deps, hod, { condonationId: id, approve: true, note: null });
    expect(
      await issueHallTickets(deps, coe, { batchId, studentIds: [students[1]!] }),
    ).toMatchObject({ issued: 1 });
    const board = await eligibilityBoard(deps, coe, batchId);
    expect(board.students[1]!.ticket?.courseIds).toEqual([course.CH101, course.MA101]);
    const [doc] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ version: number }>(sql`
        select max(version)::int as version from issued_document where subject_person_id = ${students[1]}
          and kind = 'hall_ticket'`),
    );
    expect(doc?.version).toBe(2);
  });
});
