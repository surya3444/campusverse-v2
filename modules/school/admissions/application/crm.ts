// Admissions CRM (owner's brief, 20 Nov 2026; rule book §13.3 Enrollment): who owns a lead and how
// warm it is, the timeline of calls and messages, follow-ups, personal form links to a family,
// the papers checklist and verification, and bulk upload of leads. Everything here needs
// `school.admission.manage` at the application's institution.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames, guardiansByPhone } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { holdersAt, type Actor } from '@campusverse/platform-permissions';
import { classesIn, classesOf, readWorkbook, SetupError, yearsOf } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { mapHeaders, parseCsv, readLead, type LeadProblem, type LeadRow } from '../domain/leads.js';
import { canMove, type State } from '../domain/pipeline.js';
import {
  AdmissionError,
  admissionYear,
  applicationDetail,
  command_,
  load,
  placeFor,
  record,
  type AdmissionsDeps,
  type ApplicationDetail,
} from './admissions.js';

export type Interest = 'hot' | 'warm' | 'cold';
export type ActivityKind = 'call' | 'whatsapp' | 'sms' | 'email' | 'visit' | 'note';
export type Outcome =
  'reached' | 'no_answer' | 'busy' | 'call_back' | 'interested' | 'not_interested' | 'visited';
export type Paper = { kind: string; title: string; required: boolean };
export type FormSection =
  'second_guardian' | 'address' | 'background' | 'previous_school' | 'health';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+91[6-9]\d{9}$/;
export const hashToken = (token: string) => createHash('sha256').update(token).digest();
/** How long a personal link works. */
export const INVITE_DAYS = { apply: 14, papers: 7 } as const;

async function manage(deps: AdmissionsDeps, actor: Actor, tx: Tx, institutionId: string) {
  const place = await placeFor(tx, institutionId);
  await deps.permissions.assertCan(tx, actor, 'school.admission.manage', {
    orgId: actor.orgId,
    place,
  });
  return place;
}

/** Staff who can work admissions at this institution's campus: the owners a lead can have. */
export async function counsellors(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ personId: string; name: string }[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await manage(deps, actor, tx, institutionId);
    const ids = await holdersAt(tx, 'school.admission.manage', place.campusId);
    const names = await displayNames(tx, ids);
    return ids
      .map((personId) => ({ personId, name: names[personId] ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** Owner, interest and campaign tag of a lead. */
export async function updateLead(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    applicationId: string;
    ownerPersonId?: string | null | undefined;
    interest?: Interest | null | undefined;
    campaign?: string | null | undefined;
  },
): Promise<void> {
  await command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    if (input.ownerPersonId) {
      const place = await placeFor(tx, a.institutionId);
      if (
        !(await holdersAt(tx, 'school.admission.manage', place.campusId)).includes(
          input.ownerPersonId,
        )
      )
        throw new AdmissionError('owner_not_counsellor');
    }
    await tx.execute(sql`
      update school_application set
        owner_person_id = case when ${input.ownerPersonId !== undefined} then ${input.ownerPersonId ?? null}::uuid else owner_person_id end,
        interest = case when ${input.interest !== undefined} then ${input.interest ?? null} else interest end,
        campaign = case when ${input.campaign !== undefined} then ${input.campaign?.trim() || null} else campaign end,
        updated_at = now()
      where org_id = app_current_org() and id = ${a.id}`);
    return {
      result: undefined,
      detail: {
        owner: input.ownerPersonId !== undefined,
        interest: input.interest ?? null,
        campaign: input.campaign !== undefined,
      },
    };
  });
}

/** Keeps the application's next follow-up date in step with its earliest open follow-up. */
async function syncNextFollowUp(tx: Tx, applicationId: string) {
  await tx.execute(sql`
    update school_application set next_follow_up = (
      select min(due_on) from school_admission_follow_up
      where org_id = app_current_org() and application_id = ${applicationId} and done_at is null)
    where org_id = app_current_org() and id = ${applicationId}`);
}

const REACHED: readonly Outcome[] = ['reached', 'interested', 'visited', 'call_back'];

/**
 * A call, message, visit or note on the lead's timeline, optionally with the next follow-up.
 * Reaching the family moves a new enquiry to Contacted.
 */
export async function logActivity(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    applicationId: string;
    kind: ActivityKind;
    outcome?: Outcome | null | undefined;
    note?: string | null | undefined;
    followUp?: { dueOn: string; purpose: string } | null | undefined;
  },
): Promise<void> {
  const note = input.note?.trim() || null;
  if (!input.outcome && !note) throw new AdmissionError('activity_empty');
  if (input.followUp && !DATE.test(input.followUp.dueOn)) throw new AdmissionError('bad_date');
  await command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    await tx.execute(sql`
      insert into school_admission_activity (org_id, application_id, kind, outcome, note, by_person_id)
      values (app_current_org(), ${a.id}, ${input.kind}, ${input.outcome ?? null}, ${note}, ${actor.personId})`);
    if (input.followUp) {
      await tx.execute(sql`
        insert into school_admission_follow_up (org_id, application_id, due_on, purpose, assigned_to_person_id,
          created_by_person_id)
        values (app_current_org(), ${a.id}, ${input.followUp.dueOn}::date, ${input.followUp.purpose.trim()},
          ${actor.personId}, ${actor.personId})`);
      await syncNextFollowUp(tx, a.id);
    }
    if (a.state === 'enquiry' && input.outcome && REACHED.includes(input.outcome))
      await record(tx, a.id, 'enquiry', 'contacted', actor.personId);
    await tx.execute(sql`
      update school_application set updated_at = now() where org_id = app_current_org() and id = ${a.id}`);
    return {
      result: undefined,
      detail: { kind: input.kind, outcome: input.outcome ?? null, followUp: !!input.followUp },
    };
  });
}

