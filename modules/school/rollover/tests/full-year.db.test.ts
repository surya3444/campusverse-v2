// Milestone 13 exit check: a test school finishes one full year. Students attend and pay, sit an
// exam whose marks are entered, locked, corrected by two people and published as report cards,
// are placed in next year's sections, and roll over; the rollover can be undone until the new
// year is used.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStaffProfile,
  ensureStudentProfile,
  linkGuardian,
} from '@campusverse/people-records';
import { createS3Store, verifyDocument } from '@campusverse/platform-documents';
import {
  assignRole,
  createPermissions,
  PermissionDenied,
  type Actor,
} from '@campusverse/platform-permissions';
import { submitAttendance } from '@campusverse/school-attendance';
import { enrol, schoolPlacement } from '@campusverse/school-enrolment';
import {
  createExam,
  decideMarkChange,
  examDetail,
  lockExam,
  marksSheet,
  publishExam,
  requestMarkChange,
  saveMarks,
  setRemark,
  studentResults,
  submitPaper,
  type ExamDeps,
} from '@campusverse/school-exams';
import { applyStructure, provisionSchool, schoolAudience } from '@campusverse/school-setup';
import {
  collectPayment,
  createHead,
  issueInvoices,
  publishPlan,
  savePlan,
  searchStudents,
  studentAccount,
} from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  commitRollover,
  previewRollover,
  saveSectionPlan,
  sectionPlan,
  undoRollover,
  type RolloverDeps,
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
const rollover: RolloverDeps = { db, permissions };
const finance = { db, permissions, audience: schoolAudience, gateway: null };
afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let teacher: Actor;
let thisYear: string;
let nextYear: string;
const sec: Record<string, string> = {};
const cls: Record<string, string> = {};
const kids: Record<string, string> = {};

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Full Year School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Full Year', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  // This year started in spring; next year starts the day after it ends.
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-150),
    ends: iso(140),
    classes: [
      { code: '4', sections: 1, capacity: 30 },
      { code: '9', sections: 1, capacity: 30 },
      { code: '10', sections: 1, capacity: 30 },
    ],
  });
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2027-28',
    starts: iso(141),
    ends: iso(500),
    classes: [
      { code: '5', sections: 2, capacity: 30 },
      { code: '9', sections: 1, capacity: 30 },
      { code: '10', sections: 1, capacity: 30 },
    ],
  });
  await withTenant(db, school.orgId, async (tx) => {
    const years = await tx.execute<{ id: string; label: string }>(
      sql`select id::text, label from school_year where org_id = app_current_org()`,
    );
    thisYear = years.find((y) => y.label === '2026-27')!.id;
    nextYear = years.find((y) => y.label === '2027-28')!.id;
    for (const s of await tx.execute<{
      id: string;
      code: string;
      name: string;
      year: string;
      classId: string;
    }>(sql`
      select s.id::text, c.code, s.name, y.label as year, c.id::text as "classId" from school_section s
      join school_class c on c.org_id = s.org_id and c.id = s.class_id join school_year y on y.org_id = s.org_id and y.id = s.year_id
      where s.org_id = app_current_org()`)) {
      sec[`${s.year}:${s.code}-${s.name}`] = s.id;
      cls[s.code] = s.classId;
    }
    const tId = await createPerson(tx, { legalName: 'Teacher Full Year', source: 'signup' });
    await addPhone(tx, tId, phone());
    await ensureStaffProfile(tx, tId, { employeeCode: `T-${randomInt(1e6)}`, workEmail: null });
    await assignRole(tx, {
      personId: tId,
      roleKey: 'teacher',
      scope: { type: 'institution', id: school.institutionId },
    });
    await tx.execute(sql`
      insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, valid_during)
      values (app_current_org(), ${sec['2026-27:4-A']}, ${tId}, 'class_teacher', daterange(${iso(-150)}::date, null))`);
    teacher = { accountId: randomUUID(), orgId: school.orgId, personId: tId };
    const add = async (key: string, name: string, gender: string, section: string) => {
      const id = await createPerson(tx, { legalName: name, source: 'admission' });
      await ensureStudentProfile(tx, id);
      await tx.execute(
        sql`update student_profile set gender = ${gender} where org_id = app_current_org() and person_id = ${id}`,
      );
      await addMembership(tx, {
        personId: id,
        institutionId: school.institutionId,
        kind: 'student',
        from: iso(-150),
        until: iso(141),
      });
      await enrol(tx, {
        personId: id,
        institutionId: school.institutionId,
        sectionId: section,
        admissionNumber: `FY-${randomInt(1e6)}`,
        rollNumber: null,
        from: iso(-150),
        until: iso(141),
      });
      const mother = await createPerson(tx, {
        legalName: `Mother of ${name}`,
        source: 'admission',
      });
      await addPhone(tx, mother, phone());
      await linkGuardian(tx, {
        guardianId: mother,
        studentId: id,
        relationship: 'mother',
        primary: true,
      });
      kids[key] = id;
    };
    await add('asha', 'Asha Synthetic', 'female', sec['2026-27:4-A']!);
    await add('bala', 'Bala Synthetic', 'male', sec['2026-27:4-A']!);
    await add('chitra', 'Chitra Synthetic', 'female', sec['2026-27:4-A']!);
    await add('dev', 'Dev Synthetic', 'male', sec['2026-27:9-A']!);
    await add('esha', 'Esha Synthetic', 'female', sec['2026-27:9-A']!);
    await add('farhan', 'Farhan Synthetic', 'male', sec['2026-27:10-A']!);
  });
});

