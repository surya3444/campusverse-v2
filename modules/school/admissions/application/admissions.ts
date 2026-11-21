import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  addEmail,
  addMembership,
  addPhone,
  displayNames,
  createPerson,
  ensureStudentProfile,
  fileDocument,
  findByPhoneAndName,
  guardiansByPhone,
  linkGuardian,
  setPhotoIn,
  setStudentDetailsIn,
} from '@campusverse/people-records';
import { command, type EventInput } from '@campusverse/platform-events';
import { listFields, saveValues, valuesOf, type FieldValue } from '@campusverse/platform-fields';
import { placeOf as placeOfInstitution } from '@campusverse/platform-organisation';
import { assignRole, type Actor, type createPermissions } from '@campusverse/platform-permissions';
import { admissionAgeRule, completedYears } from '@campusverse/rules';
import { enrol, nextRollNumber, sectionHeadcounts } from '@campusverse/school-enrolment';
import {
  classesIn,
  classesOf,
  classInfo,
  sectionsOfYear,
  sectionsOn,
  yearByLabel,
} from '@campusverse/school-setup';
import type { AudiencePort } from '@campusverse/shared-communications';
import { billStudent, feeDisclosure, type FeeDisclosure } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import {
  ageCheck,
  canMove,
  CLOSED,
  handover,
  HOLDS_SEAT,
  OFFERABLE,
  type AgeCheck,
  type State,
} from '../domain/pipeline.js';

type Permissions = ReturnType<typeof createPermissions>;
export type AdmissionsDeps = { db: Db; permissions: Permissions; audience: AudiencePort };

export const APPLICATION_CONFIRMED = 'school.admission.confirmed.v1';
export const STUDENT_ENROLLED = 'school.admission.enrolled.v1';
/** Required papers when the year has no form of its own (as the form's default). */
const DEFAULT_REQUIRED = ['birth_certificate', 'photo', 'address_proof'];
/** Default days to accept an offer (spec default). */
export const OFFER_DAYS = 7;
export type Category = 'general' | 'rte' | 'staff' | 'management';
/** As the student record allows (guardian_link). */
export type Relationship = 'mother' | 'father' | 'guardian' | 'grandparent' | 'sibling' | 'other';