/** Schedules a follow-up for a lead, for the person given or the one scheduling it. */
export async function scheduleFollowUp(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    applicationId: string;
    dueOn: string;
    purpose: string;
    assignedTo?: string | null | undefined;
  },
): Promise<void> {
  if (!DATE.test(input.dueOn)) throw new AdmissionError('bad_date');
  if (input.purpose.trim().length < 2) throw new AdmissionError('purpose_required');
  await command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    const to = input.assignedTo ?? actor.personId;
    if (to !== actor.personId) {
      const place = await placeFor(tx, a.institutionId);
      if (!(await holdersAt(tx, 'school.admission.manage', place.campusId)).includes(to))
        throw new AdmissionError('owner_not_counsellor');
    }
    await tx.execute(sql`
      insert into school_admission_follow_up (org_id, application_id, due_on, purpose, assigned_to_person_id,
        created_by_person_id)
      values (app_current_org(), ${a.id}, ${input.dueOn}::date, ${input.purpose.trim()}, ${to}, ${actor.personId})`);
    await syncNextFollowUp(tx, a.id);
    return { result: undefined, detail: { dueOn: input.dueOn } };
  });
}

/** Marks a follow-up done with what happened, optionally scheduling the next one. */
export async function completeFollowUp(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    followUpId: string;
    outcome: string;
    next?: { dueOn: string; purpose: string } | null | undefined;
  },
): Promise<void> {
  if (input.outcome.trim().length < 2) throw new AdmissionError('outcome_required');
  if (input.next && !DATE.test(input.next.dueOn)) throw new AdmissionError('bad_date');
  const applicationId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [f] = await tx.execute<{ a: string }>(sql`
      select application_id::text as a from school_admission_follow_up
      where org_id = app_current_org() and id = ${input.followUpId}`);
    if (!f) throw new AdmissionError('follow_up_not_found');
    return f.a;
  });
  await command_(deps, actor, applicationId, 'school.admission.manage', async (tx, a) => {
    const [done] = await tx.execute(sql`
      update school_admission_follow_up set done_at = now(), done_by_person_id = ${actor.personId},
        outcome = ${input.outcome.trim()}
      where org_id = app_current_org() and id = ${input.followUpId} and done_at is null returning id`);
    if (!done) throw new AdmissionError('follow_up_done');
    if (input.next)
      await tx.execute(sql`
        insert into school_admission_follow_up (org_id, application_id, due_on, purpose, assigned_to_person_id,
          created_by_person_id)
        values (app_current_org(), ${a.id}, ${input.next.dueOn}::date, ${input.next.purpose.trim()},
          ${actor.personId}, ${actor.personId})`);
    await syncNextFollowUp(tx, a.id);
    return { result: undefined, detail: { followUpId: input.followUpId, next: !!input.next } };
  });
}

export type FollowUpItem = {
  id: string;
  applicationId: string;
  childName: string;
  className: string;
  state: State;
  interest: Interest | null;
  guardianName: string;
  guardianPhone: string;
  dueOn: string;
  purpose: string;
  assignedTo: { personId: string; name: string };
  doneAt: string | null;
  outcome: string | null;
};

/** Open follow-ups, and those done in the last 14 days, for an institution. */
export async function followUps(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<FollowUpItem[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await manage(deps, actor, tx, institutionId);
    const classes = new Map((await classesOf(tx, institutionId)).map((c) => [c.classId, c.name]));
    const rows = await tx.execute<
      Omit<FollowUpItem, 'assignedTo' | 'className'> & { assignedId: string; classId: string }
    >(sql`
      select f.id::text, f.application_id::text as "applicationId", a.child_name as "childName",
        a.class_id::text as "classId", a.state, a.interest, a.guardian_name as "guardianName",
        a.guardian_phone as "guardianPhone", f.due_on::text as "dueOn", f.purpose,
        f.assigned_to_person_id::text as "assignedId", f.done_at::text as "doneAt", f.outcome
      from school_admission_follow_up f
      join school_application a on a.org_id = f.org_id and a.id = f.application_id
      where f.org_id = app_current_org() and a.institution_id = ${institutionId}
        and (f.done_at is null or f.done_at > now() - interval '14 days')
      order by f.done_at is not null, f.due_on, f.created_at limit 1000`);
    const names = await displayNames(
      tx,
      rows.map((r) => r.assignedId),
    );
    return rows.map(({ assignedId, classId, ...r }) => ({
      ...r,
      className: classes.get(classId) ?? '',
      assignedTo: { personId: assignedId, name: names[assignedId] ?? '' },
    }));
  });
}

