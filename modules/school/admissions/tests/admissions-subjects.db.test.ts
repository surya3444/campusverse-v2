// Milestone 21 across modules, on a real provisioned school: the owner's admission questions, an
// applicant's photo and papers moving to the student on enrolment, student and guardian fields,
// and subjects (offerings, periods, teachers, retirement).
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  addPhone,
  createPerson,
  ensureStaffProfile,
  addMembership,
  listDocuments,
  setGuardianFields,
  studentRecord,
  updateStudent,
} from '@campusverse/people-records';
import { storeFile, type ObjectStore } from '@campusverse/platform-documents';
import { FieldError, defineField } from '@campusverse/platform-fields';
import {
  PermissionDenied,
  assignRole,
  createPermissions,
  type Actor,
} from '@campusverse/platform-permissions';
import {
  addApplicationDocument,
  addEnquiry,
  applicationCheck,
  applicationDetail,
  checkApplicationDocument,
  admissionsJobs,
  confirm,
  enrolApplicant,
  moveApplication,
  offer,
  setApplicationPhoto,
  type AdmissionsDeps,
} from '../contract.js';
import { parseFieldKeys } from '@campusverse/crypto';
import { createHead, publishPlan, savePlan } from '@campusverse/shared-finance';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSubject,
  applyStructure,
  assignTeacher,
  provisionSchool,
  schoolAudience,
  setOffering,
  subjectsOverview,
  updateSubject,
} from '@campusverse/school-setup';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const admissions: AdmissionsDeps = { db, permissions, audience: schoolAudience };
const people = { db, permissions, keys: parseFieldKeys(env.FIELD_KEYS), placements: [] };
const objects = new Map<string, Uint8Array>();
const store: ObjectStore = {
  put: async (k, b) => void objects.set(k, b),
  get: async (k) => objects.get(k) ?? null,
  size: async (k) => objects.get(k)?.length ?? null,
  signedUpload: async () => '',
  signedDownload: async () => '',
};
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let teacher: Actor;
let classId: string;
let sectionA: string;
let studentId: string;

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Depth School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Depth', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '4', sections: 2, capacity: 30 }],
  });
  await withTenant(db, school.orgId, async (tx) => {
    const [c] = await tx.execute<{ id: string }>(
      sql`select id::text from school_class where org_id = app_current_org()`,
    );
    classId = c!.id;
    const [s] = await tx.execute<{ id: string }>(
      sql`select id::text from school_section where org_id = app_current_org() and name = 'A'`,
    );
    sectionA = s!.id;
    const id = await createPerson(tx, { legalName: 'Synthetic Subject Teacher', source: 'signup' });
    await addPhone(tx, id, phone());
    await ensureStaffProfile(tx, id, { employeeCode: `E-${randomInt(1e6)}`, workEmail: null });
    await addMembership(tx, {
      personId: id,
      institutionId: school.institutionId,
      kind: 'staff',
      from: iso(-60),
      until: null,
    });
    await assignRole(tx, {
      personId: id,
      roleKey: 'teacher',
      scope: { type: 'institution', id: school.institutionId },
    });
    teacher = { accountId: randomUUID(), orgId: school.orgId, personId: id };
  });
  // Offers disclose the fees, so a published plan must exist.
  const finance = { db, permissions, audience: schoolAudience, gateway: null };
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
    groupIds: [classId],
    lines: [{ headId: head.id, amountPaise: 2_400_000 }],
    instalments: [{ label: 'Annual', dueOn: iso(30), shareBp: 10_000 }],
    lateFeePaise: 0,
    graceDays: 0,
  });
  await publishPlan(finance, owner, plan.id);
});

afterAll(() => close());

const markClean = (fileId: string) =>
  withTenant(db, school.orgId, (tx) =>
    tx.execute(
      sql`update stored_file set scan_status = 'clean' where org_id = app_current_org() and id = ${fileId}`,
    ),
  );

