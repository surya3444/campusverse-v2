// Online application forms (docs/specs/ONLINE_APPLICATIONS.md). The school sets up one form per
// admission year with a public link; a family applies after a one-time code proves their mobile,
// and the application enters the ordinary pipeline (source 'website'). The public side has no
// session: it finds its school through ops.admission_form_ref, and its writes are audited with no
// actor, as a payment webhook's are.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { guardiansByPhone } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command, emit } from '@campusverse/platform-events';
import { listFields, saveValues, type Field } from '@campusverse/platform-fields';
import { normaliseIndianMobile, type Otp } from '@campusverse/platform-identity';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor } from '@campusverse/platform-permissions';
import { admissionAgeRule } from '@campusverse/rules';
import { classesIn, classInfo, yearByLabel } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { storeFileIn, type ObjectStore } from '@campusverse/platform-documents';
import type { State } from '../domain/pipeline.js';
import {
  AdmissionError,
  admissionYear,
  detailProblems,
  record,
  writeDetails,
  type AdmissionsDeps,
  type DetailsInput,
  type Relationship,
} from './admissions.js';
import {
  checklistOf,
  DEFAULT_PAPERS,
  hashToken,
  outstanding,
  type FormSection,
  type Paper,
} from './crm.js';

export const APPLIED_ONLINE = 'school.admission.applied_online.v1';
/** Most applications one mobile number may send through one form. */
export const MAX_PER_PHONE = 5;

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () =>
  Array.from({ length: 6 }, () => REF_CHARS[randomInt(REF_CHARS.length)]).join('');
const slugBase = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'school';
const newSlug = (title: string) =>
  `${slugBase(title)}-${Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[randomInt(31)]).join('')}`;

export type AdmissionForm = {
  id: string;
  institutionId: string;
  yearLabel: string;
  slug: string;
  title: string;
  intro: string;
  classIds: string[];
  open: boolean;
  closesOn: string | null;
  /** Applications that came through it. */
  applications: number;
  /** Papers the form asks for, and which optional sections it shows. */
  papers: Paper[];
  sections: FormSection[];
};
export type FormInput = {
  institutionId: string;
  formId?: string | undefined;
  yearLabel: string;
  title: string;
  intro: string;
  classIds: string[];
  open: boolean;
  closesOn: string | null;
  papers?: Paper[] | undefined;
  sections?: FormSection[] | undefined;
};

const SECTIONS: FormSection[] = [
  'second_guardian',
  'address',
  'background',
  'previous_school',
  'health',
];

const formSelect = sql`
  select f.id::text, f.institution_id::text as "institutionId", f.year_label as "yearLabel", f.slug, f.title,
    f.intro, f.class_ids::text[] as "classIds", f.open, f.closes_on::text as "closesOn", f.papers, f.sections,
    (select count(*)::int from school_application a where a.org_id = f.org_id and a.form_id = f.id) as applications
  from school_admission_form f`;

/** The school's online forms, newest year first (`school.admission.manage`). */
export async function admissionForms(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<AdmissionForm[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, institutionId);
    if (!place) throw new AdmissionError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'school.admission.manage', {
      orgId: actor.orgId,
      place,
    });
    return [
      ...(await tx.execute<AdmissionForm>(sql`${formSelect}
        where f.org_id = app_current_org() and f.institution_id = ${institutionId} order by f.year_label desc`)),
    ];
  });
}