export class AdmissionError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Admission: ${code}`);
    this.name = 'AdmissionError';
  }
}

const PHONE = /^\+91[6-9]\d{9}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function placeFor(tx: Tx, institutionId: string) {
  const p = await placeOfInstitution(tx, institutionId);
  if (!p) throw new AdmissionError('institution_not_found');
  return p;
}

export async function today(tx: Tx) {
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return r?.d ?? '';
}

export type Row = {
  id: string;
  institutionId: string;
  yearLabel: string;
  classId: string;
  category: Category;
  source: string;
  state: State;
  childName: string;
  dateOfBirth: string | null;
  gender: string | null;
  guardianName: string;
  guardianPhone: string;
  guardianRelationship: string;
  offerExpiresOn: string | null;
  siblingOf: string | null;
};

export async function load(tx: Tx, id: string, lock = false): Promise<Row> {
  const [r] = await tx.execute<Row>(sql`
    select id::text, institution_id::text as "institutionId", year_label as "yearLabel", class_id::text as "classId",
      category, source, state, child_name as "childName", date_of_birth::text as "dateOfBirth", gender,
      guardian_name as "guardianName", guardian_phone as "guardianPhone", guardian_relationship as "guardianRelationship",
      offer_expires_on::text as "offerExpiresOn", sibling_of_person_id::text as "siblingOf"
    from school_application where org_id = app_current_org() and id = ${id} ${lock ? sql`for update` : sql``}`);
  if (!r) throw new AdmissionError('application_not_found');
  return r;
}

export async function record(
  tx: Tx,
  id: string,
  from: State | null,
  to: State,
  actorId: string | null,
  reason: string | null = null,
) {
  await tx.execute(sql`
    insert into school_application_event (org_id, application_id, from_state, to_state, reason, actor_person_id)
    values (app_current_org(), ${id}, ${from}, ${to}, ${reason}, ${actorId})`);
  await tx.execute(sql`
    update school_application set state = ${to}, updated_at = now(),
      closed_reason = case when ${CLOSED.has(to)} then ${reason} else closed_reason end
    where org_id = app_current_org() and id = ${id}`);
}

/** What the family tells the school beyond the enquiry, as application columns. */
export const DETAIL_COLUMNS = {
  guardianEmail: 'guardian_email',
  secondGuardianName: 'second_guardian_name',
  secondGuardianRelationship: 'second_guardian_relationship',
  secondGuardianPhone: 'second_guardian_phone',
  secondGuardianEmail: 'second_guardian_email',
  bloodGroup: 'blood_group',
  motherTongue: 'mother_tongue',
  religion: 'religion',
  socialCategory: 'social_category',
  nationality: 'nationality',
  placeOfBirth: 'place_of_birth',
  addressLine: 'address_line',
  city: 'city',
  pincode: 'pincode',
  stateCode: 'state_code',
  previousSchool: 'previous_school',
  disability: 'disability',
  medicalNotes: 'medical_notes',
} as const;
export type DetailKey = keyof typeof DETAIL_COLUMNS;
export type ApplicationDetails = Record<DetailKey, string | null>;
/** Details given in a write: absent leaves a field alone, empty clears it. */
export type DetailsInput = { [K in DetailKey]?: string | null | undefined };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LIMITS: Partial<Record<DetailKey, number>> = {
  secondGuardianName: 120,
  motherTongue: 40,
  religion: 40,
  nationality: 40,
  placeOfBirth: 80,
  addressLine: 300,
  city: 80,
  previousSchool: 160,
  disability: 200,
  medicalNotes: 500,
};
const RELATIONS = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other'];

/** Which given details are not acceptable (empty strings mean "clear"). */
export function detailProblems(d: DetailsInput): DetailKey[] {
  const bad: DetailKey[] = [];
  for (const [k, raw] of Object.entries(d) as [DetailKey, string | null | undefined][]) {
    const v = raw?.trim();
    if (!v) continue;
    const limit = LIMITS[k];
    if (limit !== undefined && v.length > limit) bad.push(k);
    else if (
      (k === 'guardianEmail' || k === 'secondGuardianEmail') &&
      (!EMAIL_RE.test(v) || v.length > 200)
    )
      bad.push(k);
    else if (k === 'secondGuardianPhone' && !PHONE.test(v)) bad.push(k);
    else if (k === 'secondGuardianRelationship' && !RELATIONS.includes(v)) bad.push(k);
    else if (k === 'pincode' && !/^[1-9]\d{5}$/.test(v)) bad.push(k);
    else if (k === 'stateCode' && !/^[A-Z]{2}$/.test(v)) bad.push(k);
    else if (k === 'bloodGroup' && !['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(v))
      bad.push(k);
    else if (
      k === 'socialCategory' &&
      !['general', 'obc', 'sc', 'st', 'ews', 'not_stated'].includes(v)
    )
      bad.push(k);
  }
  const name = d.secondGuardianName?.trim();
  if (name !== undefined && !!name !== !!d.secondGuardianRelationship?.trim())
    bad.push('secondGuardianRelationship');
  return bad;
}

/** Writes the given details (empty clears). Call inside the tenant, after detailProblems. */
export async function writeDetails(
  tx: Tx,
  applicationId: string,
  given: DetailsInput,
): Promise<DetailKey[]> {
  // A second guardian removed takes their relationship, phone and email with them.
  const d =
    given.secondGuardianName !== undefined && !given.secondGuardianName?.trim()
      ? {
          ...given,
          secondGuardianRelationship: null,
          secondGuardianPhone: null,
          secondGuardianEmail: null,
        }
      : given;
  const keys = (Object.keys(d) as DetailKey[]).filter(
    (k) => k in DETAIL_COLUMNS && d[k] !== undefined,
  );
  // One statement, so related columns (a second guardian's name and relationship) change together.
  if (keys.length > 0)
    await tx.execute(sql`
      update school_application set ${sql.join(
        keys.map((k) => {
          const v = d[k]?.trim() || null;
          return sql`${sql.raw(DETAIL_COLUMNS[k])} = ${k.endsWith('Email') && v ? v.toLowerCase() : v}`;
        }),
        sql`, `,
      )}
      where org_id = app_current_org() and id = ${applicationId}`);
  return keys;
}

/**
 * The admission year as the school set it up (Academic years): admissions work only in years the
 * school has. New families and changes need a year that hasn't ended or closed.
 */
export async function admissionYear(tx: Tx, institutionId: string, label: string, open = false) {
  const y = await yearByLabel(tx, institutionId, label);
  if (!y) throw new AdmissionError('year_not_set_up', { year: label });
  if (open && (y.status === 'ended' || y.status === 'closed'))
    throw new AdmissionError('year_not_open', { year: label });
  return y;
}

/** A class the year runs (it has open sections that year). */
export async function assertClassInYear(tx: Tx, yearId: string, classId: string, label: string) {
  if (!(await classesIn(tx, yearId)).some((c) => c.classId === classId))
    throw new AdmissionError('class_not_in_year', { year: label });
}

export type EnquiryInput = {
  institutionId: string;
  yearLabel: string;
  classId: string;
  category: Category;
  source: 'walk_in' | 'phone' | 'website' | 'referral' | 'rte_portal' | 'other';
  childName: string;
  dateOfBirth?: string | null | undefined;
  gender?: 'female' | 'male' | 'other' | 'not_stated' | null | undefined;
  guardianName: string;
  guardianPhone: string;
  guardianRelationship?: Relationship | undefined;
  nextFollowUp?: string | null | undefined;
  notes?: string | null | undefined;
  /** Owner-defined admission questions, by key (decision 0020). */
  custom?: Record<string, unknown> | undefined;
  details?: DetailsInput | undefined;
  ownerPersonId?: string | null | undefined;
  interest?: 'hot' | 'warm' | 'cold' | null | undefined;
  campaign?: string | null | undefined;
};

/**
 * A new enquiry. A guardian phone that matches a current student's guardian is flagged as a
 * likely sibling; an open application with the same phone and child is refused as a duplicate.
 */
export async function addEnquiry(
  deps: AdmissionsDeps,
  actor: Actor,
  input: EnquiryInput,
): Promise<{ id: string; siblings: { studentName: string }[] }> {
  if (!PHONE.test(input.guardianPhone)) throw new AdmissionError('bad_phone');
  if (input.dateOfBirth && !DATE.test(input.dateOfBirth)) throw new AdmissionError('bad_date');
  if (input.category === 'rte' && input.source !== 'rte_portal')
    throw new AdmissionError('rte_from_portal_only');
  const bad = detailProblems(input.details ?? {});
  if (bad.length > 0) throw new AdmissionError('bad_details', { fields: bad });
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const c = await classInfo(tx, input.classId);
      if (!c || c.institutionId !== input.institutionId)
        throw new AdmissionError('class_not_found');
      const year = await admissionYear(tx, input.institutionId, input.yearLabel, true);
      await assertClassInYear(tx, year.yearId, input.classId, year.label);
      const [dup] = await tx.execute<{ id: string }>(sql`
        select id::text from school_application
        where org_id = app_current_org() and guardian_phone = ${input.guardianPhone}
          and lower(child_name) = lower(${input.childName.trim()}) and year_label = ${input.yearLabel}
          and state not in ('lost', 'withdrawn', 'rejected')`);
      if (dup) throw new AdmissionError('duplicate', { applicationId: dup.id });
      const siblings = await guardiansByPhone(tx, input.guardianPhone);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_application (org_id, institution_id, year_label, class_id, category, source, child_name,
          date_of_birth, gender, guardian_name, guardian_phone, guardian_relationship, next_follow_up, notes,
          sibling_of_person_id, created_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${input.classId}, ${input.category},
          ${input.source}, ${input.childName.trim()}, ${input.dateOfBirth ?? null}::date, ${input.gender ?? null},
          ${input.guardianName.trim()}, ${input.guardianPhone}, ${input.guardianRelationship ?? 'guardian'},
          ${input.nextFollowUp ?? null}::date, ${input.notes?.trim() || null}, ${siblings[0]?.studentId ?? null},
          ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('addEnquiry: no row');
      await record(tx, row.id, null, 'enquiry', actor.personId);
      await writeDetails(tx, row.id, input.details ?? {});
      await tx.execute(sql`
        update school_application set owner_person_id = ${input.ownerPersonId ?? null}::uuid,
          interest = ${input.interest ?? null}, campaign = ${input.campaign?.trim() || null}
        where org_id = app_current_org() and id = ${row.id}`);
      if (input.nextFollowUp)
        await tx.execute(sql`
          insert into school_admission_follow_up (org_id, application_id, due_on, purpose, assigned_to_person_id,
            created_by_person_id)
          values (app_current_org(), ${row.id}, ${input.nextFollowUp}::date, 'First follow-up',
            ${input.ownerPersonId ?? actor.personId}, ${actor.personId})`);
      const custom = await saveValues(tx, 'admission', row.id, input.custom ?? {});
      return {
        result: { id: row.id, siblings: siblings.map((s) => ({ studentName: s.studentName })) },
        audit: {
          action: 'school.admission.manage',
          entityType: 'school_application',
          entityId: row.id,
          dataClass: 'personal',
          detail: {
            source: input.source,
            category: input.category,
            sibling: siblings.length > 0,
            custom: custom.join(','),
          },
        },
      };
    },
  );
}

export async function command_<T>(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
  permission: string,
  work: (
    tx: Tx,
    a: Row,
  ) => Promise<{
    result: T;
    detail: Record<string, string | number | boolean | null>;
    reason?: string;
    events?: EventInput[];
  }>,
): Promise<T> {
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeFor(tx, (await load(tx, applicationId)).institutionId),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission, resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const a = await load(tx, applicationId, true);
      const r = await work(tx, a);
      return {
        result: r.result,
        audit: {
          action: permission,
          entityType: 'school_application',
          entityId: applicationId,
          dataClass: 'personal',
          ...(r.reason ? { reason: r.reason } : {}),
          detail: r.detail,
        },
        events: r.events ?? [],
      };
    },
  );
}

/** A plain move along the pipeline (contacted, applied, under review, rejected…). */
export async function moveApplication(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { applicationId: string; to: State; reason?: string | null | undefined },
): Promise<void> {
  await command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    const err = canMove(a.state, input.to, input.reason ?? null);
    if (err) throw new AdmissionError(err, { from: a.state, to: input.to });
    if (input.to === 'waitlisted') {
      await tx.execute(sql`
        update school_application set waitlist_position = coalesce((
          select max(waitlist_position) + 1 from school_application
          where org_id = app_current_org() and institution_id = ${a.institutionId} and year_label = ${a.yearLabel}
            and class_id = ${a.classId} and category = ${a.category} and state = 'waitlisted'), 1)
        where org_id = app_current_org() and id = ${a.id}`);
    }
    await record(tx, a.id, a.state, input.to, actor.personId, input.reason?.trim() || null);
    return {
      result: undefined,
      detail: { from: a.state, to: input.to },
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    };
  });
}

/** Details added after the enquiry; an age outside the rule needs a reason and an order reference. */
export async function updateApplication(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    applicationId: string;
    dateOfBirth?: string | null | undefined;
    gender?: 'female' | 'male' | 'other' | 'not_stated' | null | undefined;
    previousSchool?: string | null | undefined;
    notes?: string | null | undefined;
    nextFollowUp?: string | null | undefined;
    ageOverride?: { reason: string; orderRef: string } | null | undefined;
    custom?: Record<string, unknown> | undefined;
    details?: DetailsInput | undefined;
    childName?: string | undefined;
    guardianName?: string | undefined;
    guardianPhone?: string | undefined;
    guardianRelationship?: Relationship | undefined;
    classId?: string | undefined;
  },
): Promise<void> {
  const bad = detailProblems(input.details ?? {});
  if (bad.length > 0) throw new AdmissionError('bad_details', { fields: bad });
  if (input.guardianPhone !== undefined && !PHONE.test(input.guardianPhone))
    throw new AdmissionError('bad_phone');
  if (
    (input.childName !== undefined && input.childName.trim().length < 2) ||
    (input.guardianName !== undefined && input.guardianName.trim().length < 2)
  )
    throw new AdmissionError('name_required');
  if (
    input.ageOverride &&
    (input.ageOverride.reason.trim().length < 3 || input.ageOverride.orderRef.trim().length < 2)
  ) {
    throw new AdmissionError('override_needs_reason_and_order');
  }
  if (input.dateOfBirth && !DATE.test(input.dateOfBirth)) throw new AdmissionError('bad_date');
  await command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    if (input.classId !== undefined && input.classId !== a.classId) {
      if (
        ![
          'enquiry',
          'contacted',
          'applied',
          'documents_pending',
          'under_review',
          'waitlisted',
        ].includes(a.state)
      )
        throw new AdmissionError('class_fixed', { state: a.state });
      const c = await classInfo(tx, input.classId);
      if (!c || c.institutionId !== a.institutionId) throw new AdmissionError('class_not_found');
      const year = await admissionYear(tx, a.institutionId, a.yearLabel, true);
      await assertClassInYear(tx, year.yearId, input.classId, year.label);
    }
    const details = await writeDetails(tx, input.applicationId, input.details ?? {});
    await tx.execute(sql`
      update school_application set
        child_name = coalesce(${input.childName?.trim() ?? null}, child_name),
        guardian_name = coalesce(${input.guardianName?.trim() ?? null}, guardian_name),
        guardian_phone = coalesce(${input.guardianPhone ?? null}, guardian_phone),
        guardian_relationship = coalesce(${input.guardianRelationship ?? null}, guardian_relationship),
        class_id = coalesce(${input.classId ?? null}::uuid, class_id),
        date_of_birth = case when ${input.dateOfBirth !== undefined} then ${input.dateOfBirth ?? null}::date else date_of_birth end,
        gender = case when ${input.gender !== undefined} then ${input.gender ?? null} else gender end,
        previous_school = case when ${input.previousSchool !== undefined} then ${input.previousSchool ?? null} else previous_school end,
        notes = case when ${input.notes !== undefined} then ${input.notes ?? null} else notes end,
        next_follow_up = case when ${input.nextFollowUp !== undefined} then ${input.nextFollowUp ?? null}::date else next_follow_up end,
        age_override_reason = case when ${input.ageOverride !== undefined} then ${input.ageOverride?.reason ?? null} else age_override_reason end,
        age_order_ref = case when ${input.ageOverride !== undefined} then ${input.ageOverride?.orderRef ?? null} else age_order_ref end,
        updated_at = now()
      where org_id = app_current_org() and id = ${input.applicationId}`);
    const custom = await saveValues(tx, 'admission', input.applicationId, input.custom ?? {});
    return {
      result: undefined,
      detail: {
        ageOverride: !!input.ageOverride,
        custom: custom.join(','),
        details: details.join(','),
        basics: ['childName', 'guardianName', 'guardianPhone', 'guardianRelationship', 'classId']
          .filter((k) => input[k as keyof typeof input] !== undefined)
          .join(','),
      },
      ...(input.ageOverride
        ? { reason: `${input.ageOverride.reason} (${input.ageOverride.orderRef})` }
        : {}),
    };
  });
}

export async function ageOf(tx: Tx, a: Row): Promise<AgeCheck> {
  const c = await classInfo(tx, a.classId);
  return ageCheck(
    c ? admissionAgeRule(c.board, c.code) : null,
    a.dateOfBirth,
    a.yearLabel,
    completedYears,
  );
}

export async function seatsLeft(
  tx: Tx,
  a: Pick<Row, 'institutionId' | 'yearLabel' | 'classId' | 'category'>,
) {
  const [r] = await tx.execute<{ seats: number | null; held: number }>(sql`
    select (select seats from school_admission_seat where org_id = app_current_org() and institution_id = ${a.institutionId}
        and year_label = ${a.yearLabel} and class_id = ${a.classId} and category = ${a.category}) as seats,
      (select count(*)::int from school_application where org_id = app_current_org() and institution_id = ${a.institutionId}
        and year_label = ${a.yearLabel} and class_id = ${a.classId} and category = ${a.category}
        and state = any(${`{${[...HOLDS_SEAT].join(',')}}`}::text[])) as held`);
  return r?.seats === null || r?.seats === undefined ? null : r.seats - r.held;
}

/** The fees an offer discloses: the plans for the application's year that name its class or a section of it. */
async function disclosureFor(
  tx: Tx,
  a: Pick<Row, 'institutionId' | 'classId' | 'yearLabel'>,
): Promise<FeeDisclosure[]> {
  const year = await yearByLabel(tx, a.institutionId, a.yearLabel);
  const sections = year
    ? (await sectionsOfYear(tx, year.yearId, year.starts)).filter((s) => s.classId === a.classId)
    : (await sectionsOn(tx, a.institutionId, await today(tx))).filter(
        (s) => s.classId === a.classId,
      );
  return feeDisclosure(
    tx,
    a.institutionId,
    [a.classId, ...sections.map((s) => s.sectionId)],
    year?.yearId ?? null,
  );
}

export async function makeOffer(tx: Tx, a: Row, actorId: string | null, reason: string | null) {
  const left = await seatsLeft(tx, a);
  if (left !== null && left <= 0) throw new AdmissionError('no_seat');
  if ((await disclosureFor(tx, a)).length === 0) throw new AdmissionError('no_fee_plan');
  const age = await ageOf(tx, a);
  if ((age.status === 'too_young' || age.status === 'too_old') && !(await hasOverride(tx, a.id))) {
    throw new AdmissionError('age_outside_rule', age);
  }
  await tx.execute(sql`
    update school_application set offer_expires_on = app_today() + ${OFFER_DAYS}::int, waitlist_position = null
    where org_id = app_current_org() and id = ${a.id}`);
  await record(tx, a.id, a.state, 'offered', actorId, reason);
}

export async function hasOverride(tx: Tx, id: string) {
  const [r] = await tx.execute(sql`
    select 1 from school_application where org_id = app_current_org() and id = ${id} and age_override_reason is not null`);
  return !!r;
}

/**
 * An offer, with the full fee structure shown (no offer without a published fee plan for the
 * class), a seat held, and an expiry. Class 10 and 12 entries need the principal's offer permission,
 * as every offer does.
 */
export async function offer(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<{ expiresOn: string }> {
  return command_(deps, actor, applicationId, 'school.admission.offer', async (tx, a) => {
    if (!OFFERABLE.has(a.state)) throw new AdmissionError('not_offerable', { state: a.state });
    if (a.category === 'rte' && a.source !== 'rte_portal')
      throw new AdmissionError('rte_from_portal_only');
    await makeOffer(tx, a, actor.personId, null);
    const [r] = await tx.execute<{ e: string }>(sql`
      select offer_expires_on::text as e from school_application where org_id = app_current_org() and id = ${a.id}`);
    return { result: { expiresOn: r?.e ?? '' }, detail: { expiresOn: r?.e ?? '' } };
  });
}

/** The family accepts the offer before it expires. */
export async function confirm(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<void> {
  await command_(deps, actor, applicationId, 'school.admission.manage', async (tx, a) => {
    if (a.state !== 'offered') throw new AdmissionError('not_offered');
    if (a.offerExpiresOn && a.offerExpiresOn < (await today(tx)))
      throw new AdmissionError('offer_lapsed');
    await record(tx, a.id, 'offered', 'confirmed', actor.personId);
    return {
      result: undefined,
      detail: { classId: a.classId },
      events: [
        { type: APPLICATION_CONFIRMED, payload: { applicationId: a.id, classId: a.classId } },
      ],
    };
  });
}

/**
 * Lapsed offers free their seats, and the next waitlisted applicant for the same class and
 * category is offered. Runs before the pipeline is read and from the worker; safe to repeat.
 */
export async function lapseOffers(tx: Tx, institutionId: string): Promise<number> {
  const lapsed = await tx.execute<{ id: string }>(sql`
    select id::text from school_application
    where org_id = app_current_org() and institution_id = ${institutionId} and state = 'offered'
      and offer_expires_on < app_today()
    for update skip locked`);
  for (const l of lapsed) {
    const a = await load(tx, l.id);
    await record(tx, a.id, 'offered', 'lost', null, 'Offer lapsed');
    const [next] = await tx.execute<{ id: string }>(sql`
      select id::text from school_application
      where org_id = app_current_org() and institution_id = ${a.institutionId} and year_label = ${a.yearLabel}
        and class_id = ${a.classId} and category = ${a.category} and state = 'waitlisted'
      order by waitlist_position nulls last, created_at limit 1 for update`);
    if (next) {
      // No seat or no fee plan: the next applicant stays waitlisted for a person to decide.
      await makeOffer(tx, await load(tx, next.id), null, 'Seat freed by a lapsed offer').catch(
        (e: unknown) => {
          if (!(e instanceof AdmissionError)) throw e;
        },
      );
    }
  }
  return lapsed.length;
}

export type Enrolled = {
  studentId: string;
  admissionNumber: string;
  rollNumber: number;
  /** Class and section, as the school writes it ("Class 3-A"). */
  sectionLabel: string;
  invoices: number;
  totalPaise: number;
  handover: string[];
};

/**
 * Enrolment, in one transaction: the student record and membership, the guardian (found by phone
 * and name, or created) with parent access, the enrolment with the next admission number, and the
 * fee invoices from every published plan that covers the section.
 */
export async function enrolApplicant(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { applicationId: string; sectionId: string; from: string },
): Promise<Enrolled> {
  if (!DATE.test(input.from)) throw new AdmissionError('bad_date');
  return command_(deps, actor, input.applicationId, 'school.admission.enrol', async (tx, a) => {
    if (a.state !== 'confirmed') throw new AdmissionError('not_confirmed');
    // A section of the class in the year applied for, open to new students, from a day in that year.
    const year = await admissionYear(tx, a.institutionId, a.yearLabel);
    if (year.status === 'closed') throw new AdmissionError('year_not_open', { year: year.label });
    if (input.from < year.starts || input.from >= year.ends)
      throw new AdmissionError('from_outside_year', { year: year.label, starts: year.starts });
    const section = (await sectionsOfYear(tx, year.yearId, input.from)).find(
      (s) => s.sectionId === input.sectionId,
    );
    if (!section || section.classId !== a.classId) throw new AdmissionError('section_not_in_class');
    if (section.closed) throw new AdmissionError('section_closed');

    const studentId = await createPerson(tx, {
      legalName: a.childName,
      dateOfBirth: a.dateOfBirth,
      source: 'admission',
    });
    await ensureStudentProfile(tx, studentId);
    if (a.gender) {
      await tx.execute(
        sql`update student_profile set gender = ${a.gender} where org_id = app_current_org() and person_id = ${studentId}`,
      );
    }
    await addMembership(tx, {
      personId: studentId,
      institutionId: a.institutionId,
      kind: 'student',
      from: input.from,
      until: section.yearEnds,
    });

    const [counter] = await tx.execute<{ n: number }>(sql`
      insert into school_number_counter (org_id, institution_id, kind, year_label, next_number)
      values (app_current_org(), ${a.institutionId}, 'admission', ${a.yearLabel}, 2)
      on conflict (org_id, institution_id, kind, year_label) do update set next_number = school_number_counter.next_number + 1
      returning next_number - 1 as n`);
    const admissionNumber = `${a.yearLabel.slice(0, 4)}-${String(counter?.n ?? 1).padStart(4, '0')}`;
    // Next roll number in the section, so the register and hall tickets have it from day one.
    const rollNumber = await nextRollNumber(tx, input.sectionId, input.from);
    await enrol(tx, {
      personId: studentId,
      institutionId: a.institutionId,
      sectionId: input.sectionId,
      admissionNumber,
      rollNumber,
      from: input.from,
      until: section.yearEnds,
    });

    let guardianId = await findByPhoneAndName(tx, a.guardianPhone, a.guardianName);
    if (!guardianId) {
      guardianId = await createPerson(tx, { legalName: a.guardianName, source: 'admission' });
      await addPhone(tx, guardianId, a.guardianPhone);
      await assignRole(tx, {
        personId: guardianId,
        roleKey: 'parent',
        scope: { type: 'organisation', id: actor.orgId },
      });
    }
    await linkGuardian(tx, {
      guardianId,
      studentId,
      relationship: a.guardianRelationship,
      primary: true,
    });
    // Everything the family told the school becomes the student's record (owner's brief, 20 Nov 2026).
    const d = await detailsOf(tx, a.id);
    if (d.guardianEmail) await addEmail(tx, guardianId, d.guardianEmail);
    let secondGuardian = false;
    if (d.secondGuardianName && d.secondGuardianRelationship) {
      let second = d.secondGuardianPhone
        ? await findByPhoneAndName(tx, d.secondGuardianPhone, d.secondGuardianName)
        : null;
      if (!second) {
        second = await createPerson(tx, { legalName: d.secondGuardianName, source: 'admission' });
        if (d.secondGuardianPhone) await addPhone(tx, second, d.secondGuardianPhone);
        await assignRole(tx, {
          personId: second,
          roleKey: 'parent',
          scope: { type: 'organisation', id: actor.orgId },
        });
      }
      if (d.secondGuardianEmail) await addEmail(tx, second, d.secondGuardianEmail);
      if (second !== guardianId) {
        await linkGuardian(tx, {
          guardianId: second,
          studentId,
          relationship: d.secondGuardianRelationship,
          primary: false,
        });
        secondGuardian = true;
      }
    }
    const carriedDetails = await setStudentDetailsIn(tx, studentId, {
      bloodGroup: d.bloodGroup,
      motherTongue: d.motherTongue,
      religion: d.religion,
      socialCategory: d.socialCategory,
      nationality: d.nationality,
      placeOfBirth: d.placeOfBirth,
      addressLine: d.addressLine,
      city: d.city,
      pincode: d.pincode,
      stateCode: d.stateCode,
      previousSchool: d.previousSchool,
      disability: d.disability,
      medicalNotes: d.medicalNotes,
    });
    // The school's own questions carry over where the student record asks the same one.
    const answers = await valuesOf(tx, 'admission', a.id);
    const asked = new Map((await listFields(tx, 'admission')).map((f) => [f.key, f.type]));
    const studentTypes = new Map((await listFields(tx, 'student')).map((f) => [f.key, f.type]));
    const shared = Object.fromEntries(
      Object.entries(answers).filter(
        ([k, v]) => v !== null && asked.get(k) !== 'file' && studentTypes.get(k) === asked.get(k),
      ),
    );
    const carriedAnswers =
      Object.keys(shared).length > 0
        ? await saveValues(tx, 'student', studentId, shared, { notAsked: ['file'] })
        : [];
    // The applicant's photo and papers become the student's (Milestone 21), checks and all.
    const carried = await carryToStudent(tx, a.id, studentId, actor.personId);

    const bill = await billStudent(tx, deps.audience, {
      studentId,
      institutionId: a.institutionId,
      actorId: actor.personId,
      // The year joined: its plans, and only instalments from the first day.
      asOf: input.from,
    });
    // Enrolled and its student are set together (a CHECK holds them in step).
    await tx.execute(sql`
      insert into school_application_event (org_id, application_id, from_state, to_state, actor_person_id)
      values (app_current_org(), ${a.id}, 'confirmed', 'enrolled', ${actor.personId})`);
    await tx.execute(sql`
      update school_application set state = 'enrolled', student_person_id = ${studentId}, updated_at = now()
      where org_id = app_current_org() and id = ${a.id}`);
    return {
      result: {
        studentId,
        admissionNumber,
        rollNumber,
        sectionLabel: section.label,
        invoices: bill.invoices,
        totalPaise: bill.totalPaise,
        handover: handover({
          documentsPending: true,
          rte: a.category === 'rte',
          sibling: !!a.siblingOf,
        }),
      },
      detail: {
        studentId,
        admissionNumber,
        invoices: bill.invoices,
        documents: carried,
        details: carriedDetails.join(','),
        answers: carriedAnswers.join(','),
        secondGuardian,
      },
      events: [
        {
          type: STUDENT_ENROLLED,
          payload: {
            applicationId: a.id,
            studentId,
            institutionId: a.institutionId,
            sectionId: input.sectionId,
            admissionNumber,
            rollNumber,
          },
        },
      ],
    };
  });
}

export type Pipeline = {
  yearLabel: string;
  /** The school's year: whether new families can still be added (not ended or closed). */
  year: { status: 'planned' | 'active' | 'ended' | 'closed'; starts: string; ends: string };
  counts: Record<State, number>;
  classes: {
    classId: string;
    name: string;
    /** Admission seats set for the year (all categories), if set. */
    seats: number | null;
    held: number;
    /** Places in the year's open sections. */
    capacity: number;
    /** Students in the year's open sections (today, or the year's first or last day). */
    students: number;
    /** Offered or confirmed, not enrolled yet. */
    promised: number;
    /** The class runs in the year (it has open sections). */
    running: boolean;
  }[];
  applications: {
    id: string;
    childName: string;
    className: string;
    state: State;
    category: Category;
    source: string;
    guardianPhone: string;
    nextFollowUp: string | null;
    offerExpiresOn: string | null;
    sibling: boolean;
    updatedAt: string;
    createdAt: string;
    classId: string;
    reference: string | null;
    guardianName: string;
    guardianEmail: string | null;
    owner: { personId: string; name: string } | null;
    interest: 'hot' | 'warm' | 'cold' | null;
    campaign: string | null;
    verified: boolean;
    lastContactAt: string | null;
    lastContactKind: string | null;
    nextPurpose: string | null;
    /** Required papers: how many verified, waiting for a check, rejected, of how many. */
    papers: { required: number; verified: number; waiting: number; rejected: number };
    /** The latest personal form link: sent, opened by the family, or submitted. */
    form: { state: 'sent' | 'opened' | 'submitted'; at: string } | null;
  }[];
};

/** The pipeline for one admission year. Lapsed offers are settled first. */
export async function pipeline(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { institutionId: string; yearLabel: string },
): Promise<Pipeline> {
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  // Lapsing writes (with history); do it as the system before reading, in its own transaction.
  await withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.admission.manage', {
      orgId: actor.orgId,
      place,
    });
    await lapseOffers(tx, input.institutionId);
  });
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const year = await admissionYear(tx, input.institutionId, input.yearLabel);
    // The classes that year runs, and any class that still has families from before it stopped.
    const running = await classesIn(tx, year.yearId);
    const withFamilies = new Set(
      (
        await tx.execute<{ c: string }>(sql`
          select distinct class_id::text as c from school_application
          where org_id = app_current_org() and institution_id = ${input.institutionId} and year_label = ${input.yearLabel}`)
      ).map((r) => r.c),
    );
    const capacity = new Map(running.map((c) => [c.classId, c.capacity]));
    // Students already in the year's open sections (imported, moved up at year end or enrolled):
    // counted today in the running year, on the first day of a coming one, the last of a past one.
    const day = await today(tx);
    const countOn =
      day < year.starts
        ? year.starts
        : day >= year.ends
          ? new Date(Date.parse(`${year.ends}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)
          : day;
    const open = (await sectionsOfYear(tx, year.yearId, countOn)).filter((x) => !x.closed);
    const heads = await sectionHeadcounts(
      tx,
      open.map((x) => x.sectionId),
      countOn,
    );
    const students = new Map<string, number>();
    for (const x of open)
      students.set(x.classId, (students.get(x.classId) ?? 0) + (heads.get(x.sectionId) ?? 0));
    // Families offered or confirmed but not enrolled yet: their seats are promised.
    const promised = new Map(
      (
        await tx.execute<{ classId: string; n: number }>(sql`
          select class_id::text as "classId", count(*)::int as n from school_application
          where org_id = app_current_org() and institution_id = ${input.institutionId}
            and year_label = ${input.yearLabel} and state in ('offered', 'confirmed')
          group by class_id`)
      ).map((r) => [r.classId, r.n]),
    );
    const classes = (await classesOf(tx, input.institutionId)).filter(
      (c) => capacity.has(c.classId) || withFamilies.has(c.classId),
    );
    const seats = await tx.execute<{ classId: string; seats: number; held: number }>(sql`
      select s.class_id::text as "classId", sum(s.seats)::int as seats,
        (select count(*)::int from school_application a where a.org_id = s.org_id and a.institution_id = s.institution_id
          and a.year_label = s.year_label and a.class_id = s.class_id
          and a.state = any(${`{${[...HOLDS_SEAT].join(',')}}`}::text[])) as held
      from school_admission_seat s
      where s.org_id = app_current_org() and s.institution_id = ${input.institutionId} and s.year_label = ${input.yearLabel}
      group by s.org_id, s.institution_id, s.year_label, s.class_id`);
    const bySeat = new Map(seats.map((s) => [s.classId, s]));
    const rows = await tx.execute<
      Omit<Pipeline['applications'][number], 'owner' | 'papers' | 'form'> & {
        ownerId: string | null;
        formState: 'sent' | 'opened' | 'submitted' | null;
        formAt: string | null;
      }
    >(sql`
      select a.id::text, a.child_name as "childName", c.name as "className", a.state, a.category, a.source,
        a.guardian_phone as "guardianPhone", a.next_follow_up::text as "nextFollowUp",
        a.offer_expires_on::text as "offerExpiresOn", a.sibling_of_person_id is not null as sibling,
        a.updated_at::text as "updatedAt", a.created_at::text as "createdAt", a.class_id::text as "classId",
        a.public_ref as reference, a.guardian_name as "guardianName", a.guardian_email as "guardianEmail",
        a.owner_person_id::text as "ownerId", a.interest, a.campaign, a.verified_at is not null as verified,
        act.at::text as "lastContactAt", act.kind as "lastContactKind",
        (select f.purpose from school_admission_follow_up f where f.org_id = a.org_id and f.application_id = a.id
          and f.done_at is null order by f.due_on limit 1) as "nextPurpose",
        case when inv.submitted_at is not null then 'submitted' when inv.opened_at is not null then 'opened'
          when inv.id is not null then 'sent' end as "formState",
        coalesce(inv.submitted_at, inv.opened_at, inv.created_at)::text as "formAt"
      from school_application a join school_class c on c.org_id = a.org_id and c.id = a.class_id
      left join lateral (select x.at, x.kind from school_admission_activity x
        where x.org_id = a.org_id and x.application_id = a.id order by x.at desc limit 1) act on true
      left join lateral (select i.id, i.created_at, i.opened_at, i.submitted_at from school_admission_invite i
        where i.org_id = a.org_id and i.application_id = a.id and i.cancelled_at is null
        order by i.created_at desc limit 1) inv on true
      where a.org_id = app_current_org() and a.institution_id = ${input.institutionId} and a.year_label = ${input.yearLabel}
      order by a.updated_at desc limit 1000`);
    const form = await tx.execute<{ papers: { kind: string; required: boolean }[] }>(sql`
      select papers from school_admission_form
      where org_id = app_current_org() and institution_id = ${input.institutionId} and year_label = ${input.yearLabel}`);
    const required = (form[0]?.papers ?? DEFAULT_REQUIRED.map((kind) => ({ kind, required: true })))
      .filter((p) => p.required)
      .map((p) => p.kind);
    const docs = await tx.execute<{ a: string; kind: string; status: string }>(sql`
      select distinct on (d.application_id, d.kind) d.application_id::text as a, d.kind, d.status
      from school_application_document d join school_application a on a.org_id = d.org_id and a.id = d.application_id
      where d.org_id = app_current_org() and a.institution_id = ${input.institutionId}
        and a.year_label = ${input.yearLabel} and d.kind = any(${`{${required.join(',')}}`}::text[])
      order by d.application_id, d.kind, d.uploaded_at desc`);
    const owners = await displayNames(
      tx,
      rows.flatMap((r) => (r.ownerId ? [r.ownerId] : [])),
    );
    const apps = rows.map(({ ownerId, formState, formAt, ...r }) => {
      const mine = docs.filter((d) => d.a === r.id);
      return {
        ...r,
        owner: ownerId ? { personId: ownerId, name: owners[ownerId] ?? '' } : null,
        papers: {
          required: required.length,
          verified: mine.filter((d) => d.status === 'verified').length,
          waiting: mine.filter((d) => d.status === 'received').length,
          rejected: mine.filter((d) => d.status === 'rejected').length,
        },
        form: formState && formAt ? { state: formState, at: formAt } : null,
      };
    });
    const counts = Object.fromEntries(
      (
        [
          'enquiry',
          'contacted',
          'applied',
          'documents_pending',
          'under_review',
          'offered',
          'waitlisted',
          'confirmed',
          'enrolled',
          'lost',
          'withdrawn',
          'rejected',
        ] as State[]
      ).map((s) => [s, apps.filter((x) => x.state === s).length]),
    ) as Record<State, number>;
    return {
      yearLabel: input.yearLabel,
      counts,
      year: { status: year.status, starts: year.starts, ends: year.ends },
      classes: classes.map((c) => ({
        classId: c.classId,
        name: c.name,
        seats: bySeat.get(c.classId)?.seats ?? null,
        held: bySeat.get(c.classId)?.held ?? 0,
        capacity: capacity.get(c.classId) ?? 0,
        students: students.get(c.classId) ?? 0,
        promised: promised.get(c.classId) ?? 0,
        running: capacity.has(c.classId),
      })),
      applications: apps,
    };
  });
}