export type TimelineItem = {
  at: string;
  kind:
    | 'state'
    | ActivityKind
    | 'follow_up'
    | 'follow_up_done'
    | 'form_sent'
    | 'form_opened'
    | 'form_submitted'
    | 'paper_received'
    | 'paper_checked';
  /** A state, a follow-up's purpose, a paper's title or the channel a form went by. */
  title: string | null;
  detail: string | null;
  outcome: string | null;
  by: string | null;
};

/** Everything that happened to an application, newest first. Call inside the tenant. */
export async function timelineOf(tx: Tx, applicationId: string): Promise<TimelineItem[]> {
  const rows = await tx.execute<TimelineItem & { byId: string | null }>(sql`
    select e.at::text as at, 'state' as kind, e.to_state as title, e.reason as detail, null as outcome,
      e.actor_person_id::text as "byId"
    from school_application_event e where e.org_id = app_current_org() and e.application_id = ${applicationId}
    union all
    select at::text, kind, null, note, outcome, by_person_id::text from school_admission_activity
    where org_id = app_current_org() and application_id = ${applicationId}
    union all
    select created_at::text, 'follow_up', purpose, due_on::text, null, created_by_person_id::text
    from school_admission_follow_up where org_id = app_current_org() and application_id = ${applicationId}
    union all
    select done_at::text, 'follow_up_done', purpose, outcome, null, done_by_person_id::text
    from school_admission_follow_up
    where org_id = app_current_org() and application_id = ${applicationId} and done_at is not null
    union all
    select created_at::text, 'form_sent', channel, purpose, null, sent_by_person_id::text
    from school_admission_invite where org_id = app_current_org() and application_id = ${applicationId}
    union all
    select opened_at::text, 'form_opened', channel, purpose, null, null
    from school_admission_invite
    where org_id = app_current_org() and application_id = ${applicationId} and opened_at is not null
    union all
    select submitted_at::text, 'form_submitted', channel, purpose, null, null
    from school_admission_invite
    where org_id = app_current_org() and application_id = ${applicationId} and submitted_at is not null
    union all
    select uploaded_at::text, 'paper_received', title, null,
      case when uploaded_by_family then 'family' else 'office' end, uploaded_by_person_id::text
    from school_application_document where org_id = app_current_org() and application_id = ${applicationId}
    union all
    select checked_at::text, 'paper_checked', title, note, status, checked_by_person_id::text
    from school_application_document
    where org_id = app_current_org() and application_id = ${applicationId} and checked_at is not null
    order by 1 desc limit 300`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => (r.byId ? [r.byId] : [])),
  );
  return rows.map(({ byId, ...r }) => ({ ...r, by: byId ? (names[byId] ?? null) : null }));
}

export type FormLite = {
  id: string;
  slug: string;
  title: string;
  yearLabel: string;
  classIds: string[];
  papers: Paper[];
  sections: FormSection[];
};

/** The institution's form for an admission year. Call inside the tenant. */
export async function formFor(
  tx: Tx,
  institutionId: string,
  yearLabel: string,
): Promise<FormLite | null> {
  const [f] = await tx.execute<FormLite>(sql`
    select id::text, slug, title, year_label as "yearLabel", class_ids::text[] as "classIds", papers, sections
    from school_admission_form
    where org_id = app_current_org() and institution_id = ${institutionId} and year_label = ${yearLabel}`);
  return f ?? null;
}

/** The papers every form asks for until the school sets its own. */
export const DEFAULT_PAPERS: Paper[] = [
  { kind: 'birth_certificate', title: 'Birth certificate', required: true },
  { kind: 'photo', title: 'Passport-size photo', required: true },
  { kind: 'address_proof', title: 'Address proof', required: true },
  { kind: 'report_card', title: 'Last report card', required: false },
  { kind: 'transfer_certificate', title: 'Transfer certificate', required: false },
];

export type PaperLine = Paper & {
  status: 'missing' | 'received' | 'verified' | 'rejected';
  note: string | null;
  documentId: string | null;
  fromFamily: boolean;
  at: string | null;
};

/** Each paper the form asks for with its latest copy's state, then any other papers. */
export async function checklistOf(tx: Tx, applicationId: string, papers: Paper[]) {
  const docs = await tx.execute<{
    id: string;
    kind: string;
    title: string;
    status: 'received' | 'verified' | 'rejected';
    note: string | null;
    fromFamily: boolean;
    at: string;
  }>(sql`
    select id::text, kind, title, status, note, uploaded_by_family as "fromFamily", uploaded_at::text as at
    from school_application_document where org_id = app_current_org() and application_id = ${applicationId}
    order by uploaded_at desc`);
  const latest = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (!latest.has(d.kind)) latest.set(d.kind, d);
  const line = (p: Paper): PaperLine => {
    const d = latest.get(p.kind);
    return {
      ...p,
      status: d?.status ?? 'missing',
      note: d?.note ?? null,
      documentId: d?.id ?? null,
      fromFamily: d?.fromFamily ?? false,
      at: d?.at ?? null,
    };
  };
  const asked = papers.map(line);
  const extra = [...latest.values()]
    .filter((d) => !papers.some((p) => p.kind === d.kind))
    .map((d) => line({ kind: d.kind, title: d.title, required: false }));
  return [...asked, ...extra];
}

