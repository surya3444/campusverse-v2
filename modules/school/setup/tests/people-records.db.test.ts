// Student and staff records against real Postgres. Milestone 8 exit check: one person is
// represented in a school and a college without the shared tables touching academic tables.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { assignRole, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { changeSection, enrol, schoolPlacement } from '@campusverse/school-enrolment';
import { applyStructure, provisionSchool, staffExitConsumer } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  addMembership,
  addPhone,
  correctName,
  createPerson,
  createStaff,
  listStaff,
  recordStaffCheck,
  staffChecks,
  ensureStaffProfile,
  ensureStudentProfile,
  exitStaff,
  linkGuardian,
  listStudents,
  revealIdentifier,
  revealPan,
  setAadhaar,
  setAbcId,
  setApaar,
  setPen,
  setDocument,
  setGuardianLink,
  staffRecord,
  studentRecord,
  updateStaff,
  verhoeffDigit,
  type PeopleDeps,
} from '@campusverse/people-records';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const deps: PeopleDeps = {
  db,
  permissions,
  keys: parseFieldKeys(env.FIELD_KEYS),
  placements: [schoolPlacement],
};

afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const mobile = () => `+919${randomInt(100_000_000, 999_999_999)}`;
const aadhaar = (() => {
  const eleven = `2${String(randomInt(1e9, 1e10 - 1))}`.slice(0, 11);
  return `${eleven}${verhoeffDigit(eleven)}`;
})();

let school: Awaited<ReturnType<typeof provisionSchool>>;
let collegeId: string;
let admin: Actor;
let teacher: Actor;
let parent: Actor;
let otherParent: Actor;
let student: string;
let sections: Record<string, string>;

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Records School',
    group: null,
    board: 'CBSE',
    state: 'TN',
    owner: { name: 'Owner Records', phone: mobile().slice(3) },
  });
  admin = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, admin, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '1', sections: 2, capacity: 30 }],
  });

  await withTenant(db, school.orgId, async (tx) => {
    // A college of the same group, with no academic tables of its own yet.
    const [c] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, authority_code, name, state_code, status)
      values (app_current_org(), ${school.campusId}, ${school.legalEntityId}, 'college', 'TNU', 'Synthetic Records College', 'TN', 'setup')
      returning id::text`);
    collegeId = c!.id;
    sections = Object.fromEntries(
      (
        await tx.execute<{ name: string; id: string }>(sql`
          select s.name, s.id::text from school_section s where s.org_id = app_current_org()`)
      ).map((r) => [r.name, r.id]),
    );

    student = await createPerson(tx, {
      legalName: 'Kavya Synthetic',
      dateOfBirth: '2019-06-20',
      source: 'admission',
    });
    await ensureStudentProfile(tx, student);
    await addMembership(tx, {
      personId: student,
      institutionId: school.institutionId,
      kind: 'student',
      from: iso(-60),
      until: iso(301),
    });
    await enrol(tx, {
      personId: student,
      institutionId: school.institutionId,
      sectionId: sections.A!,
      admissionNumber: `REC-${randomInt(1e6)}`,
      rollNumber: 1,
      from: iso(-60),
      until: iso(301),
    });

    const teacherId = await createPerson(tx, { legalName: 'Teacher Records', source: 'signup' });
    await addPhone(tx, teacherId, mobile());
    await ensureStaffProfile(tx, teacherId, {
      employeeCode: `T-${randomInt(1e6)}`,
      workEmail: null,
    });
    await addMembership(tx, {
      personId: teacherId,
      institutionId: school.institutionId,
      kind: 'staff',
      from: iso(-60),
      until: null,
    });
    await assignRole(tx, {
      personId: teacherId,
      roleKey: 'teacher',
      scope: { type: 'institution', id: school.institutionId },
    });
    await tx.execute(sql`
      insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, valid_during)
      values (app_current_org(), ${sections.A!}, ${teacherId}, 'class_teacher', daterange(${iso(-60)}::date, null))`);
    teacher = { accountId: 'n/a', orgId: school.orgId, personId: teacherId };

    const mother = await createPerson(tx, { legalName: 'Mother Records', source: 'admission' });
    await addPhone(tx, mother, mobile());
    await assignRole(tx, {
      personId: mother,
      roleKey: 'parent',
      scope: { type: 'organisation', id: school.orgId },
    });
    await linkGuardian(tx, {
      guardianId: mother,
      studentId: student,
      relationship: 'mother',
      primary: true,
    });
    parent = { accountId: 'n/a', orgId: school.orgId, personId: mother };

    const stranger = await createPerson(tx, { legalName: 'Other Parent', source: 'admission' });
    await assignRole(tx, {
      personId: stranger,
      roleKey: 'parent',
      scope: { type: 'organisation', id: school.orgId },
    });
    otherParent = { accountId: 'n/a', orgId: school.orgId, personId: stranger };
  });
});

describe('one person across institutions (exit check)', () => {
  it('a school student who also joins the group college keeps one record, two memberships', async () => {
    await withTenant(db, school.orgId, (tx) =>
      addMembership(tx, {
        personId: student,
        institutionId: collegeId,
        kind: 'student',
        from: iso(0),
        until: null,
      }),
    );
    const r = await studentRecord(deps, admin, student);
    expect(r.memberships.map((m) => m.institutionName).sort()).toEqual([
      'Synthetic Records College',
      'Synthetic Records School',
    ]);
    // Only the school answers "where exactly"; the college has no academic tables and needs none here.
    expect(r.placements).toEqual([
      {
        institutionId: school.institutionId,
        institutionType: 'school',
        displayLabel: 'Class 1-A',
        active: true,
        reference: expect.any(String),
      },
    ]);
    const [row] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from person where legal_name = 'Kavya Synthetic'`,
      ),
    );
    expect(row?.n).toBe(1);
  });

  it('shared tables reference no academic table', async () => {
    const refs = await db.execute<{ t: string; ref: string }>(sql`
      select conrelid::regclass::text as t, confrelid::regclass::text as ref from pg_constraint
      where contype = 'f' and conrelid::regclass::text in
        ('person', 'person_name', 'student_profile', 'staff_profile', 'institution_membership', 'person_document', 'guardian_link')`);
    expect(refs.filter((r) => /^(school|college|university)_/.test(r.ref))).toEqual([]);
  });
});

