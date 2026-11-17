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
import { classesOf, classInfo } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { State } from '../domain/pipeline.js';
import { AdmissionError, type AdmissionsDeps, type Relationship } from './admissions.js';

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
};

const formSelect = sql`
  select f.id::text, f.institution_id::text as "institutionId", f.year_label as "yearLabel", f.slug, f.title,
    f.intro, f.class_ids::text[] as "classIds", f.open, f.closes_on::text as "closesOn",
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
      const classes = new Set((await classesOf(tx, input.institutionId)).map((c) => c.classId));
      const classIds = [...new Set(input.classIds)];
      if (classIds.length === 0 || classIds.some((c) => !classes.has(c)))
        throw new AdmissionError('class_not_found');
      let row: { id: string; slug: string } | undefined;
      if (input.formId) {
        [row] = await tx.execute<{ id: string; slug: string }>(sql`
          update school_admission_form set title = ${input.title.trim()}, intro = ${input.intro.trim()},
            class_ids = ${`{${classIds.join(',')}}`}::uuid[], open = ${input.open}, closes_on = ${input.closesOn}::date,
            updated_at = now()
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
            closes_on, created_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${slug}, ${input.title.trim()},
            ${input.intro.trim()}, ${`{${classIds.join(',')}}`}::uuid[], ${input.open}, ${input.closesOn}::date,
            ${actor.personId})
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
};

/** What the public page shows: never more than the form's own text, classes and questions. */
export async function publicForm(db: Db, slug: string): Promise<PublicForm | null> {
  return withForm(db, slug, async (tx, f) => {
    const classes = [];
    for (const id of f.classIds) {
      const c = await classInfo(tx, id);
      if (c) classes.push({ classId: id, name: c.name, age: admissionAgeRule(c.board, c.code) });
    }
    return {
      title: f.title,
      intro: f.intro,
      yearLabel: f.yearLabel,
      accepting: await accepting(tx, f),
      classes,
      // File questions wait for papers from the form (step 2); the office fills them meanwhile.
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

export type OnlineApplication = {
  slug: string;
  phone: string;
  code: string;
  childName: string;
  dateOfBirth: string;
  gender: 'female' | 'male' | 'other' | 'not_stated';
  classId: string;
  guardianName: string;
  guardianRelationship: Relationship;
  custom: Record<string, unknown>;
  consent: boolean;
};

/**
 * A family's application. Everything is checked first and the code last, inside the same
 * transaction, so a mistake in the form doesn't use up the code.
 */
export async function submitOnlineApplication(
  db: Db,
  otp: Otp,
  input: OnlineApplication,
): Promise<
  | { status: 'received'; reference: string; sibling: boolean }
  | { status: 'duplicate'; reference: string | null }
> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new AdmissionError('bad_phone');
  if (!input.consent) throw new AdmissionError('consent_required');
  const r = await withForm(db, input.slug, async (tx, f) => {
    if (!(await accepting(tx, f))) throw new AdmissionError('form_closed');
    if (!f.classIds.includes(input.classId)) throw new AdmissionError('class_not_found');
    const [dup] = await tx.execute<{ ref: string | null }>(sql`
      select public_ref as ref from school_application
      where org_id = app_current_org() and guardian_phone = ${phone}
        and lower(child_name) = lower(${input.childName.trim()}) and year_label = ${f.yearLabel}
        and state not in ('lost', 'withdrawn', 'rejected')`);
    if (dup) {
      if (!(await otp.verify(phone, input.code))) throw new AdmissionError('invalid_code');
      return { status: 'duplicate' as const, reference: dup.ref };
    }
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_application
      where org_id = app_current_org() and form_id = ${f.id} and guardian_phone = ${phone}`);
    if ((n?.n ?? 0) >= MAX_PER_PHONE) throw new AdmissionError('too_many_applications');
    const siblings = await guardiansByPhone(tx, phone);
    let row: { id: string; ref: string } | undefined;
    for (let i = 0; i < 5 && !row; i++) {
      const ref = newRef();
      [row] = await tx.execute<{ id: string; ref: string }>(sql`
        insert into school_application (org_id, institution_id, year_label, class_id, category, source, state,
          child_name, date_of_birth, gender, guardian_name, guardian_phone, guardian_relationship,
          sibling_of_person_id, form_id, public_ref, consented_at)
        values (app_current_org(), ${f.institutionId}, ${f.yearLabel}, ${input.classId}, 'general', 'website', 'applied',
          ${input.childName.trim()}, ${input.dateOfBirth}::date, ${input.gender}, ${input.guardianName.trim()}, ${phone},
          ${input.guardianRelationship}, ${siblings[0]?.studentId ?? null}, ${f.id}, ${ref}, now())
        on conflict (org_id, public_ref) do nothing
        returning id::text, public_ref as ref`);
    }
    if (!row) throw new Error('submitOnlineApplication: no free reference');
    await tx.execute(sql`
      insert into school_application_event (org_id, application_id, from_state, to_state, reason, actor_person_id)
      values (app_current_org(), ${row.id}, null, 'applied', 'Online application form', null)`);
    const custom = await saveValues(tx, 'admission', row.id, input.custom, { notAsked: ['file'] });
    await writeAudit(tx, null, {
      action: 'school.admission.apply_online',
      entityType: 'school_application',
      entityId: row.id,
      dataClass: 'personal',
      detail: { formId: f.id, sibling: siblings.length > 0, custom: custom.join(',') },
    });
    await emit(tx, { type: APPLIED_ONLINE, payload: { applicationId: row.id, formId: f.id } });
    // Last: a wrong or used code rolls everything back and the form can be sent again.
    if (!(await otp.verify(phone, input.code))) throw new AdmissionError('invalid_code');
    return { status: 'received' as const, reference: row.ref, sibling: siblings.length > 0 };
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

/** A family's applications at this school, after a fresh code: first name, class and status only. */
export async function applicationStatus(
  db: Db,
  otp: Otp,
  input: { slug: string; phone: string; code: string },
): Promise<
  {
    reference: string | null;
    firstName: string;
    className: string;
    status: FamilyStatus;
    offerUntil: string | null;
  }[]
> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) throw new AdmissionError('bad_phone');
  const r = await withForm(db, input.slug, async (tx, f) => {
    if (!(await otp.verify(phone, input.code))) throw new AdmissionError('invalid_code');
    const rows = await tx.execute<{
      ref: string | null;
      childName: string;
      classId: string;
      state: State;
      offerUntil: string | null;
    }>(sql`
      select a.public_ref as ref, a.child_name as "childName", a.class_id::text as "classId", a.state,
        a.offer_expires_on::text as "offerUntil"
      from school_application a
      where a.org_id = app_current_org() and a.institution_id = ${f.institutionId} and a.guardian_phone = ${phone}
      order by a.created_at desc`);
    const names = new Map<string, string>();
    for (const id of new Set(rows.map((x) => x.classId)))
      names.set(id, (await classInfo(tx, id))?.name ?? '');
    return rows.map((x) => ({
      reference: x.ref,
      firstName: x.childName.split(' ')[0] ?? x.childName,
      className: names.get(x.classId) ?? '',
      status: FAMILY[x.state],
      offerUntil: x.state === 'offered' ? x.offerUntil : null,
    }));
  });
  if (!r) throw new AdmissionError('form_not_found');
  return r;
}
