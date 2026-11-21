// Admissions CRM on a real school (owner's brief, 20 Nov 2026; rule book §13.3, §16.2): a lead
// worked with calls and follow-ups, a personal form link the family completes with papers, a
// rejected paper sent again through a papers link, verification, and enrolment carrying every
// detail to the student's record. Bulk upload previews, imports and undoes. All data synthetic.
import { loadEnv } from '@campusverse/config';
import { createDb, createRedis, withTenant } from '@campusverse/db';
import { addPhone, createPerson, ensureStaffProfile } from '@campusverse/people-records';
import type { ObjectStore } from '@campusverse/platform-documents';
import { createOtp } from '@campusverse/platform-identity';
import { assignRole, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { applyStructure, provisionSchool, schoolAudience } from '@campusverse/school-setup';
import { createHead, publishPlan, savePlan } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addEnquiry,
  applicationRecord,
  checkApplicationDocument,
  completeFollowUp,
  confirm,
  enrolApplicant,
  followUps,
  importLeads,
  leadImports,
  logActivity,
  offer,
  pipeline,
  previewLeadImport,
  publicForm,
  requestApplicationCode,
  requestPapers,
  saveAdmissionForm,
  scheduleFollowUp,
  sendInvite,
  sendPapers,
  setSeats,
  startApplication,
  studentAdmission,
  submitOnlineApplication,
  undoLeadImport,
  updateLead,
  uploadPaper,
  verifyApplication,
  type AdmissionsDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const permissions = createPermissions(null);
const deps: AdmissionsDeps = { db, permissions, audience: schoolAudience };
const finance = { db, permissions, audience: schoolAudience, gateway: null };
const codes = new Map<string, string>();
const otp = createOtp({
  redis,
  pepper: 'test-pepper',
  sender: { send: async (p: string, c: string) => void codes.set(p, c) },
  scope: `apply-crm-${randomUUID()}`,
});
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
const SECRET = 'crm-test-secret';
const ORIGIN = 'https://app.example.test';
afterAll(async () => {
  redis.disconnect();
  await close();
});

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const phone = () => `+919${randomInt(100_000_000, 999_999_999)}`;
const YEAR = '2026-27';

let school: Awaited<ReturnType<typeof provisionSchool>>;
let owner: Actor;
let principal: Actor;
let classId: string;
let slug: string;

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic CRM School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner CRM', phone: phone().slice(3) },
  });
  owner = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, owner, school.institutionId, {
    board: 'CBSE',
    yearLabel: YEAR,
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '1', sections: 1, capacity: 30 }],
  });
  principal = await withTenant(db, school.orgId, async (tx) => {
    const id = await createPerson(tx, { legalName: 'Principal CRM', source: 'signup' });
    await addPhone(tx, id, phone());
    await ensureStaffProfile(tx, id, { employeeCode: `E-${randomInt(1e6)}`, workEmail: null });
    await assignRole(tx, {
      personId: id,
      roleKey: 'principal',
      scope: { type: 'institution', id: school.institutionId },
    });
    const [c] = await tx.execute<{ id: string }>(
      sql`select id::text from school_class where org_id = app_current_org()`,
    );
    classId = c!.id;
    return { accountId: randomUUID(), orgId: school.orgId, personId: id };
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
    name: 'Class 1',
    groupIds: [classId],
    lines: [{ headId: head.id, amountPaise: 1_000_000 }],
    instalments: [{ label: 'Year', dueOn: iso(30), shareBp: 10000 }],
    lateFeePaise: 0,
    graceDays: 0,
  });
  await publishPlan(finance, owner, plan.id);
  await setSeats(deps, owner, {
    institutionId: school.institutionId,
    yearLabel: YEAR,
    classId,
    category: 'general',
    seats: 10,
  });
  slug = (
    await saveAdmissionForm(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      title: 'Synthetic CRM admissions',
      intro: '',
      classIds: [classId],
      open: true,
      closesOn: null,
      papers: [
        { kind: 'birth_certificate', title: 'Birth certificate', required: true },
        { kind: 'photo', title: 'Photo', required: true },
        { kind: 'report_card', title: 'Report card', required: false },
      ],
    })
  ).slug;
});