/** Required papers not yet verified: missing, waiting for a check, or rejected. */
export const outstanding = (lines: PaperLine[]) =>
  lines.filter((l) => l.required && l.status !== 'verified');

/**
 * The application is verified: every required paper checked and accepted. It moves on to review
 * (from Applied or Papers needed); who verified it and when stay on the record.
 */
export async function verifyApplication(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<void> {
  await command_(deps, actor, applicationId, 'school.admission.manage', async (tx, a) => {
    const form = await formFor(tx, a.institutionId, a.yearLabel);
    const missing = outstanding(await checklistOf(tx, a.id, form?.papers ?? DEFAULT_PAPERS));
    if (missing.length > 0)
      throw new AdmissionError('papers_not_verified', { papers: missing.map((m) => m.title) });
    await tx.execute(sql`
      update school_application set verified_at = now(), verified_by_person_id = ${actor.personId}, updated_at = now()
      where org_id = app_current_org() and id = ${a.id}`);
    if (a.state === 'applied' || a.state === 'documents_pending')
      await record(tx, a.id, a.state, 'under_review', actor.personId, 'Papers verified');
    return { result: undefined, detail: { verified: true } };
  });
}

export type SentInvite = {
  inviteId: string;
  link: string;
  /** The message to send, with the link. */
  text: string;
  channel: 'sms' | 'whatsapp' | 'email' | 'link';
  address: string | null;
};

type InviteInput = {
  institutionId: string;
  yearLabel: string;
  /** For a lead or application: its answers start filled in, and the form updates it. */
  applicationId?: string | null | undefined;
  purpose: 'apply' | 'papers';
  channel: 'sms' | 'whatsapp' | 'email' | 'link';
  /** Phone (+91…) or email; for a lead, its guardian's when left out. */
  address?: string | null | undefined;
  childName?: string | null | undefined;
  guardianName?: string | null | undefined;
  /** Where the web app is, for the link. */
  origin: string;
};

async function createInvite(
  tx: Tx,
  actor: Actor,
  input: InviteInput,
  papersNeeded: string[] = [],
): Promise<SentInvite> {
  const form = await formFor(tx, input.institutionId, input.yearLabel);
  if (!form) throw new AdmissionError('no_form');
  const app = input.applicationId
    ? await tx
        .execute<{
          childName: string;
          guardianName: string;
          guardianPhone: string;
          guardianEmail: string | null;
        }>(
          sql`
        select child_name as "childName", guardian_name as "guardianName", guardian_phone as "guardianPhone",
          guardian_email as "guardianEmail"
        from school_application where org_id = app_current_org() and id = ${input.applicationId}`,
        )
        .then((r) => r[0])
    : undefined;
  if (input.applicationId && !app) throw new AdmissionError('application_not_found');
  const address =
    input.channel === 'link'
      ? null
      : input.address?.trim().toLowerCase() ||
        (input.channel === 'email' ? app?.guardianEmail : app?.guardianPhone) ||
        null;
  if (input.channel === 'email' && (!address || !EMAIL.test(address)))
    throw new AdmissionError('bad_email');
  if (
    (input.channel === 'sms' || input.channel === 'whatsapp') &&
    (!address || !PHONE.test(address))
  )
    throw new AdmissionError('bad_phone');
  const childName = app?.childName ?? input.childName?.trim() ?? null;
  const guardianName = app?.guardianName ?? input.guardianName?.trim() ?? null;
  const token = randomBytes(24).toString('base64url');
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into school_admission_invite (org_id, institution_id, form_id, application_id, purpose, channel, address,
      child_name, guardian_name, token_hash, expires_at, sent_by_person_id)
    values (app_current_org(), ${input.institutionId}, ${form.id}, ${input.applicationId ?? null}, ${input.purpose},
      ${input.channel}, ${address}, ${childName || null}, ${guardianName || null}, ${hashToken(token)},
      now() + make_interval(days => ${INVITE_DAYS[input.purpose]}), ${actor.personId})
    returning id::text`);
  if (!row) throw new Error('createInvite: no row');
  const link = `${input.origin.replace(/\/$/, '')}/apply/${form.slug}?invite=${token}`;
  const hello = guardianName ? `Dear ${guardianName},` : 'Hello,';
  const text =
    input.purpose === 'papers'
      ? `${hello} ${form.title} needs ${papersNeeded.length ? papersNeeded.join(', ') : 'some papers'} for ${childName ?? 'your child'}'s application. Upload them here (works for ${INVITE_DAYS.papers} days): ${link}`
      : `${hello} ${form.title} invites you to apply${childName ? ` for ${childName}` : ''} for ${form.yearLabel}. Fill in the form here (your personal link, works for ${INVITE_DAYS.apply} days): ${link}`;
  return { inviteId: row.id, link, text, channel: input.channel, address };
}

/** A personal form link for a family, to send by SMS, WhatsApp, email or by hand. */
export async function sendInvite(
  deps: AdmissionsDeps,
  actor: Actor,
  input: InviteInput & { purpose: 'apply' },
): Promise<SentInvite> {
  if (!input.applicationId && !input.address && input.channel !== 'link')
    throw new AdmissionError('address_required');
  const place = await withTenant(deps.db, actor.orgId, async (tx) => {
    if (input.applicationId) {
      const a = await load(tx, input.applicationId);
      if (a.institutionId !== input.institutionId)
        throw new AdmissionError('application_not_found');
      if (!['enquiry', 'contacted', 'applied', 'documents_pending'].includes(a.state))
        throw new AdmissionError('form_not_needed', { state: a.state });
    }
    return placeFor(tx, input.institutionId);
  });
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const sent = await createInvite(tx, actor, input);
      return {
        result: sent,
        audit: {
          action: 'school.admission.invite_send',
          entityType: 'school_admission_invite',
          entityId: sent.inviteId,
          dataClass: 'personal',
          detail: { channel: input.channel, lead: !!input.applicationId },
        },
      };
    },
  );
}