/** Sets up or edits the online form for an admission year. A new form gets its public link. */
export async function saveAdmissionForm(
  deps: AdmissionsDeps,
  actor: Actor,
  input: FormInput,
): Promise<{ id: string; slug: string }> {
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeOf(tx, input.institutionId));
  if (!place) throw new AdmissionError('institution_not_found');
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      // The form offers classes the year runs.
      const year = await admissionYear(tx, input.institutionId, input.yearLabel);
      if (year.status === 'closed') throw new AdmissionError('year_not_open', { year: year.label });
      const classes = new Set((await classesIn(tx, year.yearId)).map((c) => c.classId));
      const classIds = [...new Set(input.classIds)];
      if (classIds.length === 0 || classIds.some((c) => !classes.has(c)))
        throw new AdmissionError('class_not_in_year', { year: year.label });
      const papers = input.papers ?? DEFAULT_PAPERS;
      if (
        papers.length > 12 ||
        new Set(papers.map((p) => p.kind)).size !== papers.length ||
        papers.some(
          (p) => !/^[a-z][a-z0-9_]{1,40}$/.test(p.kind) || !p.title.trim() || p.title.length > 80,
        )
      )
        throw new AdmissionError('bad_papers');
      const sections = [...new Set(input.sections ?? SECTIONS)].filter((x) => SECTIONS.includes(x));
      const papersJson = JSON.stringify(
        papers.map((p) => ({ kind: p.kind, title: p.title.trim(), required: p.required })),
      );
      const sectionsArr = `{${sections.join(',')}}`;
      let row: { id: string; slug: string } | undefined;
      if (input.formId) {
        [row] = await tx.execute<{ id: string; slug: string }>(sql`
          update school_admission_form set title = ${input.title.trim()}, intro = ${input.intro.trim()},
            class_ids = ${`{${classIds.join(',')}}`}::uuid[], open = ${input.open}, closes_on = ${input.closesOn}::date,
            papers = ${papersJson}::jsonb, sections = ${sectionsArr}::text[], updated_at = now()
          where org_id = app_current_org() and id = ${input.formId} and institution_id = ${input.institutionId}
          returning id::text, slug`);
        if (!row) throw new AdmissionError('form_not_found');
      } else {
        const [taken] = await tx.execute(sql`
          select 1 from school_admission_form where org_id = app_current_org()
            and institution_id = ${input.institutionId} and year_label = ${input.yearLabel}`);
        if (taken) throw new AdmissionError('form_exists');
        const slug = newSlug(input.title);
        [row] = await tx.execute<{ id: string; slug: string }>(sql`
          insert into school_admission_form (org_id, institution_id, year_label, slug, title, intro, class_ids, open,
            closes_on, papers, sections, created_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${slug}, ${input.title.trim()},
            ${input.intro.trim()}, ${`{${classIds.join(',')}}`}::uuid[], ${input.open}, ${input.closesOn}::date,
            ${papersJson}::jsonb, ${sectionsArr}::text[], ${actor.personId})
          returning id::text, slug`);
        if (!row) throw new Error('saveAdmissionForm: no row');
        await tx.execute(sql`
          insert into ops.admission_form_ref (slug, org_id, form_id) values (${slug}, app_current_org(), ${row.id})`);
      }
      return {
        result: row,
        audit: {
          action: input.formId ? 'school.admission.form_update' : 'school.admission.form_create',
          entityType: 'school_admission_form',
          entityId: row.id,
          dataClass: 'operational',
          detail: {
            yearLabel: input.yearLabel,
            open: input.open,
            classes: classIds.length,
            closesOn: input.closesOn,
          },
        },
      };
    },
  );
}

type FormRow = AdmissionForm & { orgId: string };

/** Finds a public form by its slug, then works inside its school's tenant. */
async function withForm<T>(
  db: Db,
  slug: string,
  work: (tx: Tx, f: FormRow) => Promise<T>,
): Promise<T | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const [ref] = await db.execute<{ orgId: string; formId: string }>(sql`
    select org_id::text as "orgId", form_id::text as "formId" from ops.admission_form_ref where slug = ${slug}`);
  if (!ref) return null;
  return withTenant(db, ref.orgId, async (tx) => {
    const [f] = await tx.execute<AdmissionForm>(sql`${formSelect}
      where f.org_id = app_current_org() and f.id = ${ref.formId}`);
    return f ? work(tx, { ...f, orgId: ref.orgId }) : null;
  });
}