describe('admissions with the owner’s questions and papers', () => {
  it('asks the owner’s required question on every enquiry', async () => {
    await defineField(db, permissions, owner, 'admission', {
      label: 'Previous board',
      type: 'choice',
      options: ['CBSE', 'ICSE', 'State board'],
      required: true,
    });
    const base = {
      institutionId: school.institutionId,
      yearLabel: '2026-27',
      classId,
      category: 'general' as const,
      source: 'walk_in' as const,
      childName: 'Synthetic Anaya Depth',
      dateOfBirth: '2017-08-12',
      guardianName: 'Synthetic Parent Depth',
      guardianPhone: phone(),
    };
    const err = await addEnquiry(admissions, owner, base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FieldError);
    expect((err as FieldError).problems).toEqual({ previous_board: 'required' });
    const { id } = await addEnquiry(admissions, owner, {
      ...base,
      custom: { previous_board: 'ICSE' },
    });
    expect((await applicationDetail(admissions, owner, id)).custom).toEqual({
      previous_board: 'ICSE',
    });

    // A photo and a birth certificate, checked by the office.
    const check = await applicationCheck(admissions, owner, id);
    const photo = await storeFile(db, permissions, store, owner, check, {
      purpose: 'photo',
      fileName: 'p.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    await setApplicationPhoto(admissions, owner, id, photo);
    const fileId = await storeFile(db, permissions, store, owner, check, {
      purpose: 'document',
      fileName: 'b.pdf',
      contentType: 'application/pdf',
      bytes: PDF,
    });
    await markClean(fileId);
    const docId = await addApplicationDocument(admissions, owner, id, {
      folder: 'identity',
      kind: 'birth_certificate',
      title: 'Birth certificate',
      fileId,
    });
    await expect(
      checkApplicationDocument(admissions, owner, docId, { status: 'rejected' }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await checkApplicationDocument(admissions, owner, docId, { status: 'verified' });
    await expect(
      addApplicationDocument(admissions, teacher, id, {
        folder: 'identity',
        kind: 'x_doc',
        title: 'X',
        fileId,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    // Enrolment: the photo and the checked paper become the student's.
    await moveApplication(admissions, owner, { applicationId: id, to: 'applied' });
    await offer(admissions, owner, id);
    await confirm(admissions, owner, id);
    const enrolled = await enrolApplicant(admissions, owner, {
      applicationId: id,
      sectionId: sectionA,
      from: iso(-5),
    });
    studentId = enrolled.studentId;
    // A roll number from day one, and a welcome message to the family with how to sign in.
    expect(enrolled.rollNumber).toBeGreaterThan(0);
    const [event] = await db.execute<OutboxEvent>(sql`
      select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
      from ops.outbox where org_id = ${school.orgId} and type = 'school.admission.enrolled.v1'
        and payload->>'studentId' = ${studentId}`);
    const welcome = admissionsJobs()[0]!;
    await runConsumer(db, welcome, event!);
    await runConsumer(db, welcome, event!);
    const messages = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ title: string; body: string }>(sql`
        select title, body from notification_message where about_person_id = ${studentId} and kind = 'account'`),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toMatch(new RegExp(`admission no\\. ${enrolled.admissionNumber}`));
    const { documents } = await listDocuments(people, owner, studentId);
    expect(documents).toEqual([
      expect.objectContaining({
        title: 'Birth certificate',
        folder: 'identity',
        status: 'verified',
        checkedBy: owner.personId,
      }),
    ]);
    const [p] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ f: string }>(
        sql`select photo_file_id::text as f from person where org_id = app_current_org() and id = ${studentId}`,
      ),
    );
    expect(p?.f).toBe(photo);
  });
});

describe('student and guardian fields', () => {
  it('keeps the owner’s student and guardian fields with the record', async () => {
    await defineField(db, permissions, owner, 'student', {
      label: 'House',
      type: 'choice',
      options: ['Blue', 'Red'],
    });
    await defineField(db, permissions, owner, 'guardian', { label: 'Occupation', type: 'text' });
    await updateStudent(people, owner, studentId, { custom: { house: 'Blue' } });
    const before = await studentRecord(people, owner, studentId);
    const guardianId = before.guardians![0]!.personId;
    await setGuardianFields(people, owner, studentId, guardianId, {
      occupation: 'Synthetic engineer',
    });
    const r = await studentRecord(people, owner, studentId);
    expect(r.custom).toEqual({ house: 'Blue' });
    expect(r.guardians![0]!.custom).toEqual({ occupation: 'Synthetic engineer' });
    await expect(
      setGuardianFields(people, teacher, studentId, guardianId, { occupation: 'x' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('subjects', () => {
  it('adds subjects, offers them with periods, and assigns teachers with dated changes', async () => {
    const eng = await addSubject(db, permissions, owner, school.institutionId, {
      code: 'skt',
      name: 'Sanskrit',
      kind: 'language',
    });
    await expect(
      addSubject(db, permissions, owner, school.institutionId, {
        code: 'SKT',
        name: 'Sanskrit again',
        kind: 'language',
      }),
    ).rejects.toMatchObject({ code: 'subject_code_taken' });
    await setOffering(db, permissions, owner, school.institutionId, {
      classId,
      subjectId: eng,
      offered: true,
      periodsPerWeek: 6,
    });
    await assignTeacher(db, permissions, owner, school.institutionId, {
      sectionId: sectionA,
      subjectId: eng,
      personId: teacher.personId,
    });
    let view = await subjectsOverview(db, permissions, owner, school.institutionId);
    const cls = view.classes.find((c) => c.classId === classId)!;
    expect(cls.offerings).toContainEqual({ subjectId: eng, periodsPerWeek: 6 });
    expect(cls.sections.find((s) => s.sectionId === sectionA)?.teachers).toContainEqual({
      sectionId: sectionA,
      subjectId: eng,
      personId: teacher.personId,
    });

    // Nobody assigned from today; the earlier allocation is kept as history, not deleted.
    await assignTeacher(db, permissions, owner, school.institutionId, {
      sectionId: sectionA,
      subjectId: eng,
      personId: null,
    });
    view = await subjectsOverview(db, permissions, owner, school.institutionId);
    expect(
      view.classes
        .find((c) => c.classId === classId)!
        .sections.find((s) => s.sectionId === sectionA)
        ?.teachers.filter((x) => x.subjectId === eng),
    ).toEqual([]);
    const [rows] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from school_teacher_allocation where org_id = app_current_org() and subject_id = ${eng}`,
      ),
    );
    expect(rows?.n).toBe(1);
  });

  it('retires a subject: it stays on record but can’t be offered again', async () => {
    const art = await addSubject(db, permissions, owner, school.institutionId, {
      code: 'ART',
      name: 'Art',
      kind: 'co_scholastic',
    });
    await updateSubject(db, permissions, owner, school.institutionId, art, { retired: true });
    await expect(
      setOffering(db, permissions, owner, school.institutionId, {
        classId,
        subjectId: art,
        offered: true,
      }),
    ).rejects.toMatchObject({ code: 'subject_retired' });
    const view = await subjectsOverview(db, permissions, owner, school.institutionId);
    expect(view.subjects.find((s) => s.subjectId === art)).toMatchObject({
      retired: true,
      kind: 'co_scholastic',
    });
  });

  it('lets only those who manage setup change subjects', async () => {
    await expect(
      addSubject(db, permissions, teacher, school.institutionId, {
        code: 'MTH',
        name: 'Maths',
        kind: 'scholastic',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
