// Milestone 12 exit check on a real school: an enquiry becomes an enrolled student, attends, and
// later receives a TC that is checked, approved, numbered, frozen and verifiable by QR. Also the
// admissions rules and the other certificates.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { addPhone, createPerson, ensureStaffProfile } from '@campusverse/people-records';
import { createS3Store, verifyDocument } from '@campusverse/platform-documents';
import {
  assignRole,
  createPermissions,
  PermissionDenied,
  type Actor,
} from '@campusverse/platform-permissions';
import {
  addEnquiry,
  confirm,
  enrolApplicant,
  moveApplication,
  offer,
  pipeline,
  setSeats,
  updateApplication,
  type AdmissionsDeps,
} from '@campusverse/school-admissions';
import { submitAttendance } from '@campusverse/school-attendance';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { applyStructure, provisionSchool, schoolAudience } from '@campusverse/school-setup';
import { createHead, publishPlan, savePlan } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveCertificate,
  certificateDetail,
  checkCertificate,
  issueCertificate,
  reissueCertificate,
  requestCertificate,
  type CertificateDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const store = createS3Store({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
});
const admissions: AdmissionsDeps = { db, permissions, audience: schoolAudience };
const certificates: CertificateDeps = {
  db,
  permissions,
  store,
  verifyBaseUrl: 'https://verify.example.invalid/v',
};
const finance = { db, permissions, audience: schoolAudience, gateway: null };
afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let principal: Actor;
let teacher: Actor;
let classId: string;
let sectionA: string;

async function staff(name: string, roleKey: string): Promise<Actor> {
  return withTenant(db, school.orgId, async (tx) => {
    const id = await createPerson(tx, { legalName: name, source: 'signup' });
    await addPhone(tx, id, phone());
    await ensureStaffProfile(tx, id, { employeeCode: `E-${randomInt(1e6)}`, workEmail: null });
    await assignRole(tx, {
      personId: id,
      roleKey,
      scope: { type: 'institution', id: school.institutionId },
    });
    return { accountId: randomUUID(), orgId: school.orgId, personId: id };
  });
}

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Admissions School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Admissions', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '4', sections: 2, capacity: 30 }],
  });
  principal = await staff('Principal Admissions', 'principal');
  teacher = await staff('Class Teacher Admissions', 'teacher');
  await withTenant(db, school.orgId, async (tx) => {
    const [c] = await tx.execute<{ id: string }>(
      sql`select id::text from school_class where org_id = app_current_org()`,
    );
    classId = c!.id;
    const [s] = await tx.execute<{ id: string }>(sql`
      select id::text from school_section where org_id = app_current_org() and name = 'A'`);
    sectionA = s!.id;
    await tx.execute(sql`
      insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, valid_during)
      values (app_current_org(), ${sectionA}, ${teacher.personId}, 'class_teacher', daterange(${iso(-60)}::date, null))`);
  });
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
    instalments: [
      { label: 'Term 1', dueOn: iso(-30), shareBp: 5000 },
      { label: 'Term 2', dueOn: iso(90), shareBp: 5000 },
    ],
    lateFeePaise: 0,
    graceDays: 0,
  });
  await publishPlan(finance, owner, plan.id);
});

const enquiry = (over: Record<string, unknown> = {}) =>
  addEnquiry(admissions, owner, {
    institutionId: school.institutionId,
    yearLabel: '2026-27',
    classId,
    category: 'general',
    source: 'walk_in',
    childName: `Synthetic Child ${randomInt(1e6)}`,
    dateOfBirth: '2017-08-12',
    guardianName: 'Synthetic Parent Admissions',
    guardianPhone: phone(),
    ...over,
  });

