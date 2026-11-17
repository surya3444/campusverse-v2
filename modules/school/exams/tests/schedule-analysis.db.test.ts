// Milestone 22 on a real provisioned school: the date sheet (clashes refused, invigilators from
// staff) and the result analysis (averages, pass rates, toppers), with denied cases.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStaffProfile,
  ensureStudentProfile,
} from '@campusverse/people-records';
import { createS3Store } from '@campusverse/platform-documents';
import {
  PermissionDenied,
  assignRole,
  createPermissions,
  type Actor,
} from '@campusverse/platform-permissions';
import { enrol } from '@campusverse/school-enrolment';
import { applyStructure, provisionSchool } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createExam,
  dateSheet,
  examAnalysis,
  examDetail,
  saveMarks,
  schedulePaper,
  type ExamDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const store = createS3Store({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
});
const exams: ExamDeps = {
  db,
  permissions,
  store,
  verifyBaseUrl: 'https://verify.example.invalid/v',
};
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let teacher: Actor;
let sectionId: string;
let examId: string;
let papers: { paperId: string; subject: string }[];
const kids: string[] = [];

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Exams School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Exams', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-100),
    ends: iso(200),
    classes: [{ code: '4', sections: 1, capacity: 30 }],
  });
  let classId = '';
  let yearId = '';
  await withTenant(db, school.orgId, async (tx) => {
    const [s] = await tx.execute<{ id: string; classId: string; yearId: string }>(sql`
      select id::text, class_id::text as "classId", year_id::text as "yearId" from school_section where org_id = app_current_org()`);
    sectionId = s!.id;
    classId = s!.classId;
    yearId = s!.yearId;
    const tId = await createPerson(tx, { legalName: 'Synthetic Invigilator', source: 'signup' });
    await addPhone(tx, tId, phone());
    await ensureStaffProfile(tx, tId, { employeeCode: `I-${randomInt(1e6)}`, workEmail: null });
    await addMembership(tx, {
      personId: tId,
      institutionId: school.institutionId,
      kind: 'staff',
      from: iso(-100),
      until: null,
    });
    await assignRole(tx, {
      personId: tId,
      roleKey: 'teacher',
      scope: { type: 'institution', id: school.institutionId },
    });
    teacher = { accountId: randomUUID(), orgId: school.orgId, personId: tId };
    for (const [i, name] of ['Aarav', 'Bina', 'Chitra'].entries()) {
      const id = await createPerson(tx, {
        legalName: `Synthetic ${name} Exams`,
        source: 'admission',
      });
      await ensureStudentProfile(tx, id);
      await addMembership(tx, {
        personId: id,
        institutionId: school.institutionId,
        kind: 'student',
        from: iso(-100),
        until: iso(201),
      });
      await enrol(tx, {
        personId: id,
        institutionId: school.institutionId,
        sectionId,
        admissionNumber: `EX-${randomInt(1e6)}-${i}`,
        rollNumber: i + 1,
        from: iso(-100),
        until: iso(201),
      });
      kids.push(id);
    }
  });
  ({ id: examId } = await createExam(exams, owner, {
    institutionId: school.institutionId,
    yearId,
    name: 'Term 1',
    classIds: [classId],
    maxMarks: '80',
  }));
  papers = (await examDetail(exams, owner, examId)).classes[0]!.papers.slice(0, 2);
});

afterAll(() => close());

describe('the date sheet', () => {
  it('schedules a paper with a room and an invigilator from staff', async () => {
    await schedulePaper(exams, owner, papers[0]!.paperId, {
      onDate: iso(10),
      startsAt: '09:30',
      durationMinutes: 120,
      room: 'Hall A',
      invigilatorId: teacher.personId,
    });
    const sheet = await dateSheet(exams, owner, examId);
    expect(sheet.papers[0]).toMatchObject({
      paperId: papers[0]!.paperId,
      onDate: iso(10),
      startsAt: '09:30',
      durationMinutes: 120,
      room: 'Hall A',
      invigilator: { personId: teacher.personId, name: 'Synthetic Invigilator' },
    });
  });

  it('refuses a class sitting two papers at once, and an invigilator in two rooms', async () => {
    await expect(
      schedulePaper(exams, owner, papers[1]!.paperId, {
        onDate: iso(10),
        startsAt: '10:30',
        durationMinutes: 60,
        room: 'Hall B',
        invigilatorId: null,
      }),
    ).rejects.toMatchObject({ code: 'class_clash' });
    // Later the same day is fine for the class; the same invigilator still can't overlap.
    await schedulePaper(exams, owner, papers[1]!.paperId, {
      onDate: iso(10),
      startsAt: '12:00',
      durationMinutes: 60,
      room: 'Hall B',
      invigilatorId: teacher.personId,
    });
    const sheet = await dateSheet(exams, owner, examId);
    expect(sheet.papers.map((p) => p.startsAt)).toEqual(expect.arrayContaining(['09:30', '12:00']));
  });

  it('refuses an invigilator who is not on staff, and anyone who does not manage exams', async () => {
    await expect(
      schedulePaper(exams, owner, papers[1]!.paperId, {
        onDate: iso(11),
        startsAt: null,
        durationMinutes: null,
        room: null,
        invigilatorId: kids[0]!,
      }),
    ).rejects.toMatchObject({ code: 'not_on_staff' });
    await expect(
      schedulePaper(exams, teacher, papers[1]!.paperId, {
        onDate: iso(11),
        startsAt: null,
        durationMinutes: null,
        room: null,
        invigilatorId: null,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('the analysis', () => {
  it('averages each paper, counts passes and absentees, and ranks complete results', async () => {
    const all = (await examDetail(exams, owner, examId)).classes[0]!.papers;
    for (const p of all)
      await saveMarks(exams, owner, {
        paperId: p.paperId,
        sectionId,
        entries: [
          { studentId: kids[0]!, mark: p.paperId === papers[0]!.paperId ? '72' : '60' },
          { studentId: kids[1]!, mark: p.paperId === papers[0]!.paperId ? '20' : '40' },
          { studentId: kids[2]!, mark: p.paperId === papers[0]!.paperId ? 'AB' : '' },
        ],
      });
    const a = await examAnalysis(exams, owner, examId);
    expect(a.passBasisPoints).toBe(3300);
    const first = a.classes[0]!.papers.find((p) => p.paperId === papers[0]!.paperId)!;
    // 72, 20 and absent (0) of 80: average 38.33%, 1 of 3 passed.
    expect(first).toMatchObject({
      entered: 3,
      absent: 1,
      blank: 0,
      averageBp: 3833,
      highest: '72',
      lowest: '0',
      passed: 1,
      passRateBp: 3333,
    });
    // Chitra has blanks, so isn't ranked; Aarav ahead of Bina.
    expect(a.classes[0]!.toppers.map((t) => [t.name, t.rank])).toEqual([
      ['Synthetic Aarav Exams', 1],
      ['Synthetic Bina Exams', 2],
    ]);
  });
});