const accepting = async (tx: Tx, f: AdmissionForm) => {
  if (!f.open) return false;
  if (!f.closesOn) return true;
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return (r?.d ?? '') <= f.closesOn;
};

export type PublicForm = {
  title: string;
  intro: string;
  yearLabel: string;
  accepting: boolean;
  classes: {
    classId: string;
    name: string;
    /** The board's age rule for the class, as a hint; the office decides. */
    age: { minYears: number; maxYears: number | null; cutOff: string } | null;
  }[];
  questions: Pick<Field, 'key' | 'label' | 'help' | 'type' | 'options' | 'required' | 'section'>[];
  papers: Paper[];
  sections: FormSection[];
  /** A personal link: who it is for and what it is for (never more than the office typed). */
  invite: {
    purpose: 'apply' | 'papers';
    childName: string | null;
    guardianName: string | null;
    /** Last four digits of the mobile on the application, to verify with. */
    phoneEnds: string | null;
    email: string | null;
    usable: boolean;
  } | null;
};

type InviteHit = {
  id: string;
  applicationId: string | null;
  purpose: 'apply' | 'papers';
  channel: string;
  address: string | null;
  childName: string | null;
  guardianName: string | null;
  usable: boolean;
};

async function inviteOf(tx: Tx, formId: string, token: string | null | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [i] = await tx.execute<InviteHit>(sql`
    select id::text, application_id::text as "applicationId", purpose, channel, address, child_name as "childName",
      guardian_name as "guardianName",
      (cancelled_at is null and submitted_at is null and expires_at > now()) as usable
    from school_admission_invite
    where org_id = app_current_org() and form_id = ${formId} and token_hash = ${hashToken(token)}`);
  return i ?? null;
}

/** What the public page shows: never more than the form's own text, classes and questions. */
export async function publicForm(
  db: Db,
  slug: string,
  inviteToken?: string | null,
): Promise<PublicForm | null> {
  return withForm(db, slug, async (tx, f) => {
    // Only classes the year still runs (a class the school stopped offering drops off the form).
    const year = await yearByLabel(tx, f.institutionId, f.yearLabel);
    const running = year ? new Set((await classesIn(tx, year.yearId)).map((c) => c.classId)) : null;
    const classes = [];
    for (const id of f.classIds) {
      if (running && !running.has(id)) continue;
      const c = await classInfo(tx, id);
      if (c) classes.push({ classId: id, name: c.name, age: admissionAgeRule(c.board, c.code) });
    }
    const i = await inviteOf(tx, f.id, inviteToken);
    let invite: PublicForm['invite'] = null;
    if (i) {
      if (i.usable)
        await tx.execute(sql`
          update school_admission_invite set opened_at = coalesce(opened_at, now())
          where org_id = app_current_org() and id = ${i.id}`);
      const [a] = i.applicationId
        ? await tx.execute<{
            phone: string;
            email: string | null;
            child: string;
            guardian: string;
          }>(sql`
            select guardian_phone as phone, guardian_email as email, child_name as child, guardian_name as guardian
            from school_application where org_id = app_current_org() and id = ${i.applicationId}`)
        : [];
      invite = {
        purpose: i.purpose,
        childName: a?.child ?? i.childName,
        guardianName: a?.guardian ?? i.guardianName,
        phoneEnds: (a?.phone ?? (i.channel !== 'email' ? i.address : null))?.slice(-4) ?? null,
        email: a?.email ?? (i.channel === 'email' ? i.address : null),
        usable: i.usable,
      };
    }
    return {
      title: f.title,
      intro: f.intro,
      yearLabel: f.yearLabel,
      // A personal link to apply works even after the public form closes.
      accepting:
        (await accepting(tx, f)) || (invite?.usable === true && invite.purpose === 'apply'),
      classes,
      // File questions are answered with the papers below; the office fills any others.
      questions: (await listFields(tx, 'admission'))
        .filter((q) => q.type !== 'file')
        .map(({ key, label, help, type, options, required, section }) => ({
          key,
          label,
          help,
          type,
          options,
          required,
          section,
        })),
      papers: f.papers,
      sections: f.sections,
      invite,
    };
  });
}

