// Exam patterns, the full report card and the year's final result on a real provisioned school
// (owner's brief, 21 Nov 2026): Theory + Internal splits, co-scholastic grades and remarks (with
// suggestions), and two published exams combined 40/60 into the year's frozen result.
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
  examDetail,
  latestResult,
  lockExam,
  publishExam,
  publishResultPlan,
  reportCardSheet,
  resultPlanDetail,
  saveMarks,
  saveReportCard,
  saveResultPlan,
  setSubjectParts,
  submitPaper,
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
let classId = '';
let yearId = '';
const kids: string[] = [];

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Patterns School',
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
});

afterAll(() => close());

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? String(e),
  );

/** Every paper of an exam filled in for the three students, submitted, locked and published. */
async function markAll(examId: string, mark: (part: string, max: number) => string) {
  const d = await examDetail(exams, owner, examId);
  for (const p of d.classes[0]!.papers) {
    await saveMarks(exams, owner, {
      paperId: p.paperId,
      sectionId,
      entries: kids.map((studentId) => ({ studentId, mark: mark(p.part, Number(p.maxMarks)) })),
    });
    await submitPaper(exams, owner, p.paperId);
  }
  await lockExam(exams, owner, examId);
}

describe('exam patterns, report cards and the final result', () => {
  let half = '';
  let annual = '';

  it('splits every subject into Theory and Internal, and one subject back into a whole paper', async () => {
    ({ id: half } = await createExam(exams, owner, {
      institutionId: school.institutionId,
      yearId,
      name: 'Half-yearly',
      classIds: [classId],
      maxMarks: '100',
      parts: [
        { name: 'Theory', maxMarks: '80' },
        { name: 'Internal', maxMarks: '20' },
      ],
    }));
    const papers = (await examDetail(exams, owner, half)).classes[0]!.papers;
    const subjects = [...new Set(papers.map((p) => p.subjectId))];
    expect(papers.length).toBe(subjects.length * 2);
    expect(papers[0]).toMatchObject({ part: 'Theory', maxMarks: '80' });
    expect(papers[0]!.subject).toMatch(/ · Theory$/);
    expect(
      await code(
        setSubjectParts(exams, owner, {
          examId: half,
          classId,
          subjectId: subjects[0]!,
          parts: [
            { name: 'Theory', maxMarks: '50' },
            { name: 'theory', maxMarks: '50' },
          ],
        }),
      ),
    ).toBe('bad_parts');
    // The last subject becomes one whole paper of 100.
    await setSubjectParts(exams, owner, {
      examId: half,
      classId,
      subjectId: subjects.at(-1)!,
      parts: [{ name: '', maxMarks: '100' }],
    });
    const after = (await examDetail(exams, owner, half)).classes[0]!.papers;
    expect(after.filter((p) => p.subjectId === subjects.at(-1))).toMatchObject([
      { part: '', maxMarks: '100' },
    ]);
    // Once marks are in, the split can't change.
    await saveMarks(exams, owner, {
      paperId: after[0]!.paperId,
      sectionId,
      entries: [{ studentId: kids[0]!, mark: '60' }],
    });
    expect(
      await code(
        setSubjectParts(exams, owner, {
          examId: half,
          classId,
          subjectId: subjects[0]!,
          parts: [{ name: '', maxMarks: '100' }],
        }),
      ),
    ).toBe('marks_entered');
  });

  it('takes co-scholastic grades and remarks from the class teacher or exam managers, with suggestions', async () => {
    // Everyone gets 80%: Theory 60/80 and Internal 20/20, or 80 of a whole 100.
    await markAll(half, (part, max) =>
      part === 'Theory' ? '60' : part ? '20' : String(max * 0.8),
    );
    const sheet = await reportCardSheet(exams, owner, { examId: half, sectionId });
    expect(sheet.areas.map((a) => a.name)).toEqual([
      'Work Education',
      'Art Education',
      'Health & Physical Education',
      'Discipline',
    ]);
    expect(sheet.canEdit).toBe(true);
    expect(sheet.students[0]!.suggestion).toMatch(/^Synthetic has done well, with strong work in /);
    const [work, art] = sheet.areas;
    await saveReportCard(exams, owner, {
      examId: half,
      sectionId,
      entries: [
        {
          studentId: kids[0]!,
          grades: { [work!.id]: 'A', [art!.id]: 'B' },
          remark: 'Aarav works carefully and helps others.',
        },
      ],
    });
    const again = await reportCardSheet(exams, owner, { examId: half, sectionId });
    expect(again.students[0]).toMatchObject({
      grades: { [work!.id]: 'A', [art!.id]: 'B' },
      remark: 'Aarav works carefully and helps others.',
    });
    // A subject teacher who isn't the class teacher can read it, not change it.
    expect((await reportCardSheet(exams, teacher, { examId: half, sectionId })).canEdit).toBe(
      false,
    );
    await expect(
      saveReportCard(exams, teacher, {
        examId: half,
        sectionId,
        entries: [{ studentId: kids[1]!, grades: {}, remark: 'x' }],
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await publishExam(exams, owner, half);
  });

  it('combines the half-yearly (40%) and annual (60%) into the year’s frozen result', async () => {
    ({ id: annual } = await createExam(exams, owner, {
      institutionId: school.institutionId,
      yearId,
      name: 'Annual',
      classIds: [classId],
      maxMarks: '100',
    }));
    const plan = (weights: [number, number]) =>
      saveResultPlan(exams, owner, {
        institutionId: school.institutionId,
        yearId,
        name: 'Final result 2026-27',
        classIds: [classId],
        exams: [
          { examId: half, weightBp: weights[0] },
          { examId: annual, weightBp: weights[1] },
        ],
      });
    expect(await code(plan([5000, 4000]))).toBe('weights_not_100');
    const { id: planId } = await plan([4000, 6000]);
    expect(await resultPlanDetail(exams, owner, planId)).toMatchObject({
      waitingFor: ['Annual'],
      students: null,
    });
    expect(await code(publishResultPlan(exams, owner, planId))).toBe('exams_not_published');

    // Annual: 70 of 100 everywhere. Year: 40% × 80 + 60% × 70 = 74 in every subject.
    await markAll(annual, () => '70');
    await publishExam(exams, owner, annual);
    const detail = await resultPlanDetail(exams, owner, planId);
    expect(detail.waitingFor).toEqual([]);
    expect(detail.students).toHaveLength(3);
    expect(detail.students![0]).toMatchObject({ percentBp: 7400, below: [] });
    expect(detail.students![0]!.subjects[0]).toMatchObject({
      byExam: [8000, 7000],
      percentBp: 7400,
    });

    expect(await publishResultPlan(exams, owner, planId)).toEqual({ results: 3 });
    expect(await code(publishResultPlan(exams, owner, planId))).toBe('plan_published');
    // The year's result is what the next year starts from.
    const latest = await withTenant(db, school.orgId, (tx) => latestResult(tx, kids[0]!));
    expect(latest?.percentBp).toBe(7400);
    // Frozen: final results are never edited.
    await expect(
      withTenant(db, school.orgId, (tx) =>
        tx.execute(sql`update school_final_result set percent = 99`),
      ),
    ).rejects.toThrow();
  });
});