async function code(p: string) {
  await requestApplicationCode(db, otp, { slug, phone: p, ip: '10.1.2.3' });
  return codes.get(p) ?? '';
}
const token = (link: string) => new URL(link).searchParams.get('invite') ?? '';

describe('admissions CRM', () => {
  it('works a lead to enrolment with a personal link, papers, verification and every detail', async () => {
    const mobile = phone();
    const { id } = await addEnquiry(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      classId,
      category: 'general',
      source: 'phone',
      childName: 'Synthetic Meera Iyer',
      guardianName: 'Synthetic Lakshmi Iyer',
      guardianPhone: mobile,
      guardianRelationship: 'mother',
      details: { guardianEmail: 'Lakshmi@Example.test' },
      interest: 'warm',
      campaign: 'Open day',
    });
    await updateLead(deps, owner, { applicationId: id, ownerPersonId: principal.personId });
    await expect(
      updateLead(deps, owner, { applicationId: id, ownerPersonId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'owner_not_counsellor' });

    // A call that reaches the family moves the enquiry on, with the next follow-up.
    await logActivity(deps, owner, {
      applicationId: id,
      kind: 'call',
      outcome: 'interested',
      note: 'Asked about transport',
      followUp: { dueOn: iso(1), purpose: 'Send the form' },
    });
    await scheduleFollowUp(deps, owner, {
      applicationId: id,
      dueOn: iso(3),
      purpose: 'Check the form came back',
      assignedTo: principal.personId,
    });
    const due = (await followUps(deps, owner, school.institutionId)).filter(
      (f) => f.applicationId === id,
    );
    expect(due.map((f) => [f.purpose, f.assignedTo.name])).toEqual([
      ['Send the form', 'Owner CRM'],
      ['Check the form came back', 'Principal CRM'],
    ]);
    await completeFollowUp(deps, owner, { followUpId: due[0]?.id ?? '', outcome: 'Form sent' });

    // The form link goes to the lead's mobile; the family opens it.
    const sent = await sendInvite(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      applicationId: id,
      purpose: 'apply',
      channel: 'whatsapp',
      origin: ORIGIN,
    });
    expect(sent).toMatchObject({ channel: 'whatsapp', address: mobile });
    expect(sent.text).toContain('Synthetic Meera Iyer');
    const form = await publicForm(db, slug, token(sent.link));
    expect(form?.invite).toMatchObject({
      purpose: 'apply',
      childName: 'Synthetic Meera Iyer',
      phoneEnds: mobile.slice(-4),
      email: 'lakshmi@example.test',
      usable: true,
    });

    // Another mobile can't use a link for this application; the lead's own can.
    const stranger = phone();
    await expect(
      startApplication(db, otp, SECRET, {
        slug,
        phone: stranger,
        code: await code(stranger),
        invite: token(sent.link),
      }),
    ).rejects.toMatchObject({ code: 'phone_not_on_application' });
    const start = await startApplication(db, otp, SECRET, {
      slug,
      phone: mobile,
      code: await code(mobile),
      invite: token(sent.link),
    });
    expect(start.prefill).toMatchObject({ childName: 'Synthetic Meera Iyer', classId });

    const birth = await uploadPaper(db, store, SECRET, {
      slug,
      session: start.session,
      kind: 'birth_certificate',
      fileName: 'birth.pdf',
      contentType: 'application/pdf',
      bytes: PDF,
    });
    const photo = await uploadPaper(db, store, SECRET, {
      slug,
      session: start.session,
      kind: 'photo',
      fileName: 'photo.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    const r = await submitOnlineApplication(db, SECRET, {
      slug,
      session: start.session,
      childName: 'Synthetic Meera Iyer',
      dateOfBirth: '2020-01-15',
      gender: 'female',
      classId,
      guardianName: 'Synthetic Lakshmi Iyer',
      guardianRelationship: 'mother',
      details: {
        secondGuardianName: 'Synthetic Arun Iyer',
        secondGuardianRelationship: 'father',
        secondGuardianPhone: phone(),
        secondGuardianEmail: 'arun@example.test',
        addressLine: '12 Synthetic Lane',
        city: 'Mysuru',
        pincode: '570001',
        stateCode: 'KA',
        motherTongue: 'Tamil',
        bloodGroup: 'O+',
        previousSchool: 'Synthetic Play School',
        medicalNotes: 'Mild asthma',
      },
      custom: {},
      papers: [
        { kind: 'birth_certificate', ticket: birth.ticket },
        { kind: 'photo', ticket: photo.ticket },
      ],
      consent: true,
    });
    expect(r.status).toBe('received');
    // The link is used up: no second submission through it.
    expect((await publicForm(db, slug, token(sent.link)))?.invite?.usable).toBe(false);

    let rec = await applicationRecord(deps, owner, id);
    expect(rec.state).toBe('applied');
    expect(rec.details).toMatchObject({
      city: 'Mysuru',
      secondGuardianName: 'Synthetic Arun Iyer',
    });
    expect(rec.photoFileId).not.toBeNull();
    expect(rec.checklist.map((l) => [l.kind, l.status, l.fromFamily])).toEqual([
      ['birth_certificate', 'received', true],
      ['photo', 'received', true],
      ['report_card', 'missing', false],
    ]);
    expect(rec.timeline.map((x) => x.kind)).toEqual(
      expect.arrayContaining(['call', 'follow_up_done', 'form_sent', 'form_submitted']),
    );

    // The photo is blurred: rejected with a reason, and the family is asked again.
    const doc = (k: string) => rec.checklist.find((l) => l.kind === k)?.documentId ?? '';
    await checkApplicationDocument(deps, owner, doc('birth_certificate'), { status: 'verified' });
    await checkApplicationDocument(deps, owner, doc('photo'), {
      status: 'rejected',
      note: 'Too blurred',
    });
    await expect(verifyApplication(deps, owner, id)).rejects.toMatchObject({
      code: 'papers_not_verified',
    });
    const ask = await requestPapers(deps, owner, {
      applicationId: id,
      channel: 'sms',
      origin: ORIGIN,
    });
    expect(ask.text).toContain('Photo');
    const again = await startApplication(db, otp, SECRET, {
      slug,
      phone: mobile,
      code: await code(mobile),
      invite: token(ask.link),
    });
    expect(again).toMatchObject({
      purpose: 'papers',
      papersNeeded: [{ kind: 'photo', title: 'Photo', note: 'Too blurred' }],
    });
    const photo2 = await uploadPaper(db, store, SECRET, {
      slug,
      session: again.session,
      kind: 'photo',
      fileName: 'photo2.png',
      contentType: 'image/png',
      bytes: PNG,
    });
    // A ticket can't be reused by someone else's session.
    await expect(
      sendPapers(db, SECRET, {
        slug,
        session: start.session,
        papers: [{ kind: 'photo', ticket: photo2.ticket.replace(/.$/, 'x') }],
      }),
    ).rejects.toMatchObject({ code: 'paper_invalid' });
    await sendPapers(db, SECRET, {
      slug,
      session: again.session,
      papers: [{ kind: 'photo', ticket: photo2.ticket }],
    });
    rec = await applicationRecord(deps, owner, id);
    expect(rec.state).toBe('documents_pending');
    await checkApplicationDocument(deps, owner, doc('photo'), { status: 'verified' });
    await verifyApplication(deps, owner, id);
    rec = await applicationRecord(deps, owner, id);
    expect(rec).toMatchObject({ state: 'under_review', verifiedBy: 'Owner CRM' });

    // Offer, confirm, enrol: everything the family told the school is on the student's record.
    await offer(deps, owner, id);
    await confirm(deps, owner, id);
    const sectionId = rec.sections[0]?.sectionId ?? '';
    const enrolled = await enrolApplicant(deps, owner, {
      applicationId: id,
      sectionId,
      from: iso(0),
    });
    const facts = await withTenant(db, school.orgId, async (tx) => {
      const [p] = await tx.execute<{
        city: string;
        tongue: string;
        blood: string;
        medical: string;
      }>(sql`
        select city, mother_tongue as tongue, blood_group as blood, medical_notes as medical
        from student_profile where org_id = app_current_org() and person_id = ${enrolled.studentId}`);
      const guardians = await tx.execute<{
        name: string;
        relationship: string;
        emails: string[];
      }>(sql`
        select p.legal_name as name, g.relationship,
          array(select c.address from person_contact c where c.org_id = p.org_id and c.person_id = p.id
            and c.channel = 'email') as emails
        from guardian_link g join person p on p.org_id = g.org_id and p.id = g.guardian_person_id
        where g.org_id = app_current_org() and g.student_person_id = ${enrolled.studentId} order by g.is_primary_contact desc`);
      const [docs] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from record_document where org_id = app_current_org() and person_id = ${enrolled.studentId}`);
      return { profile: p, guardians: [...guardians], docs: docs?.n };
    });
    expect(facts.profile).toEqual({
      city: 'Mysuru',
      tongue: 'Tamil',
      blood: 'O+',
      medical: 'Mild asthma',
    });
    expect(facts.guardians).toEqual([
      { name: 'Synthetic Lakshmi Iyer', relationship: 'mother', emails: ['lakshmi@example.test'] },
      { name: 'Synthetic Arun Iyer', relationship: 'father', emails: ['arun@example.test'] },
    ]);
    // The current copy of each paper: birth certificate and the second, verified photo.
    expect(facts.docs).toBe(2);
    expect(await studentAdmission(deps, owner, enrolled.studentId)).toMatchObject({
      applicationId: id,
      source: 'phone',
      campaign: 'Open day',
      verifiedBy: 'Owner CRM',
      viaForm: true,
      papers: 3,
    });
  });

  it('previews, imports and undoes a bulk upload of leads', async () => {
    const known = phone();
    await addEnquiry(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      classId,
      category: 'general',
      source: 'walk_in',
      childName: 'Synthetic Already Here',
      guardianName: 'Synthetic Parent',
      guardianPhone: known,
    });
    const fresh = phone().slice(3);
    const csv = [
      'Student Name,Class,Father Name,Mobile No.,DOB',
      `Synthetic Kavya,1,Synthetic Ravi,${fresh},15/06/2020`,
      `Synthetic Already Here,Class 1,Synthetic Parent,${known.slice(3)},`,
      'Synthetic Bad,Class 7,Synthetic X,12345,',
    ].join('\n');
    const file = {
      institutionId: school.institutionId,
      yearLabel: YEAR,
      fileName: 'leads.csv',
      bytes: new TextEncoder().encode(csv),
    };
    const preview = await previewLeadImport(deps, owner, file);
    expect(preview).toMatchObject({ total: 3, ready: 1, missingColumns: [] });
    expect(preview.rows.map((r) => [r.row, r.status, r.problems])).toEqual([
      [2, 'ready', []],
      [3, 'duplicate', []],
      [4, 'problem', ['phone', 'class']],
    ]);
    const done = await importLeads(deps, owner, {
      ...file,
      source: 'other',
      campaign: 'Newspaper ad',
      ownerPersonId: principal.personId,
    });
    expect(done).toMatchObject({ imported: 1, skipped: 2 });
    const p = await pipeline(deps, owner, { institutionId: school.institutionId, yearLabel: YEAR });
    const lead = p.applications.find((a) => a.childName === 'Synthetic Kavya');
    expect(lead).toMatchObject({
      state: 'enquiry',
      campaign: 'Newspaper ad',
      owner: { name: 'Principal CRM' },
    });
    expect((await leadImports(deps, owner, school.institutionId))[0]).toMatchObject({
      untouched: 1,
      owner: 'Principal CRM',
    });
    expect(await undoLeadImport(deps, owner, done.batchId)).toEqual({ closed: 1, kept: 0 });
    const after = await pipeline(deps, owner, {
      institutionId: school.institutionId,
      yearLabel: YEAR,
    });
    expect(after.applications.find((a) => a.id === lead?.id)?.state).toBe('lost');
  });
});