/**
 * Asks the family for the papers still needed (missing or rejected): the application waits as
 * Papers needed and the family gets a personal link listing them.
 */
export async function requestPapers(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    applicationId: string;
    channel: 'sms' | 'whatsapp' | 'email' | 'link';
    origin: string;
  },
): Promise<SentInvite> {
  return command_(deps, actor, input.applicationId, 'school.admission.manage', async (tx, a) => {
    const form = await formFor(tx, a.institutionId, a.yearLabel);
    const missing = outstanding(await checklistOf(tx, a.id, form?.papers ?? DEFAULT_PAPERS));
    if (missing.length === 0) throw new AdmissionError('no_papers_needed');
    if (a.state !== 'documents_pending') {
      const err = canMove(a.state, 'documents_pending', null);
      if (err) throw new AdmissionError(err, { from: a.state, to: 'documents_pending' });
      await record(
        tx,
        a.id,
        a.state,
        'documents_pending',
        actor.personId,
        `Asked for: ${missing.map((m) => m.title).join(', ')}`,
      );
    }
    const sent = await createInvite(
      tx,
      actor,
      {
        institutionId: a.institutionId,
        yearLabel: a.yearLabel,
        applicationId: a.id,
        purpose: 'papers',
        channel: input.channel,
        origin: input.origin,
      },
      missing.map((m) => m.title),
    );
    return { result: sent, detail: { channel: input.channel, papers: missing.length } };
  });
}

/** Stops a personal link working. */
export async function cancelInvite(
  deps: AdmissionsDeps,
  actor: Actor,
  inviteId: string,
): Promise<void> {
  const institutionId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ i: string }>(sql`
      select institution_id::text as i from school_admission_invite where org_id = app_current_org() and id = ${inviteId}`);
    if (!r) throw new AdmissionError('invite_not_found');
    return r.i;
  });
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, institutionId));
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [done] = await tx.execute(sql`
        update school_admission_invite set cancelled_at = now()
        where org_id = app_current_org() and id = ${inviteId} and cancelled_at is null and submitted_at is null
        returning id`);
      if (!done) throw new AdmissionError('invite_closed');
      return {
        result: undefined,
        audit: {
          action: 'school.admission.invite_cancel',
          entityType: 'school_admission_invite',
          entityId: inviteId,
          dataClass: 'operational',
          detail: {},
        },
      };
    },
  );
}

export type InviteRow = {
  id: string;
  applicationId: string | null;
  purpose: 'apply' | 'papers';
  channel: 'sms' | 'whatsapp' | 'email' | 'link';
  address: string | null;
  childName: string | null;
  guardianName: string | null;
  sentBy: string;
  sentAt: string;
  openedAt: string | null;
  submittedAt: string | null;
  expiresAt: string;
  cancelledAt: string | null;
};

/** Form links sent for an institution (or one application), newest first. Call inside the tenant. */
export async function invitesIn(
  tx: Tx,
  filter: { institutionId: string } | { applicationId: string },
): Promise<InviteRow[]> {
  const rows = await tx.execute<InviteRow & { byId: string }>(sql`
    select id::text, application_id::text as "applicationId", purpose, channel, address, child_name as "childName",
      guardian_name as "guardianName", sent_by_person_id::text as "byId", created_at::text as "sentAt",
      opened_at::text as "openedAt", submitted_at::text as "submittedAt", expires_at::text as "expiresAt",
      cancelled_at::text as "cancelledAt"
    from school_admission_invite
    where org_id = app_current_org() and ${
      'applicationId' in filter
        ? sql`application_id = ${filter.applicationId}`
        : sql`institution_id = ${filter.institutionId}`
    }
    order by created_at desc limit 300`);
  const names = await displayNames(
    tx,
    rows.map((r) => r.byId),
  );
  return rows.map(({ byId, ...r }) => ({ ...r, sentBy: names[byId] ?? '' }));
}

/** Form links sent from an institution, for the Leads page. */
export async function invites(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<InviteRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await manage(deps, actor, tx, institutionId);
    return invitesIn(tx, { institutionId });
  });
}

// Bulk upload ------------------------------------------------------------------------------------

const MAX_ROWS = 2000;

export type ImportPreview = {
  total: number;
  /** Rows that will become leads. */
  ready: number;
  rows: {
    row: number;
    childName: string;
    guardianName: string;
    phone: string;
    className: string;
    status: 'ready' | 'duplicate' | 'problem';
    problems: LeadProblem[];
  }[];
  /** Columns the file was missing (child name, guardian name, mobile, class are needed). */
  missingColumns: string[];
};