export type ApplicationDetail = Row & {
  details: ApplicationDetails;
  reference: string | null;
  owner: { personId: string; name: string } | null;
  interest: 'hot' | 'warm' | 'cold' | null;
  campaign: string | null;
  createdAt: string;
  consentedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  waitlistPosition: number | null;
  className: string;
  previousSchool: string | null;
  notes: string | null;
  nextFollowUp: string | null;
  ageOverrideReason: string | null;
  ageOrderRef: string | null;
  studentId: string | null;
  closedReason: string | null;
  photoFileId: string | null;
  custom: Record<string, FieldValue>;
  age: AgeCheck;
  seatsLeft: number | null;
  fees: FeeDisclosure[];
  siblings: { studentName: string }[];
  sections: { sectionId: string; label: string }[];
  /** The school's year applied for: enrolment starts within it. Null if the school hasn't set it up. */
  yearStarts: string | null;
  yearEnds: string | null;
  history: {
    from: string | null;
    to: string;
    reason: string | null;
    by: string | null;
    at: string;
  }[];
};

export async function applicationDetail(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<ApplicationDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const a = await load(tx, applicationId);
    await deps.permissions.assertCan(tx, actor, 'school.admission.manage', {
      orgId: actor.orgId,
      place: await placeFor(tx, a.institutionId),
    });
    const [more] = await tx.execute<{
      className: string;
      previousSchool: string | null;
      notes: string | null;
      nextFollowUp: string | null;
      ageOverrideReason: string | null;
      ageOrderRef: string | null;
      studentId: string | null;
      closedReason: string | null;
      photoFileId: string | null;
      reference: string | null;
      ownerId: string | null;
      interest: 'hot' | 'warm' | 'cold' | null;
      campaign: string | null;
      createdAt: string;
      consentedAt: string | null;
      verifiedAt: string | null;
      verifiedById: string | null;
      waitlistPosition: number | null;
      details: ApplicationDetails;
    }>(sql`
      select c.name as "className", a.previous_school as "previousSchool", a.notes, a.next_follow_up::text as "nextFollowUp",
        a.age_override_reason as "ageOverrideReason", a.age_order_ref as "ageOrderRef",
        a.student_person_id::text as "studentId", a.closed_reason as "closedReason",
        a.photo_file_id::text as "photoFileId", a.public_ref as reference, a.owner_person_id::text as "ownerId",
        a.interest, a.campaign, a.created_at::text as "createdAt", a.consented_at::text as "consentedAt",
        a.verified_at::text as "verifiedAt", a.verified_by_person_id::text as "verifiedById",
        a.waitlist_position as "waitlistPosition",
        jsonb_build_object(${sql.raw(
          Object.entries(DETAIL_COLUMNS)
            .map(([k, c]) => `'${k}', a.${c}`)
            .join(', '),
        )}) as details
      from school_application a join school_class c on c.org_id = a.org_id and c.id = a.class_id
      where a.org_id = app_current_org() and a.id = ${applicationId}`);
    if (!more) throw new AdmissionError('application_not_found');
    const { ownerId, verifiedById, ...rest } = more;
    const people = await displayNames(
      tx,
      [ownerId, verifiedById].filter((x) => x !== null),
    );
    const history = await tx.execute<ApplicationDetail['history'][number]>(sql`
      select e.from_state as from, e.to_state as to, e.reason, p.legal_name as by, e.at::text as at
      from school_application_event e left join person p on p.org_id = e.org_id and p.id = e.actor_person_id
      where e.org_id = app_current_org() and e.application_id = ${applicationId} order by e.at, e.id`);
    // Sections of the class in the year applied for, open to new students.
    const ofYear = await yearByLabel(tx, a.institutionId, a.yearLabel);
    const sections = ofYear
      ? (await sectionsOfYear(tx, ofYear.yearId, ofYear.starts)).filter(
          (s) => s.classId === a.classId && !s.closed,
        )
      : [];
    return {
      ...a,
      ...rest,
      yearStarts: ofYear?.starts ?? null,
      yearEnds: ofYear?.ends ?? null,
      owner: ownerId ? { personId: ownerId, name: people[ownerId] ?? '' } : null,
      verifiedBy: verifiedById ? (people[verifiedById] ?? null) : null,
      custom: await valuesOf(tx, 'admission', applicationId),
      age: await ageOf(tx, a),
      seatsLeft: await seatsLeft(tx, a),
      fees: await disclosureFor(tx, a),
      // Other children of this guardian; once enrolled, never the applicant's own record.
      siblings: (await guardiansByPhone(tx, a.guardianPhone))
        .filter((s) => s.studentId !== rest.studentId)
        .map((s) => ({ studentName: s.studentName })),
      sections: sections.map((s) => ({ sectionId: s.sectionId, label: s.label })),
      history: [...history],
    };
  });
}