describe('one full school year (exit check)', () => {
  it('attends, pays, sits an exam with report cards, and rolls over into the next year', async () => {
    // Attendance: a school day in Class 4, Asha absent.
    await submitAttendance({ db, permissions }, teacher, {
      eventId: randomUUID(),
      deviceId: null,
      occurredAt: new Date().toISOString(),
      sectionId: sec['2026-27:4-A']!,
      onDate: iso(-2),
      marks: [{ personId: kids.asha!, status: 'absent' }],
    });

    // Fees: a plan for Class 4, issued, and Bala's family pays at the counter.
    const head = await createHead(finance, owner, {
      institutionId: school.institutionId,
      code: 'TUITION',
      name: 'Tuition',
      taxClass: 'education_exempt',
      rteExempt: true,
      refundable: false,
    });
    const plan = await savePlan(finance, owner, {
      institutionId: school.institutionId,
      name: 'Class 4',
      groupIds: [cls['4']!],
      lines: [{ headId: head.id, amountPaise: 1_000_000 }],
      instalments: [{ label: 'Annual', dueOn: iso(10), shareBp: 10_000 }],
      lateFeePaise: 0,
      graceDays: 0,
    });
    await publishPlan(finance, owner, plan.id);
    await issueInvoices(finance, owner, plan.id);
    // The counter finds a student by admission number too (any case), with class beside the name.
    const [adm] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ n: string }>(sql`
        select admission_number as n from school_enrolment
        where org_id = app_current_org() and person_id = ${kids.bala!}`),
    );
    const hits = await searchStudents({ ...finance, placements: [schoolPlacement] }, owner, {
      institutionId: school.institutionId,
      search: adm!.n.toLowerCase(),
    });
    expect(hits.find((h) => h.studentId === kids.bala)).toMatchObject({
      reference: adm!.n,
      placement: expect.stringMatching(/^Class 4-/),
    });
    await collectPayment(finance, owner, {
      studentId: kids.bala!,
      amountPaise: 1_000_000,
      method: 'cash',
      idempotencyKey: `fy-${randomUUID()}`,
    });

    // The annual exam: every subject of every class, out of 80.
    const exam = await createExam(exams, owner, {
      institutionId: school.institutionId,
      yearId: thisYear,
      name: 'Annual',
      classIds: [cls['4']!, cls['9']!, cls['10']!],
      maxMarks: '80',
    });
    const detail = await examDetail(exams, owner, exam.id);
    const enterAll = async (
      classCode: string,
      sectionKey: string,
      marks: Record<string, string>,
      who: Actor,
    ) => {
      const c = detail.classes.find((x) => x.classId === cls[classCode])!;
      for (const p of c.papers) {
        await saveMarks(exams, who, {
          paperId: p.paperId,
          sectionId: sec[sectionKey]!,
          entries: Object.entries(marks).map(([k, mark]) => ({ studentId: kids[k]!, mark })),
        });
        await submitPaper(exams, who, p.paperId);
      }
      return c.papers;
    };
    // The class teacher enters Class 4; blank is never zero, so a paper with a blank can't be submitted.
    const c4 = detail.classes.find((x) => x.classId === cls['4'])!;
    await saveMarks(exams, teacher, {
      paperId: c4.papers[0]!.paperId,
      sectionId: sec['2026-27:4-A']!,
      entries: [{ studentId: kids.asha!, mark: '70' }],
    });
    await expect(submitPaper(exams, teacher, c4.papers[0]!.paperId)).rejects.toThrow(/blanks/);
    await expect(
      saveMarks(exams, teacher, {
        paperId: c4.papers[0]!.paperId,
        sectionId: sec['2026-27:4-A']!,
        entries: [{ studentId: kids.asha!, mark: '81' }],
      }),
    ).rejects.toThrow(/over_max/);
    await expect(
      saveMarks(exams, teacher, {
        paperId: detail.classes.find((x) => x.classId === cls['9'])!.papers[0]!.paperId,
        sectionId: sec['2026-27:9-A']!,
        entries: [],
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await enterAll('4', '2026-27:4-A', { asha: '70', bala: '65.5', chitra: 'AB' }, teacher);
    // Class 9: Dev passes everything, Esha is below 33% in one subject.
    const c9 = detail.classes.find((x) => x.classId === cls['9'])!;
    for (const [i, p] of c9.papers.entries()) {
      await saveMarks(exams, owner, {
        paperId: p.paperId,
        sectionId: sec['2026-27:9-A']!,
        entries: [
          { studentId: kids.dev!, mark: '60' },
          { studentId: kids.esha!, mark: i === 0 ? '20' : '50' },
        ],
      });
      await submitPaper(exams, owner, p.paperId);
    }
    await enterAll('10', '2026-27:10-A', { farhan: '75' }, owner);
    await setRemark(exams, teacher, {
      examId: exam.id,
      studentId: kids.asha!,
      remark: 'Reads widely; keep it up.',
    });

    await expect(lockExam(exams, teacher, exam.id)).rejects.toBeInstanceOf(PermissionDenied);
    await lockExam(exams, owner, exam.id);
    // After the lock: Chitra's absence was a medical leave. Asked by one person, approved by another.
    const change = await requestMarkChange(exams, teacher, {
      paperId: c4.papers[0]!.paperId,
      studentId: kids.chitra!,
      mark: 'ML',
      reason: 'Medical certificate produced',
    });
    await expect(
      decideMarkChange(exams, teacher, { changeId: change.id, approve: true }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await decideMarkChange(exams, owner, { changeId: change.id, approve: true });
    const sheet = await marksSheet(exams, owner, {
      paperId: c4.papers[0]!.paperId,
      sectionId: sec['2026-27:4-A']!,
    });
    expect(sheet.students.find((s) => s.personId === kids.chitra)?.mark).toBe('ML');

    expect((await publishExam(exams, owner, exam.id)).results).toBe(6);
    const [asha] = await studentResults(exams, owner, kids.asha!);
    // 70 of 80 in every subject is 87.5%: A2 on the CBSE eight-point scale.
    expect(asha?.subjects.every((s) => s.grade === 'A2')).toBe(true);
    expect(asha?.percent).toBe('87.50');
    const report = await withTenant(db, school.orgId, async (tx) => {
      const [r] = await tx.execute<{ code: string }>(sql`
        select d.verification_code as code from issued_document d where d.org_id = app_current_org() and d.id = ${asha!.reportDocumentId}`);
      return r?.code ?? '';
    });
    expect((await verifyDocument(db, report))?.kind).toBe('report_card');
    const [chitra] = await studentResults(exams, owner, kids.chitra!);
    expect(chitra?.subjects[0]).toMatchObject({ shown: 'ML', grade: null });

    // The section planner for next year's Class 5: three pupils into two sections, balanced.
    const span = { institutionId: school.institutionId, fromYearId: thisYear, toYearId: nextYear };
    const plan5 = await sectionPlan(rollover, owner, { ...span, classId: cls['5']! });
    expect(plan5.pupils.map((p) => p.name).sort()).toEqual([
      'Asha Synthetic',
      'Bala Synthetic',
      'Chitra Synthetic',
    ]);
    expect(plan5.problems).toEqual([]);
    expect(plan5.balance.map((b) => b.size).sort()).toEqual([1, 2]);
    await saveSectionPlan(rollover, owner, {
      ...span,
      classId: cls['5']!,
      plan: plan5.plan,
      keepApart: [],
    });

    // Rollover preview: Class 4 promoted (no detention), Class 9 by pass marks, Class 10 passes out.
    const preview = await previewRollover(rollover, owner, span);
    const outcome = (k: string) => preview.rows.find((r) => r.studentId === kids[k])?.outcome;
    expect(['asha', 'bala', 'chitra', 'dev', 'esha', 'farhan'].map(outcome)).toEqual([
      'promoted',
      'promoted',
      'promoted',
      'promoted',
      'review',
      'passed_out',
    ]);
    expect(preview.rows.find((r) => r.studentId === kids.esha)?.belowPass).toHaveLength(1);
    await expect(commitRollover(rollover, owner, { ...span, overrides: [] })).rejects.toThrow(
      /review_pending/,
    );
    await expect(
      commitRollover(rollover, owner, {
        ...span,
        overrides: [{ studentId: kids.esha!, outcome: 'detained', reason: '' }],
      }),
    ).rejects.toThrow(/reason_required/);
    const decided = [
      {
        studentId: kids.esha!,
        outcome: 'detained' as const,
        reason: 'Below pass mark in one subject; parents informed',
      },
    ];
    const first = await commitRollover(rollover, owner, { ...span, overrides: decided });
    expect([first.promoted, first.detained, first.passedOut]).toEqual([4, 1, 1]);

    const placed = (k: string, on: string) =>
      withTenant(db, school.orgId, (tx) =>
        schoolPlacement.getCurrentPlacement(tx, { personId: kids[k]!, onDate: on }),
      );
    const nextDay = iso(141);
    expect((await placed('asha', nextDay))?.displayLabel).toMatch(/^Class 5-[AB]$/);
    expect((await placed('dev', nextDay))?.displayLabel).toBe('Class 10-A');
    expect((await placed('esha', nextDay))?.displayLabel).toBe('Class 9-A');
    expect(await placed('farhan', nextDay)).toBeNull();
    expect((await placed('asha', iso(0)))?.displayLabel).toBe('Class 4-A'); // this year is untouched
    // Dues stay on the old year as arrears.
    expect((await studentAccount(finance, owner, kids.asha!)).balancePaise).toBe(1_000_000);

    // Undo while the new year is unused, then roll over again.
    await undoRollover(rollover, owner, first.rolloverId);
    expect(await placed('asha', nextDay)).toBeNull();
    const status = async (k: string) =>
      withTenant(
        db,
        school.orgId,
        async (tx) =>
          (
            await tx.execute<{ s: string }>(sql`
        select status as s from student_profile where org_id = app_current_org() and person_id = ${kids[k]!}`)
          )[0]?.s,
      );
    expect(await status('farhan')).toBe('active');
    const again = await commitRollover(rollover, owner, { ...span, overrides: decided });
    expect(await status('farhan')).toBe('passed_out');
    await expect(commitRollover(rollover, owner, { ...span, overrides: decided })).rejects.toThrow(
      /already_rolled_over/,
    );

    // Once the new year is used (an invoice for it), undo is refused.
    await withTenant(db, school.orgId, async (tx) => {
      const [p] = await tx.execute<{ id: string; family: string }>(sql`
        select id::text, family_id::text as family from fee_plan where org_id = app_current_org() limit 1`);
      await tx.execute(sql`
        insert into fee_invoice (org_id, legal_entity_id, institution_id, student_person_id, plan_id, plan_family_id, instalment_seq,
          label, issued_on, due_on, total_paise)
        values (app_current_org(), ${school.legalEntityId}, ${school.institutionId}, ${kids.asha!}, ${p!.id}, ${p!.family}, 99,
          'Next year Term 1', app_today(), ${iso(160)}::date, 100)`);
    });
    await expect(undoRollover(rollover, owner, again.rolloverId)).rejects.toThrow(
      /new_year_in_use/,
    );
  });
});