async function readSheet(fileName: string, bytes: Uint8Array): Promise<unknown[][]> {
  if (/\.csv$/i.test(fileName)) {
    if (bytes.length > 5 * 1024 * 1024) throw new AdmissionError('file_too_large');
    return parseCsv(new TextDecoder().decode(bytes));
  }
  try {
    return await readWorkbook(bytes);
  } catch (e) {
    if (e instanceof SetupError)
      throw new AdmissionError(e.code === 'file_too_large' ? 'file_too_large' : 'not_a_sheet');
    throw e;
  }
}

/** Reads the sheet and checks every row: duplicate (same mobile and child this year) or problems. */
async function readLeads(
  tx: Tx,
  input: { institutionId: string; yearLabel: string; fileName: string; bytes: Uint8Array },
) {
  const sheet = await readSheet(input.fileName, input.bytes);
  const [header, ...body] = sheet;
  if (!header) throw new AdmissionError('empty_sheet');
  if (body.length > MAX_ROWS) throw new AdmissionError('too_many_rows', { max: MAX_ROWS });
  const cols = mapHeaders(header);
  const missingColumns = (['childName', 'guardianName', 'phone', 'className'] as const).filter(
    (c) => cols[c] === undefined,
  );
  // Rows match the classes the year runs.
  const year = await admissionYear(tx, input.institutionId, input.yearLabel, true);
  const classes = await classesIn(tx, year.yearId);
  const className = new Map(classes.map((c) => [c.classId, c.name]));
  const existing = new Set(
    (
      await tx.execute<{ k: string }>(sql`
        select guardian_phone || '|' || lower(child_name) as k from school_application
        where org_id = app_current_org() and year_label = ${input.yearLabel}
          and state not in ('lost', 'withdrawn', 'rejected')`)
    ).map((r) => r.k),
  );
  const seen = new Set<string>();
  const rows = body.map((cells, i) => {
    const r = readLead(cells, cols, classes);
    const text = (c: 'childName' | 'guardianName' | 'phone' | 'className') => {
      const n = cols[c];
      return n === undefined ? '' : String(cells[n] ?? '').trim();
    };
    if (!r.lead)
      return {
        row: i + 2,
        lead: null,
        childName: text('childName'),
        guardianName: text('guardianName'),
        phone: text('phone'),
        className: text('className'),
        status: 'problem' as const,
        problems: r.problems,
      };
    const key = `${r.lead.phone}|${r.lead.childName.toLowerCase()}`;
    const dup = existing.has(key) || seen.has(key);
    seen.add(key);
    return {
      row: i + 2,
      lead: dup ? null : r.lead,
      childName: r.lead.childName,
      guardianName: r.lead.guardianName,
      phone: r.lead.phone,
      className: className.get(r.lead.classId) ?? '',
      status: dup ? ('duplicate' as const) : ('ready' as const),
      problems: [] as LeadProblem[],
    };
  });
  return { rows, missingColumns };
}

/** What a file would add, row by row. Nothing is written. */
export async function previewLeadImport(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { institutionId: string; yearLabel: string; fileName: string; bytes: Uint8Array },
): Promise<ImportPreview> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await manage(deps, actor, tx, input.institutionId);
    const { rows, missingColumns } = await readLeads(tx, input);
    return {
      total: rows.length,
      ready: rows.filter((r) => r.status === 'ready').length,
      rows: rows.map((r) => ({
        row: r.row,
        childName: r.childName,
        guardianName: r.guardianName,
        phone: r.phone,
        className: r.className,
        status: r.status,
        problems: r.problems,
      })),
      missingColumns,
    };
  });
}

/**
 * Adds the file's ready rows as leads (Enquiry), tagged with the source, campaign and owner, as
 * one batch. Duplicates and rows with problems are skipped and counted.
 */
export async function importLeads(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    institutionId: string;
    yearLabel: string;
    fileName: string;
    bytes: Uint8Array;
    source: 'walk_in' | 'phone' | 'website' | 'referral' | 'other';
    campaign?: string | null | undefined;
    ownerPersonId?: string | null | undefined;
  },
): Promise<{ batchId: string; imported: number; skipped: number }> {
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      if (
        input.ownerPersonId &&
        !(await holdersAt(tx, 'school.admission.manage', place.campusId)).includes(
          input.ownerPersonId,
        )
      )
        throw new AdmissionError('owner_not_counsellor');
      const { rows } = await readLeads(tx, input);
      const leads = rows.flatMap((r) => (r.lead ? [r.lead] : []));
      if (leads.length === 0) throw new AdmissionError('nothing_to_import');
      const [batch] = await tx.execute<{ id: string }>(sql`
        insert into school_admission_import (org_id, institution_id, year_label, file_name, source, campaign,
          owner_person_id, total_rows, imported_rows, skipped_rows, created_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${input.fileName.slice(0, 200)},
          ${input.source}, ${input.campaign?.trim() || null}, ${input.ownerPersonId ?? null}, ${rows.length},
          ${leads.length}, ${rows.length - leads.length}, ${actor.personId})
        returning id::text`);
      if (!batch) throw new Error('importLeads: no batch');
      for (const l of leads) await insertLead(tx, actor, input, batch.id, l);
      return {
        result: { batchId: batch.id, imported: leads.length, skipped: rows.length - leads.length },
        audit: {
          action: 'school.admission.import',
          entityType: 'school_admission_import',
          entityId: batch.id,
          dataClass: 'personal',
          detail: {
            imported: leads.length,
            skipped: rows.length - leads.length,
            source: input.source,
          },
        },
      };
    },
  );
}