/** Sends the mobile check code (rate-limited per number and per network address). */
export async function requestApplicationCode(
  db: Db,
  otp: Otp,
  input: { slug: string; phone: string; ip: string },
): Promise<'sent' | 'unknown_form' | 'bad_phone'> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) return 'bad_phone';
  const known = await withForm(db, input.slug, async () => true);
  if (!known) return 'unknown_form';
  await otp.checkSendLimits(phone, input.ip);
  await otp.issue(phone);
  return 'sent';
}

// Sessions: after the code proves the mobile, a signed, short-lived pass lets the family upload
// papers and submit without another code. It names the school, form, mobile and, for a personal
// link or a status check, the invite and application it may touch.

const SESSION_MINUTES = 120;
type Session = { o: string; f: string; p: string; i: string | null; a: string | null; e: number };

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('base64url');

function issueSession(secret: string, s: Omit<Session, 'e'>): string {
  const body = Buffer.from(
    JSON.stringify({ ...s, e: Date.now() + SESSION_MINUTES * 60_000 }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

function readSession(secret: string, token: string, formId: string, orgId: string): Session {
  const [body, mac] = token.split('.');
  const want = body ? sign(secret, body) : '';
  if (
    !body ||
    !mac ||
    mac.length !== want.length ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(want))
  )
    throw new AdmissionError('session_invalid');
  const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  if (s.e < Date.now()) throw new AdmissionError('session_expired');
  if (s.f !== formId || s.o !== orgId) throw new AdmissionError('session_invalid');
  return s;
}

/** A paper uploaded in a session: the file id with a signature tying it to the mobile and form. */
const ticketFor = (secret: string, fileId: string, s: Session) =>
  `${fileId}.${sign(secret, `${fileId}|${s.p}|${s.f}`)}`;
function fileOfTicket(secret: string, ticket: string, s: Session): string {
  const [fileId, mac] = ticket.split('.');
  if (!fileId || !mac || mac !== sign(secret, `${fileId}|${s.p}|${s.f}`))
    throw new AdmissionError('paper_invalid');
  return fileId;
}

export type Prefill = {
  childName: string;
  dateOfBirth: string | null;
  gender: 'female' | 'male' | 'other' | 'not_stated' | null;
  classId: string | null;
  guardianName: string;
  guardianRelationship: string;
  details: DetailsInput;
};

/**
 * The family proves their mobile with the code and gets a session. With a personal link for an
 * application, the mobile must be one the school has for it, and its answers come back filled in.
 */
export async function startApplication(
  db: Db,
  otp: Otp,
  secret: string,
  input: { slug: string; phone: string; code: string; invite?: string | null | undefined },
): Promise<{
  session: string;
  purpose: 'apply' | 'papers';
  prefill: Prefill | null;
  papersNeeded: { kind: string; title: string; note: string | null }[];
}> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new AdmissionError('bad_phone');
  const r = await withForm(db, input.slug, async (tx, f) => {
    const i = await inviteOf(tx, f.id, input.invite);
    if (input.invite && (!i || !i.usable)) throw new AdmissionError('invite_closed');
    let prefill: Prefill | null = null;
    let papersNeeded: { kind: string; title: string; note: string | null }[] = [];
    if (i?.applicationId) {
      const [a] = await tx.execute<
        Prefill & {
          phone: string;
          second: string | null;
          state: State;
          details: Prefill['details'];
        }
      >(sql`
        select child_name as "childName", date_of_birth::text as "dateOfBirth", gender, class_id::text as "classId",
          guardian_name as "guardianName", guardian_relationship as "guardianRelationship",
          guardian_phone as phone, second_guardian_phone as second, state,
          jsonb_build_object('guardianEmail', guardian_email, 'secondGuardianName', second_guardian_name,
            'secondGuardianRelationship', second_guardian_relationship, 'secondGuardianPhone', second_guardian_phone,
            'secondGuardianEmail', second_guardian_email, 'addressLine', address_line, 'city', city,
            'pincode', pincode, 'stateCode', state_code, 'previousSchool', previous_school,
            'placeOfBirth', place_of_birth, 'motherTongue', mother_tongue, 'nationality', nationality,
            'bloodGroup', blood_group) as details
        from school_application where org_id = app_current_org() and id = ${i.applicationId}`);
      if (!a) throw new AdmissionError('invite_closed');
      if (phone !== a.phone && phone !== a.second)
        throw new AdmissionError('phone_not_on_application', { ends: a.phone.slice(-4) });
      prefill = {
        childName: a.childName,
        dateOfBirth: a.dateOfBirth,
        gender: a.gender,
        classId: a.classId,
        guardianName: a.guardianName,
        guardianRelationship: a.guardianRelationship,
        details: a.details,
      };
      if (i.purpose === 'papers')
        papersNeeded = outstanding(await checklistOf(tx, i.applicationId, f.papers))
          .filter((l) => l.status !== 'received')
          .map((l) => ({
            kind: l.kind,
            title: l.title,
            note: l.status === 'rejected' ? l.note : null,
          }));
    } else if (i) {
      prefill = {
        childName: i.childName ?? '',
        dateOfBirth: null,
        gender: null,
        classId: null,
        guardianName: i.guardianName ?? '',
        guardianRelationship: 'mother',
        details: i.channel === 'email' ? { guardianEmail: i.address } : {},
      };
    }
    // Last: a wrong code changes nothing.
    if (!(await otp.verify(phone, input.code))) throw new AdmissionError('invalid_code');
    return {
      session: issueSession(secret, {
        o: f.orgId,
        f: f.id,
        p: phone,
        i: i?.id ?? null,
        a: i?.applicationId ?? null,
      }),
      purpose: i?.purpose ?? 'apply',
      prefill,
      papersNeeded,
    };
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}

/** One paper from the family, stored and scanned like any upload; returns a ticket for submitting. */
export async function uploadPaper(
  db: Db,
  store: ObjectStore,
  secret: string,
  input: {
    slug: string;
    session: string;
    kind: string;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  },
): Promise<{ ticket: string; kind: string; fileName: string }> {
  const r = await withForm(db, input.slug, async (tx, f) => {
    const s = readSession(secret, input.session, f.id, f.orgId);
    if (!f.papers.some((p) => p.kind === input.kind)) throw new AdmissionError('paper_not_asked');
    const fileId = await storeFileIn(tx, store, f.orgId, {
      purpose: 'admission_paper',
      fileName: input.fileName,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    return { ticket: ticketFor(secret, fileId, s), kind: input.kind, fileName: input.fileName };
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}

/** Attaches papers from tickets to an application as the family's; a photo also becomes the applicant photo. */
async function attachPapers(
  tx: Tx,
  secret: string,
  s: Session,
  form: FormRow,
  applicationId: string,
  papers: { kind: string; ticket: string }[],
): Promise<number> {
  for (const p of papers) {
    const asked = form.papers.find((x) => x.kind === p.kind);
    if (!asked) throw new AdmissionError('paper_not_asked');
    const fileId = fileOfTicket(secret, p.ticket, s);
    await tx.execute(sql`
      insert into school_application_document (org_id, application_id, folder, kind, title, file_id, uploaded_by_family)
      values (app_current_org(), ${applicationId}, ${p.kind === 'report_card' ? 'academic' : p.kind === 'transfer_certificate' ? 'transfer' : 'identity'},
        ${p.kind}, ${asked.title}, ${fileId}, true)`);
    if (p.kind === 'photo')
      await tx.execute(sql`
        update school_application set photo_file_id = ${fileId} where org_id = app_current_org() and id = ${applicationId}`);
  }
  return papers.length;
}

export type OnlineApplication = {
  slug: string;
  session: string;
  childName: string;
  dateOfBirth: string;
  gender: 'female' | 'male' | 'other' | 'not_stated';
  classId: string;
  guardianName: string;
  guardianRelationship: Relationship;
  details: DetailsInput;
  custom: Record<string, unknown>;
  papers: { kind: string; ticket: string }[];
  consent: boolean;
};

/**
 * A family's application, after their mobile was proved. Through a personal link for a lead, it
 * completes that lead (no duplicate); otherwise it is a new application, checked for duplicates
 * and siblings as an office enquiry is. Papers arrive with it, waiting for the office's check.
 */
export async function submitOnlineApplication(
  db: Db,
  secret: string,
  input: OnlineApplication,
): Promise<
  | { status: 'received'; reference: string; sibling: boolean }
  | { status: 'duplicate'; reference: string | null }
> {
  if (!input.consent) throw new AdmissionError('consent_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) throw new AdmissionError('bad_date');
  if (input.childName.trim().length < 2 || input.guardianName.trim().length < 2)
    throw new AdmissionError('name_required');
  const bad = detailProblems(input.details);
  if (bad.length > 0) throw new AdmissionError('bad_details', { fields: bad });
  const r = await withForm(db, input.slug, async (tx, f) => {
    const s = readSession(secret, input.session, f.id, f.orgId);
    const i = s.i
      ? (
          await tx.execute<{ usable: boolean; purpose: string }>(sql`
            select (cancelled_at is null and submitted_at is null and expires_at > now()) as usable, purpose
            from school_admission_invite where org_id = app_current_org() and id = ${s.i}`)
        )[0]
      : undefined;
    if (s.i && (!i?.usable || i.purpose !== 'apply')) throw new AdmissionError('invite_closed');
    if (!s.i && !(await accepting(tx, f))) throw new AdmissionError('form_closed');
    if (!f.classIds.includes(input.classId)) throw new AdmissionError('class_not_found');
    const year = await yearByLabel(tx, f.institutionId, f.yearLabel);
    if (year && !(await classesIn(tx, year.yearId)).some((c) => c.classId === input.classId))
      throw new AdmissionError('class_not_found');
    const missing = f.papers
      .filter((p) => p.required && !input.papers.some((x) => x.kind === p.kind))
      .map((p) => p.title);
    // Required papers may follow later: the application then waits as Papers needed.
    let id: string;
    let ref: string;
    let sibling = false;
    if (s.a) {
      const [a] = await tx.execute<{ state: State; ref: string | null }>(sql`
        select state, public_ref as ref from school_application where org_id = app_current_org() and id = ${s.a} for update`);
      if (!a || !['enquiry', 'contacted', 'applied', 'documents_pending'].includes(a.state))
        throw new AdmissionError('form_not_needed');
      ref = a.ref ?? (await freeRef(tx));
      await tx.execute(sql`
        update school_application set child_name = ${input.childName.trim()}, date_of_birth = ${input.dateOfBirth}::date,
          gender = ${input.gender}, class_id = ${input.classId}::uuid, guardian_name = ${input.guardianName.trim()},
          guardian_relationship = ${input.guardianRelationship}, public_ref = ${ref}, form_id = ${f.id},
          consented_at = now(), updated_at = now()
        where org_id = app_current_org() and id = ${s.a}`);
      id = s.a;
      if (a.state === 'enquiry' || a.state === 'contacted')
        await record(
          tx,
          id,
          a.state,
          missing.length ? 'documents_pending' : 'applied',
          null,
          'Online form (personal link)',
        );
    } else {
      const [dup] = await tx.execute<{ ref: string | null }>(sql`
        select public_ref as ref from school_application
        where org_id = app_current_org() and guardian_phone = ${s.p}
          and lower(child_name) = lower(${input.childName.trim()}) and year_label = ${f.yearLabel}
          and state not in ('lost', 'withdrawn', 'rejected')`);
      if (dup) return { status: 'duplicate' as const, reference: dup.ref };
      const [n] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from school_application
        where org_id = app_current_org() and form_id = ${f.id} and guardian_phone = ${s.p}`);
      if ((n?.n ?? 0) >= MAX_PER_PHONE) throw new AdmissionError('too_many_applications');
      const siblings = await guardiansByPhone(tx, s.p);
      sibling = siblings.length > 0;
      ref = await freeRef(tx);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_application (org_id, institution_id, year_label, class_id, category, source, state,
          child_name, date_of_birth, gender, guardian_name, guardian_phone, guardian_relationship,
          sibling_of_person_id, form_id, public_ref, consented_at)
        values (app_current_org(), ${f.institutionId}, ${f.yearLabel}, ${input.classId}, 'general', 'website',
          ${missing.length ? 'documents_pending' : 'applied'}, ${input.childName.trim()}, ${input.dateOfBirth}::date,
          ${input.gender}, ${input.guardianName.trim()}, ${s.p}, ${input.guardianRelationship},
          ${siblings[0]?.studentId ?? null}, ${f.id}, ${ref}, now())
        returning id::text`);
      if (!row) throw new Error('submitOnlineApplication: no row');
      id = row.id;
      await tx.execute(sql`
        insert into school_application_event (org_id, application_id, from_state, to_state, reason, actor_person_id)
        values (app_current_org(), ${id}, null, ${missing.length ? 'documents_pending' : 'applied'},
          ${s.i ? 'Online form (personal link)' : 'Online application form'}, null)`);
    }
    // The verified mobile is the guardian's; the form may not change it.
    await writeDetails(tx, id, input.details);
    const papers = await attachPapers(tx, secret, s, f, id, input.papers);
    const custom = await saveValues(tx, 'admission', id, input.custom, { notAsked: ['file'] });
    if (s.i)
      await tx.execute(sql`
        update school_admission_invite set submitted_at = now(), application_id = coalesce(application_id, ${id}::uuid)
        where org_id = app_current_org() and id = ${s.i}`);
    await writeAudit(tx, null, {
      action: 'school.admission.apply_online',
      entityType: 'school_application',
      entityId: id,
      dataClass: 'sensitive',
      detail: {
        formId: f.id,
        sibling,
        personalLink: !!s.i,
        papers,
        papersMissing: missing.length,
        custom: custom.join(','),
      },
    });
    await emit(tx, { type: APPLIED_ONLINE, payload: { applicationId: id, formId: f.id } });
    return { status: 'received' as const, reference: ref, sibling };
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}

async function freeRef(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const ref = newRef();
    const [taken] = await tx.execute(sql`
      select 1 from school_application where org_id = app_current_org() and public_ref = ${ref}`);
    if (!taken) return ref;
  }
  throw new Error('freeRef: no free reference');
}

/**
 * Papers the office asked for, sent by the family (a papers link, or Check an application). They
 * wait for the office's check; the application stays as Papers needed until it is verified.
 */
export async function sendPapers(
  db: Db,
  secret: string,
  input: { slug: string; session: string; papers: { kind: string; ticket: string }[] },
): Promise<{ sent: number }> {
  if (input.papers.length === 0) throw new AdmissionError('no_papers');
  const r = await withForm(db, input.slug, async (tx, f) => {
    const s = readSession(secret, input.session, f.id, f.orgId);
    if (!s.a) throw new AdmissionError('session_invalid');
    const [a] = await tx.execute<{ state: State }>(sql`
      select state from school_application where org_id = app_current_org() and id = ${s.a} for update`);
    if (!a || !['applied', 'documents_pending', 'under_review'].includes(a.state))
      throw new AdmissionError('papers_not_needed');
    const sent = await attachPapers(tx, secret, s, f, s.a, input.papers);
    if (s.i)
      await tx.execute(sql`
        update school_admission_invite set submitted_at = now()
        where org_id = app_current_org() and id = ${s.i} and purpose = 'papers'`);
    await tx.execute(sql`
      update school_application set updated_at = now() where org_id = app_current_org() and id = ${s.a}`);
    await writeAudit(tx, null, {
      action: 'school.admission.papers_online',
      entityType: 'school_application',
      entityId: s.a,
      dataClass: 'personal',
      detail: { papers: sent, personalLink: !!s.i },
    });
    return { sent };
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}

/** Family words for where an application stands. */
export type FamilyStatus =
  | 'received'
  | 'reviewing'
  | 'papers_needed'
  | 'offered'
  | 'waiting_list'
  | 'confirmed'
  | 'admitted'
  | 'not_taken_forward'
  | 'withdrawn';
const FAMILY: Record<State, FamilyStatus> = {
  enquiry: 'received',
  contacted: 'received',
  applied: 'received',
  documents_pending: 'papers_needed',
  under_review: 'reviewing',
  offered: 'offered',
  waitlisted: 'waiting_list',
  confirmed: 'confirmed',
  enrolled: 'admitted',
  lost: 'not_taken_forward',
  rejected: 'not_taken_forward',
  withdrawn: 'withdrawn',
};

/**
 * A family's applications at this school, after a fresh code: first name, class and status only.
 * Where papers are needed, which ones (with the office's reason for a rejected copy) and a session
 * to send them.
 */
export async function applicationStatus(
  db: Db,
  otp: Otp,
  secret: string,
  input: { slug: string; phone: string; code: string },
): Promise<
  {
    reference: string | null;
    firstName: string;
    className: string;
    status: FamilyStatus;
    offerUntil: string | null;
    papersNeeded: { kind: string; title: string; note: string | null }[];
    session: string | null;
  }[]
> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new AdmissionError('bad_phone');
  const r = await withForm(db, input.slug, async (tx, f) => {
    if (!(await otp.verify(phone, input.code))) throw new AdmissionError('invalid_code');
    const rows = await tx.execute<{
      id: string;
      ref: string | null;
      childName: string;
      classId: string;
      state: State;
      offerUntil: string | null;
    }>(sql`
      select a.id::text, a.public_ref as ref, a.child_name as "childName", a.class_id::text as "classId", a.state,
        a.offer_expires_on::text as "offerUntil"
      from school_application a
      where a.org_id = app_current_org() and a.institution_id = ${f.institutionId}
        and (a.guardian_phone = ${phone} or a.second_guardian_phone = ${phone})
      order by a.created_at desc`);
    const names = new Map<string, string>();
    for (const id of new Set(rows.map((x) => x.classId)))
      names.set(id, (await classInfo(tx, id))?.name ?? '');
    const out = [];
    for (const x of rows) {
      const needs =
        x.state === 'documents_pending'
          ? outstanding(await checklistOf(tx, x.id, f.papers))
              .filter((l) => l.status !== 'received')
              .map((l) => ({
                kind: l.kind,
                title: l.title,
                note: l.status === 'rejected' ? l.note : null,
              }))
          : [];
      out.push({
        reference: x.ref,
        firstName: x.childName.split(' ')[0] ?? x.childName,
        className: names.get(x.classId) ?? '',
        status: FAMILY[x.state],
        offerUntil: x.state === 'offered' ? x.offerUntil : null,
        papersNeeded: needs,
        session:
          needs.length > 0
            ? issueSession(secret, { o: f.orgId, f: f.id, p: phone, i: null, a: x.id })
            : null,
      });
    }
    return out;
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}