/** Seats for the admission year, by class and category. */
export async function setSeats(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    institutionId: string;
    yearLabel: string;
    classId: string;
    category: Category;
    seats: number;
  },
): Promise<void> {
  if (!Number.isInteger(input.seats) || input.seats < 0 || input.seats > 2000)
    throw new AdmissionError('bad_seats');
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.offer', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      await tx.execute(sql`
        insert into school_admission_seat (org_id, institution_id, year_label, class_id, category, seats)
        values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${input.classId}, ${input.category}, ${input.seats})
        on conflict (org_id, institution_id, year_label, class_id, category) do update set seats = excluded.seats`);
      return {
        result: undefined,
        audit: {
          action: 'school.admission.offer',
          entityType: 'school_class',
          entityId: input.classId,
          dataClass: 'operational',
          detail: { yearLabel: input.yearLabel, category: input.category, seats: input.seats },
        },
      };
    },
  );
}

async function detailsOf(tx: Tx, applicationId: string): Promise<ApplicationDetails> {
  const [r] = await tx.execute<{ d: ApplicationDetails }>(sql`
    select jsonb_build_object(${sql.raw(
      Object.entries(DETAIL_COLUMNS)
        .map(([k, c]) => `'${k}', ${c}`)
        .join(', '),
    )}) as d
    from school_application where org_id = app_current_org() and id = ${applicationId}`);
  if (!r) throw new AdmissionError('application_not_found');
  return r.d;
}

/** Copies an applicant's photo and documents to the new student's record. Returns how many papers. */
async function carryToStudent(
  tx: Tx,
  applicationId: string,
  studentId: string,
  enrolledBy: string,
): Promise<number> {
  const [app] = await tx.execute<{ photo: string | null }>(sql`
    select photo_file_id::text as photo from school_application where org_id = app_current_org() and id = ${applicationId}`);
  if (app?.photo) await setPhotoIn(tx, studentId, app.photo);
  const docs = await tx.execute<{
    folder: 'identity' | 'academic' | 'medical' | 'transfer' | 'other';
    kind: string;
    title: string;
    fileId: string;
    status: 'received' | 'verified' | 'rejected';
    note: string | null;
    uploadedBy: string;
    uploadedAt: string;
    checkedBy: string | null;
    checkedAt: string | null;
  }>(sql`
    select folder, kind, title, file_id::text as "fileId", status, note,
      coalesce(uploaded_by_person_id, checked_by_person_id, ${enrolledBy}::uuid)::text as "uploadedBy",
      uploaded_at::text as "uploadedAt", checked_by_person_id::text as "checkedBy", checked_at::text as "checkedAt"
    from (
      -- The current copy of each paper; earlier (replaced or rejected) copies stay with the application.
      select distinct on (kind) * from school_application_document
      where org_id = app_current_org() and application_id = ${applicationId}
      order by kind, uploaded_at desc
    ) d
    order by uploaded_at`);
  for (const d of docs) await fileDocument(tx, { personId: studentId, ...d });
  return docs.length;
}

/**
 * Whether a family (by phone or email) has an admission in progress at an institution, or a
 * child admitted there in the last 90 days. Finance refuses donations from them then: a seat is
 * never paid for outside the published fees (RTE Act 2009 s.13; state capitation fee acts).
 */
export async function admissionInProgress(
  tx: Tx,
  input: { institutionId: string; phone: string | null; email: string | null },
): Promise<boolean> {
  if (!input.phone && !input.email) return false;
  const email = input.email?.toLowerCase() ?? null;
  const [row] = await tx.execute(sql`
    select 1 from school_application a
    where a.org_id = app_current_org() and a.institution_id = ${input.institutionId}
      and (a.guardian_phone = ${input.phone} or a.second_guardian_phone = ${input.phone}
        or lower(a.guardian_email) = ${email} or lower(a.second_guardian_email) = ${email})
      and (a.state = any(${`{${['enquiry', 'contacted', 'applied', 'documents_pending', 'under_review', 'offered', 'waitlisted', 'confirmed'].join(',')}}`}::text[])
        or (a.state = 'enrolled' and exists (
          select 1 from school_application_event e
          where e.org_id = a.org_id and e.application_id = a.id and e.to_state = 'enrolled'
            and e.at > now() - interval '90 days')))
    limit 1`);
  return !!row;
}