describe('what each person sees', () => {
  it('a teacher sees the overview and placement, not guardians, documents or history', async () => {
    const r = await studentRecord(deps, teacher, student);
    expect(r.person.name).toBe('Kavya Synthetic');
    expect(r.placements[0]?.displayLabel).toBe('Class 1-A');
    expect([r.guardians, r.documents, r.timeline]).toEqual([null, null, null]);
    expect(r.can).toEqual({ update: false, reveal: false, readFull: false });
  });

  it('the school administrator sees everything', async () => {
    const r = await studentRecord(deps, admin, student);
    expect(r.guardians?.map((g) => g.name)).toEqual(['Mother Records']);
    expect(r.documents).toEqual([]);
    expect(r.can).toEqual({ update: true, reveal: true, readFull: true });
  });

  it("a parent sees their own child's record, and not another child's", async () => {
    const own = await studentRecord(deps, parent, student);
    expect(own.documents).toEqual([]);
    expect(own.guardians).toBeNull();
    await expect(studentRecord(deps, otherParent, student)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });

  it('lists students with their placement, searchable by name', async () => {
    const all = await listStudents(deps, teacher, {
      institutionId: school.institutionId,
      search: 'kavya',
    });
    expect(all).toHaveLength(1);
    expect(all).toMatchObject([
      {
        personId: student,
        name: 'Kavya Synthetic',
        status: 'active',
        placement: 'Class 1-A',
        reference: expect.any(String),
      },
    ]);
    await expect(
      listStudents(deps, parent, { institutionId: school.institutionId }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
  });
});

describe('sensitive identifiers', () => {
  it('Aadhaar is checked, sealed and shown masked; a reveal needs permission and a reason, and is audited', async () => {
    await expect(setAadhaar(deps, admin, student, '123412341234')).rejects.toMatchObject({
      code: 'bad_aadhaar',
    });
    await setAadhaar(deps, admin, student, aadhaar);
    const r = await studentRecord(deps, admin, student);
    expect(r.identifiers.aadhaar.masked).toBe(`XXXX XXXX ${aadhaar.slice(-4)}`);

    const [stored] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ sealed: Buffer }>(
        sql`select aadhaar_sealed as sealed from student_profile where person_id = ${student}`,
      ),
    );
    expect(stored!.sealed.includes(Buffer.from(aadhaar))).toBe(false);

    await expect(revealIdentifier(deps, admin, student, 'aadhaar', 'x')).rejects.toMatchObject({
      code: 'reason_required',
    });
    await expect(
      revealIdentifier(deps, teacher, student, 'aadhaar', 'Board registration'),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    expect(await revealIdentifier(deps, admin, student, 'aadhaar', 'Board registration')).toBe(
      aadhaar,
    );
    const [audit] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ dataClass: string; reason: string }>(sql`
        select data_class as "dataClass", reason from audit_event
        where action = 'people.student.reveal' and entity_id = ${student} order by occurred_at desc limit 1`),
    );
    expect(audit).toEqual({ dataClass: 'restricted', reason: 'Board registration' });
  });

  it('APAAR is present, or refused / not generated with a reason; never blocking', async () => {
    await expect(
      setApaar(deps, admin, student, { status: 'refused', note: ' ' }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await setApaar(deps, admin, student, {
      status: 'refused',
      note: 'Parent declined; form on file',
    });
    expect((await studentRecord(deps, admin, student)).identifiers.apaar).toEqual({
      status: 'refused',
      note: 'Parent declined; form on file',
      masked: null,
    });
    await setApaar(deps, admin, student, { status: 'present', id: '1234 5678 9012' });
    expect((await studentRecord(deps, admin, student)).identifiers.apaar.masked).toBe(
      'XXXX XXXX 9012',
    );
  });

  it('PEN is kept in clear and unique; the ABC ID is sealed; both optional and removable', async () => {
    await expect(setPen(deps, admin, student, '1234')).rejects.toMatchObject({ code: 'bad_pen' });
    await setPen(deps, admin, student, '2023 0101 234');
    expect((await studentRecord(deps, admin, student)).identifiers.pen).toBe('20230101234');

    const other = await withTenant(db, school.orgId, async (tx) => {
      const id = await createPerson(tx, { legalName: 'Second Synthetic', source: 'admission' });
      await ensureStudentProfile(tx, id);
      await addMembership(tx, {
        personId: id,
        institutionId: school.institutionId,
        kind: 'student',
        from: iso(-1),
        until: iso(301),
      });
      return id;
    });
    await expect(setPen(deps, admin, other, '20230101234')).rejects.toMatchObject({
      code: 'pen_taken',
    });
    await expect(setPen(deps, teacher, student, '20230101235')).rejects.toMatchObject({
      name: 'PermissionDenied',
    });

    await expect(setAbcId(deps, admin, student, '12')).rejects.toMatchObject({ code: 'bad_abc' });
    await setAbcId(deps, admin, student, '1111 2222 3333');
    expect((await studentRecord(deps, admin, student)).identifiers.abc.masked).toBe(
      'XXXX XXXX 3333',
    );
    expect(await revealIdentifier(deps, admin, student, 'abc', 'Credit transfer to ABC')).toBe(
      '111122223333',
    );
    await setAbcId(deps, admin, student, null);
    await setPen(deps, admin, student, null);
    const r = await studentRecord(deps, admin, student);
    expect(r.identifiers.pen).toBeNull();
    expect(r.identifiers.abc.masked).toBeNull();
  });
});

describe('names, guardians and documents', () => {
  it('a name correction keeps the old name and its source', async () => {
    await correctName(deps, admin, student, {
      legalName: 'Kavya S. Synthetic',
      reason: 'Matches birth certificate',
      source: 'correction',
    });
    const r = await studentRecord(deps, admin, student);
    expect(r.person.name).toBe('Kavya S. Synthetic');
    expect(r.names.map((n) => [n.legalName, n.source])).toEqual([
      ['Kavya S. Synthetic', 'correction'],
      ['Kavya Synthetic', 'admission'],
    ]);
    expect(r.timeline?.some((t) => t.reason === 'Matches birth certificate')).toBe(true);
  });

  it('restricting a guardian blocks their access at once, and lifting it restores it', async () => {
    const link = (await studentRecord(deps, admin, student)).guardians?.[0]?.linkId ?? '';
    await setGuardianLink(deps, admin, link, { restriction: { reason: 'Court order on file' } });
    await expect(studentRecord(deps, parent, student)).rejects.toMatchObject({
      reason: 'no_relationship',
    });
    expect((await studentRecord(deps, admin, student)).guardians?.[0]?.restricted?.reason).toBe(
      'Court order on file',
    );
    await setGuardianLink(deps, admin, link, { restriction: null });
    expect((await studentRecord(deps, parent, student)).person.id).toBe(student);
  });

  it('documents move through the checklist; a rejection needs a note', async () => {
    await setDocument(deps, admin, student, {
      kind: 'birth_certificate',
      requirement: 'required',
      status: 'pending',
    });
    await expect(
      setDocument(deps, admin, student, {
        kind: 'birth_certificate',
        requirement: 'required',
        status: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await setDocument(deps, admin, student, {
      kind: 'birth_certificate',
      requirement: 'required',
      status: 'rejected',
      note: 'Unreadable scan',
    });
    expect((await studentRecord(deps, admin, student)).documents).toEqual([
      expect.objectContaining({
        kind: 'birth_certificate',
        status: 'rejected',
        note: 'Unreadable scan',
      }),
    ]);
  });
});

describe('section change mid-year', () => {
  it('ends the old enrolment the day before and starts a new one; history stays', async () => {
    await expect(
      changeSection(db, permissions, teacher, {
        personId: student,
        sectionId: sections.B!,
        from: iso(1),
        reason: 'Balance',
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await changeSection(db, permissions, admin, {
      personId: student,
      sectionId: sections.B!,
      from: iso(1),
      reason: 'Balance sections',
    });
    const on = (d: number) =>
      withTenant(db, school.orgId, (tx) =>
        schoolPlacement.getCurrentPlacement(tx, { personId: student, onDate: iso(d) }),
      );
    expect((await on(0))?.displayLabel).toBe('Class 1-A');
    expect((await on(1))?.displayLabel).toBe('Class 1-B');
    await expect(
      changeSection(db, permissions, admin, {
        personId: student,
        sectionId: sections.B!,
        from: iso(2),
        reason: 'Again',
      }),
    ).rejects.toMatchObject({ code: 'same_section' });
  });
});

describe('staff', () => {
  it('PAN is sealed, masked, and revealed only with a reason', async () => {
    await expect(updateStaff(deps, admin, teacher.personId, { pan: 'BAD' })).rejects.toMatchObject({
      code: 'bad_pan',
    });
    await updateStaff(deps, admin, teacher.personId, {
      pan: 'abcde1234f',
      designation: 'TGT Mathematics',
    });
    const r = await staffRecord(deps, admin, teacher.personId);
    expect(r.pan).toBe('XXXXXX234F');
    expect(r.person.designation).toBe('TGT Mathematics');
    expect(await revealPan(deps, admin, teacher.personId, 'Payroll export')).toBe('ABCDE1234F');
  });

  it('exit removes access across the organisation after the last day, and ends allocations', async () => {
    expect(
      (await listStudents(deps, teacher, { institutionId: school.institutionId })).length,
    ).toBeGreaterThan(0);
    await exitStaff(deps, admin, teacher.personId, { lastDay: iso(-1), reason: 'Resigned' });

    await expect(
      listStudents(deps, teacher, { institutionId: school.institutionId }),
    ).rejects.toMatchObject({ reason: 'no_grant' });
    const r = await staffRecord(deps, admin, teacher.personId);
    expect(r.person.status).toBe('left');
    expect(r.roles.every((role) => role.until !== null && role.until < iso(0))).toBe(true);
    expect(r.memberships.every((m) => m.until !== null && m.until < iso(0))).toBe(true);

    // The school ends the class-teacher allocation when it hears the event.
    const [event] = await db.execute<OutboxEvent>(sql`
      select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
      from ops.outbox where org_id = ${school.orgId} and type = 'people.staff.exited.v1'`);
    await runConsumer(db, staffExitConsumer, event!);
    const [current] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from school_teacher_allocation
        where teacher_person_id = ${teacher.personId} and valid_during @> app_today()`),
    );
    expect(current?.n).toBe(0);
    await expect(
      exitStaff(deps, admin, teacher.personId, { lastDay: iso(0), reason: 'Again' }),
    ).rejects.toMatchObject({
      code: 'staff_not_found_or_left',
    });
  });
});

describe('staff of every kind and their safety checks', () => {
  it('a driver added with the work role gets the role, support category and checks to do', async () => {
    const driverId = await createStaff(deps, admin, {
      institutionId: school.institutionId,
      name: 'Synthetic Driver Ravi',
      phone: mobile(),
      joinedOn: iso(0),
      workRole: 'driver',
    });
    const watchmanId = await createStaff(deps, admin, {
      institutionId: school.institutionId,
      name: 'Synthetic Gardener Mani',
      phone: mobile(),
      joinedOn: iso(0),
      workRole: null,
    });
    const list = await listStaff(deps, admin, { institutionId: school.institutionId });
    const driver = list.find((x) => x.personId === driverId);
    expect(driver).toMatchObject({ category: 'support', roleKeys: ['driver'] });
    expect(driver?.checksDue.map((c) => c.kind)).toEqual([
      'police_verification',
      'driving_licence',
      'medical_fitness',
    ]);
    // No app role: support staff, police verification only.
    expect(list.find((x) => x.personId === watchmanId)).toMatchObject({
      category: 'support',
      roleKeys: [],
      checksDue: [{ kind: 'police_verification', state: 'missing' }],
    });

    // A licence running out within 30 days is expiring; a renewal replaces it.
    await recordStaffCheck(deps, admin, driverId, {
      kind: 'driving_licence',
      reference: 'TS0920190001234',
      checkedOn: iso(-400),
      validUntil: iso(10),
    });
    await recordStaffCheck(deps, admin, driverId, {
      kind: 'police_verification',
      reference: 'PV/2026/77',
      checkedOn: iso(-5),
    });
    let checks = await staffChecks(deps, admin, driverId);
    expect(checks.lines.map((l) => [l.kind, l.state])).toEqual([
      ['police_verification', 'ok'],
      ['driving_licence', 'expiring'],
      ['medical_fitness', 'missing'],
    ]);
    await recordStaffCheck(deps, admin, driverId, {
      kind: 'driving_licence',
      reference: 'TS0920190001234',
      checkedOn: iso(-1),
      validUntil: iso(1800),
    });
    checks = await staffChecks(deps, admin, driverId);
    expect(checks.lines.find((l) => l.kind === 'driving_licence')?.state).toBe('ok');
    expect(checks.history).toHaveLength(3);
    await expect(
      recordStaffCheck(deps, admin, driverId, { kind: 'medical_fitness', checkedOn: iso(2) }),
    ).rejects.toMatchObject({ code: 'check_in_future' });
    // Checks are append-only, even directly.
    await expect(
      withTenant(db, school.orgId, (tx) => tx.execute(sql`update staff_check set reference = 'x'`)),
    ).rejects.toThrow();
  });
});