async function insertLead(
  tx: Tx,
  actor: Actor,
  input: {
    institutionId: string;
    yearLabel: string;
    source: string;
    campaign?: string | null | undefined;
    ownerPersonId?: string | null | undefined;
  },
  batchId: string,
  l: LeadRow,
) {
  const siblings = await guardiansByPhone(tx, l.phone);
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into school_application (org_id, institution_id, year_label, class_id, category, source, child_name,
      date_of_birth, gender, guardian_name, guardian_phone, guardian_relationship, guardian_email, previous_school,
      notes, sibling_of_person_id, owner_person_id, campaign, import_batch_id, created_by_person_id)
    values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${l.classId}, 'general', ${input.source},
      ${l.childName}, ${l.dateOfBirth}::date, ${l.gender}, ${l.guardianName}, ${l.phone}, ${l.relationship},
      ${l.email}, ${l.previousSchool}, ${l.notes}, ${siblings[0]?.studentId ?? null},
      ${input.ownerPersonId ?? null}, ${input.campaign?.trim() || null}, ${batchId}, ${actor.personId})
    returning id::text`);
  if (!row) throw new Error('insertLead: no row');
  await record(tx, row.id, null, 'enquiry', actor.personId, 'Bulk upload');
}

export type ImportRow = {
  id: string;
  fileName: string;
  yearLabel: string;
  source: string;
  campaign: string | null;
  owner: string | null;
  total: number;
  imported: number;
  skipped: number;
  by: string;
  at: string;
  undoneAt: string | null;
  /** Leads from it still untouched (an undo would close these). */
  untouched: number;
};

const UNTOUCHED = sql`a.state = 'enquiry' and not exists (
  select 1 from school_admission_activity x where x.org_id = a.org_id and x.application_id = a.id)
  and not exists (select 1 from school_admission_invite x where x.org_id = a.org_id and x.application_id = a.id)`;

/** Earlier bulk uploads, newest first. */
export async function leadImports(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<ImportRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await manage(deps, actor, tx, institutionId);
    const rows = await tx.execute<
      Omit<ImportRow, 'owner' | 'by'> & { ownerId: string | null; byId: string }
    >(sql`
      select b.id::text, b.file_name as "fileName", b.year_label as "yearLabel", b.source, b.campaign,
        b.owner_person_id::text as "ownerId", b.total_rows as total, b.imported_rows as imported,
        b.skipped_rows as skipped, b.created_by_person_id::text as "byId", b.created_at::text as at,
        b.undone_at::text as "undoneAt",
        (select count(*)::int from school_application a
          where a.org_id = b.org_id and a.import_batch_id = b.id and ${UNTOUCHED}) as untouched
      from school_admission_import b
      where b.org_id = app_current_org() and b.institution_id = ${institutionId}
      order by b.created_at desc limit 50`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => [r.byId, ...(r.ownerId ? [r.ownerId] : [])]),
    );
    return rows.map(({ ownerId, byId, ...r }) => ({
      ...r,
      owner: ownerId ? (names[ownerId] ?? null) : null,
      by: names[byId] ?? '',
    }));
  });
}

/**
 * Undoes a bulk upload: leads from it nobody has worked on yet are closed as lost ("Bulk upload
 * undone"), keeping their history; leads already worked on stay.
 */
export async function undoLeadImport(
  deps: AdmissionsDeps,
  actor: Actor,
  batchId: string,
): Promise<{ closed: number; kept: number }> {
  const institutionId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [b] = await tx.execute<{ i: string }>(sql`
      select institution_id::text as i from school_admission_import
      where org_id = app_current_org() and id = ${batchId} and undone_at is null`);
    if (!b) throw new AdmissionError('import_not_found');
    return b.i;
  });
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const leads = await tx.execute<{ id: string; untouched: boolean }>(sql`
        select a.id::text, (${UNTOUCHED}) as untouched from school_application a
        where a.org_id = app_current_org() and a.import_batch_id = ${batchId} for update`);
      const close = leads.filter((l) => l.untouched);
      for (const l of close)
        await record(tx, l.id, 'enquiry', 'lost', actor.personId, 'Bulk upload undone');
      await tx.execute(sql`
        update school_admission_import set undone_at = now() where org_id = app_current_org() and id = ${batchId}`);
      return {
        result: { closed: close.length, kept: leads.length - close.length },
        audit: {
          action: 'school.admission.import_undo',
          entityType: 'school_admission_import',
          entityId: batchId,
          dataClass: 'operational',
          detail: { closed: close.length, kept: leads.length - close.length },
        },
      };
    },
  );
}

// The application's record page and the student's admission card -----------------------------

export type ApplicationRecord = ApplicationDetail & {
  checklist: PaperLine[];
  timeline: TimelineItem[];
  invites: InviteRow[];
  followUps: {
    id: string;
    dueOn: string;
    purpose: string;
    assignedTo: string;
  }[];
  form: { slug: string; title: string; sections: FormSection[] } | null;
};

/** Everything the application page shows, in one read. */
export async function applicationRecord(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<ApplicationRecord> {
  const detail = await applicationDetail(deps, actor, applicationId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const form = await formFor(tx, detail.institutionId, detail.yearLabel);
    const open = await tx.execute<{ id: string; dueOn: string; purpose: string; to: string }>(sql`
      select id::text, due_on::text as "dueOn", purpose, assigned_to_person_id::text as to
      from school_admission_follow_up
      where org_id = app_current_org() and application_id = ${applicationId} and done_at is null
      order by due_on`);
    const names = await displayNames(
      tx,
      open.map((f) => f.to),
    );
    return {
      ...detail,
      checklist: await checklistOf(tx, applicationId, form?.papers ?? DEFAULT_PAPERS),
      timeline: await timelineOf(tx, applicationId),
      invites: await invitesIn(tx, { applicationId }),
      followUps: open.map((f) => ({
        id: f.id,
        dueOn: f.dueOn,
        purpose: f.purpose,
        assignedTo: names[f.to] ?? '',
      })),
      form: form ? { slug: form.slug, title: form.title, sections: form.sections } : null,
    };
  });
}

export type StudentAdmission = {
  applicationId: string;
  reference: string | null;
  yearLabel: string;
  className: string;
  source: string;
  campaign: string | null;
  enquiredOn: string;
  appliedOn: string | null;
  verifiedOn: string | null;
  verifiedBy: string | null;
  offeredOn: string | null;
  confirmedOn: string | null;
  enrolledOn: string | null;
  papers: number;
  viaForm: boolean;
};

/** How a student was admitted, for their record (anyone who may read the student). */
export async function studentAdmission(
  deps: AdmissionsDeps,
  actor: Actor,
  studentId: string,
): Promise<StudentAdmission | null> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [a] = await tx.execute<{
      id: string;
      institutionId: string;
      reference: string | null;
      yearLabel: string;
      classId: string;
      source: string;
      campaign: string | null;
      createdAt: string;
      verifiedAt: string | null;
      verifiedById: string | null;
      viaForm: boolean;
    }>(sql`
      select id::text, institution_id::text as "institutionId", public_ref as reference, year_label as "yearLabel",
        class_id::text as "classId", source, campaign, created_at::text as "createdAt",
        verified_at::text as "verifiedAt", verified_by_person_id::text as "verifiedById",
        consented_at is not null as "viaForm"
      from school_application where org_id = app_current_org() and student_person_id = ${studentId}
      order by created_at desc limit 1`);
    if (!a) return null;
    await deps.permissions.assertCan(tx, actor, 'people.student.read', {
      orgId: actor.orgId,
      place: await placeFor(tx, a.institutionId),
    });
    const when = await tx.execute<{ to: string; at: string }>(sql`
      select to_state as to, min(at)::text as at from school_application_event
      where org_id = app_current_org() and application_id = ${a.id} group by to_state`);
    const at = (s: string) => when.find((w) => w.to === s)?.at ?? null;
    const [papers] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_application_document
      where org_id = app_current_org() and application_id = ${a.id}`);
    const names = await displayNames(tx, a.verifiedById ? [a.verifiedById] : []);
    const className =
      (await classesOf(tx, a.institutionId)).find((c) => c.classId === a.classId)?.name ?? '';
    return {
      applicationId: a.id,
      reference: a.reference,
      yearLabel: a.yearLabel,
      className,
      source: a.source,
      campaign: a.campaign,
      enquiredOn: a.createdAt,
      appliedOn: at('applied'),
      verifiedOn: a.verifiedAt,
      verifiedBy: a.verifiedById ? (names[a.verifiedById] ?? null) : null,
      offeredOn: at('offered'),
      confirmedOn: at('confirmed'),
      enrolledOn: at('enrolled'),
      papers: papers?.n ?? 0,
      viaForm: a.viaForm,
    };
  });
}

export type AdmissionYear = {
  label: string;
  starts: string;
  /** Exclusive. */
  ends: string;
  status: 'planned' | 'active' | 'ended' | 'closed';
};

/**
 * The school's academic years that admissions work in: those not yet ended (running and coming),
 * plus any year asked for that still has families, newest last. Set up in Academic years.
 */
export async function admissionYears(
  deps: AdmissionsDeps,
  actor: Actor,
  institutionId: string,
): Promise<AdmissionYear[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await manage(deps, actor, tx, institutionId);
    const years = await yearsOf(tx, institutionId);
    const withFamilies = new Set(
      (
        await tx.execute<{ y: string }>(sql`
          select distinct year_label as y from school_application
          where org_id = app_current_org() and institution_id = ${institutionId}
            and state not in ('enrolled', 'lost', 'withdrawn', 'rejected')`)
      ).map((r) => r.y),
    );
    return years
      .filter((y) => y.status === 'planned' || y.status === 'active' || withFamilies.has(y.label))
      .map(({ label, starts, ends, status }) => ({ label, starts, ends, status }));
  });
}