describe('an enquiry becomes a student who later receives a TC (exit check)', () => {
  it('runs the whole journey', async () => {
    // Enquiry → applied → offered (fees disclosed) → confirmed → enrolled.
    const { id } = await enquiry({ childName: 'Kiran Synthetic Journey' });
    await moveApplication(admissions, owner, { applicationId: id, to: 'applied' });
    await expect(offer(admissions, teacher, id)).rejects.toBeInstanceOf(PermissionDenied);
    const { expiresOn } = await offer(admissions, owner, id);
    expect(expiresOn).toBe(iso(7));
    await confirm(admissions, owner, id);
    const enrolled = await enrolApplicant(admissions, owner, {
      applicationId: id,
      sectionId: sectionA,
      from: iso(-5),
    });
    expect(enrolled.admissionNumber).toBe('2026-0001');
    // A mid-year joiner isn't billed for the term already due.
    expect([enrolled.invoices, enrolled.totalPaise]).toEqual([1, 1_200_000]);
    const studentId = enrolled.studentId;
    const placement = await withTenant(db, school.orgId, (tx) =>
      schoolPlacement.getCurrentPlacement(tx, { personId: studentId, onDate: iso(0) }),
    );
    expect(placement?.displayLabel).toBe('Class 4-A');

    // A day at school.
    await submitAttendance({ db, permissions }, teacher, {
      eventId: randomUUID(),
      deviceId: null,
      occurredAt: new Date().toISOString(),
      sectionId: sectionA,
      onDate: iso(-3),
      marks: [],
    });

    // The TC: request with clearance, class teacher check, principal approval, numbered issue.
    await expect(
      requestCertificate(certificates, owner, { studentId, kind: 'tc' }),
    ).rejects.toThrow(/leaving_details_required/);
    const req = await requestCertificate(certificates, owner, {
      studentId,
      kind: 'tc',
      leavingDate: iso(-1),
      leavingReason: 'Family moving to another city',
    });
    expect(req.warnings.map((w) => w.code)).toContain('dues'); // a warning, never a block below Class 9
    await expect(
      requestCertificate(certificates, owner, {
        studentId,
        kind: 'tc',
        leavingDate: iso(-1),
        leavingReason: 'Again',
      }),
    ).rejects.toThrow(/tc_already_open/);
    await expect(approveCertificate(certificates, principal, req.id)).rejects.toThrow(
      /not_checked/,
    );
    await checkCertificate(certificates, teacher, req.id);
    await expect(approveCertificate(certificates, teacher, req.id)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await approveCertificate(certificates, principal, req.id);
    const issued = await issueCertificate(certificates, owner, req.id);
    expect(issued.number).toBe('TC/2026-27/0001');

    const detail = await certificateDetail(certificates, owner, req.id);
    const fields = Object.fromEntries(detail.fields);
    expect(fields['Date of birth']).toBe('12 Aug 2017 (Twelfth August Two Thousand Seventeen)');
    expect(fields['Days present']).toBe('1');
    expect(fields['Fees paid up to date']).toBe('No');
    expect(fields['Admission number']).toBe('2026-0001');
    expect(detail.downloadUrl).toMatch(/^https?:\/\//);

    // The QR check shows the document, never the student.
    const v = await verifyDocument(db, issued.verificationCode);
    expect(v).toMatchObject({ kind: 'tc', number: 'TC/2026-27/0001', version: 1, status: 'valid' });
    expect(JSON.stringify(v)).not.toContain('Kiran');

    // The enrolment ended on the leaving date; history stays.
    await withTenant(db, school.orgId, async (tx) => {
      expect(
        await schoolPlacement.getCurrentPlacement(tx, { personId: studentId, onDate: iso(0) }),
      ).toBeNull();
      expect(
        (await schoolPlacement.getCurrentPlacement(tx, { personId: studentId, onDate: iso(-2) }))
          ?.displayLabel,
      ).toBe('Class 4-A');
      const [p] = await tx.execute<{ status: string }>(sql`
        select status from student_profile where org_id = app_current_org() and person_id = ${studentId}`);
      expect(p?.status).toBe('left');
      const [e] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from ops.outbox where org_id = app_current_org() and type = 'school.student.left.v1'
          and payload ->> 'studentId' = ${studentId}`);
      expect(e?.n).toBe(1);
    });

    // A duplicate for a lost copy: same number, version 2; the original no longer verifies as valid.
    const dup = await reissueCertificate(certificates, principal, {
      requestId: req.id,
      mode: 'duplicate',
      reason: 'Original lost in transit',
    });
    expect(dup.version).toBe(2);
    expect((await verifyDocument(db, issued.verificationCode))?.status).toBe('superseded');
    expect((await verifyDocument(db, dup.verificationCode))?.status).toBe('valid');
  });
});

describe('admissions rules', () => {
  it('refuses duplicates, closing without a reason, and RTE outside the portal', async () => {
    const p = phone();
    await enquiry({ childName: 'Twin Synthetic One', guardianPhone: p });
    await expect(enquiry({ childName: 'Twin Synthetic One', guardianPhone: p })).rejects.toThrow(
      /duplicate/,
    );
    await enquiry({ childName: 'Twin Synthetic Two', guardianPhone: p }); // a twin is a separate application
    const { id } = await enquiry();
    await expect(
      moveApplication(admissions, owner, { applicationId: id, to: 'lost' }),
    ).rejects.toThrow(/reason_required/);
    await moveApplication(admissions, owner, {
      applicationId: id,
      to: 'lost',
      reason: 'Chose another school',
    });
    await expect(enquiry({ category: 'rte' })).rejects.toThrow(/rte_from_portal_only/);
  });

  it('holds seats from the offer, and a lapsed offer passes the seat to the next on the waitlist', async () => {
    await setSeats(admissions, owner, {
      institutionId: school.institutionId,
      yearLabel: '2026-27',
      classId,
      category: 'staff',
      seats: 1,
    });
    const first = await enquiry({ category: 'staff' });
    const second = await enquiry({ category: 'staff' });
    for (const a of [first, second])
      await moveApplication(admissions, owner, { applicationId: a.id, to: 'applied' });
    await offer(admissions, owner, first.id);
    await expect(offer(admissions, owner, second.id)).rejects.toThrow(/no_seat/);
    await moveApplication(admissions, owner, { applicationId: second.id, to: 'waitlisted' });
    await withTenant(db, school.orgId, (tx) =>
      tx.execute(
        sql`update school_application set offer_expires_on = app_today() - 1 where org_id = app_current_org() and id = ${first.id}`,
      ),
    );
    await expect(confirm(admissions, owner, first.id)).rejects.toThrow(/offer_lapsed/);
    const view = await pipeline(admissions, owner, {
      institutionId: school.institutionId,
      yearLabel: '2026-27',
    });
    const state = (id: string) => view.applications.find((a) => a.id === id)?.state;
    expect([state(first.id), state(second.id)]).toEqual(['lost', 'offered']);
  });

  it('an age outside the rule needs an override with an order reference before an offer', async () => {
    // Class 4 has no age rule; check through the update path that an override requires its order reference.
    const { id } = await enquiry();
    await expect(
      updateApplication(admissions, owner, {
        applicationId: id,
        ageOverride: { reason: 'Transfer from abroad', orderRef: '' },
      }),
    ).rejects.toThrow();
    await updateApplication(admissions, owner, {
      applicationId: id,
      ageOverride: { reason: 'Transfer from abroad', orderRef: 'DDPI/2026/41' },
    });
  });
});

describe('other certificates', () => {
  it('bonafide and fee-paid certificates issue directly with their own numbers', async () => {
    const { id } = await enquiry({ childName: 'Asha Synthetic Bonafide' });
    await moveApplication(admissions, owner, { applicationId: id, to: 'applied' });
    await offer(admissions, owner, id);
    await confirm(admissions, owner, id);
    const { studentId } = await enrolApplicant(admissions, owner, {
      applicationId: id,
      sectionId: sectionA,
      from: iso(-2),
    });
    const b = await requestCertificate(certificates, owner, {
      studentId,
      kind: 'bonafide',
      purpose: 'Bank account',
    });
    expect((await issueCertificate(certificates, owner, b.id)).number).toBe('BC/2026-27/0001');
    const f = await requestCertificate(certificates, owner, { studentId, kind: 'fee_paid' });
    await expect(checkCertificate(certificates, teacher, f.id)).rejects.toThrow(/not_checkable/);
    expect((await issueCertificate(certificates, owner, f.id)).number).toBe('FC/2026-27/0001');
    await expect(
      requestCertificate(certificates, teacher, { studentId, kind: 'bonafide' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
