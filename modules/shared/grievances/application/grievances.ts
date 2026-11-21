// Quality & Compliance › Grievances & Committees (rule book §13.11, §15; docs/specs/GRIEVANCES.md).
// Leaders set up statutory committees and their members. Anyone raises a case to a committee,
// optionally anonymously; only that committee's members see it and work it (POSH
// confidentiality), and the raiser follows it and may appeal a decision. Leaders see counts only.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, memberKind } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  APPEAL_DAYS,
  DEFAULT_DAYS,
  canMove,
  overdue,
  type CaseState,
  type CommitteeKind,
} from '../domain/grievances.js';

type Permissions = ReturnType<typeof createPermissions>;
export type GrievanceDeps = { db: Db; permissions: Permissions };

export const CASE_RAISED = 'grievance.case.raised.v1';
export const CASE_DECIDED = 'grievance.case.decided.v1';

export class GrievanceError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'committee_not_found'
      | 'case_not_found'
      | 'not_a_member'
      | 'not_staff'
      | 'not_a_student'
      | 'bad_move'
      | 'appeal_closed'
      | 'outcome_needed',
  ) {
    super(`grievance: ${code}`);
    this.name = 'GrievanceError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function placeRes(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new GrievanceError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}
const resAt = (deps: GrievanceDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => placeRes(tx, actor, institutionId));

async function committeeAt(tx: Tx, institutionId: string, committeeId: string) {
  const [c] = await tx.execute<{
    id: string;
    name: string;
    kind: CommitteeKind;
    days: number;
    active: boolean;
  }>(sql`
    select id::text, name, kind, decide_days as days, active from grievance_committee
    where org_id = app_current_org() and id = ${committeeId} and institution_id = ${institutionId}`);
  if (!c) throw new GrievanceError('committee_not_found');
  return c;
}
const isMember = async (tx: Tx, committeeId: string, personId: string) =>
  (
    await tx.execute(sql`
      select 1 from grievance_member where org_id = app_current_org() and committee_id = ${committeeId}
        and person_id = ${personId} and active`)
  ).length > 0;

/** A case, after checking the actor is on its committee or raised it. */
async function caseFor(tx: Tx, institutionId: string, caseId: string, personId: string) {
  const [c] = await tx.execute<{
    id: string;
    committeeId: string;
    number: number;
    raisedBy: string;
    anonymous: boolean;
    state: CaseState;
    decidedOn: string | null;
  }>(sql`
    select c.id::text, c.committee_id::text as "committeeId", c.number, c.raised_by_person_id::text as "raisedBy",
      c.anonymous, c.state, c.decided_on::text as "decidedOn"
    from grievance_case c join grievance_committee g on g.org_id = c.org_id and g.id = c.committee_id
    where c.org_id = app_current_org() and c.id = ${caseId} and g.institution_id = ${institutionId}
    for update of c`);
  if (!c) throw new GrievanceError('case_not_found');
  const member = await isMember(tx, c.committeeId, personId);
  if (!member && c.raisedBy !== personId) throw new GrievanceError('case_not_found');
  return { ...c, member, raiser: c.raisedBy === personId };
}

// ---------------------------------------------------------------------------------------------
// Committees
// ---------------------------------------------------------------------------------------------

export type CommitteeRow = {
  id: string;
  kind: CommitteeKind;
  name: string;
  decideDays: number;
  active: boolean;
  /** The actor sits on it, so may open its cases. */
  member: boolean;
  members: { id: string; personId: string | null; name: string; role: string }[];
  open: number;
  overdue: number;
  total: number;
};

/**
 * Committees for this institution: everyone sees the active ones (to raise a case); members and
 * leaders see the counts; only members open cases.
 */
export async function committees(
  deps: GrievanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<CommitteeRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await placeRes(tx, actor, institutionId);
    const manager = (await deps.permissions.can(tx, actor, 'grievance.committee.manage', r))
      .allowed;
    if (!manager) await deps.permissions.assertCan(tx, actor, 'grievance.case.raise', r);
    const on = await today(tx);
    const rows = await tx.execute<{
      id: string;
      kind: CommitteeKind;
      name: string;
      decideDays: number;
      active: boolean;
      states: CaseState[] | null;
      received: string[] | null;
    }>(sql`
      select g.id::text, g.kind, g.name, g.decide_days as "decideDays", g.active,
        array_agg(c.state) filter (where c.id is not null) as states,
        array_agg(c.received_on::text) filter (where c.id is not null) as received
      from grievance_committee g
      left join grievance_case c on c.org_id = g.org_id and c.committee_id = g.id
      where g.org_id = app_current_org() and g.institution_id = ${institutionId} and (g.active or ${manager})
      group by g.org_id, g.id order by g.active desc, g.name`);
    const members = await tx.execute<{
      id: string;
      committeeId: string;
      personId: string | null;
      outside: string | null;
      role: string;
    }>(sql`
      select m.id::text, m.committee_id::text as "committeeId", m.person_id::text as "personId",
        m.outside_name as outside, m.role
      from grievance_member m join grievance_committee g on g.org_id = m.org_id and g.id = m.committee_id
      where m.org_id = app_current_org() and g.institution_id = ${institutionId} and m.active
      order by (m.role = 'chair') desc`);
    const names = await displayNames(
      tx,
      members.flatMap((m) => (m.personId ? [m.personId] : [])),
    );
    return rows.map((g) => {
      const mine = members.filter((m) => m.committeeId === g.id);
      const member = mine.some((m) => m.personId === actor.personId);
      const states = g.states ?? [];
      const seeCounts = member || manager;
      return {
        id: g.id,
        kind: g.kind,
        name: g.name,
        decideDays: g.decideDays,
        active: g.active,
        member,
        members: mine.map((m) => ({
          id: m.id,
          personId: m.personId,
          name: m.personId ? (names[m.personId] ?? '') : (m.outside ?? ''),
          role: m.role,
        })),
        open: seeCounts ? states.filter((s) => s !== 'closed' && s !== 'decided').length : 0,
        overdue: seeCounts
          ? states.filter((s, i) => overdue(s, g.received?.[i] ?? on, g.decideDays, on)).length
          : 0,
        total: seeCounts ? states.length : 0,
      };
    });
  });
}

export async function saveCommittee(
  deps: GrievanceDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id?: string | undefined;
    kind: CommitteeKind;
    name: string;
    decideDays?: number | undefined;
    active: boolean;
  },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.committee.manage', resource },
    async (tx) => {
      const days = input.decideDays ?? DEFAULT_DAYS[input.kind];
      if (input.id) await committeeAt(tx, input.institutionId, input.id);
      const [row] = input.id
        ? await tx.execute<{ id: string }>(sql`
            update grievance_committee set kind = ${input.kind}, name = btrim(${input.name}),
              decide_days = ${days}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`)
        : await tx.execute<{ id: string }>(sql`
            insert into grievance_committee (org_id, institution_id, kind, name, decide_days, active)
            values (app_current_org(), ${input.institutionId}, ${input.kind}, btrim(${input.name}), ${days}, ${input.active})
            returning id::text`);
      if (!row) throw new Error('saveCommittee: no row');
      return {
        result: row,
        audit: {
          action: input.id ? 'grievance.committee.update' : 'grievance.committee.create',
          entityType: 'grievance_committee',
          entityId: row.id,
          dataClass: 'operational',
          detail: { kind: input.kind, decideDays: days },
        },
      };
    },
  );
}

export type MemberInput =
  { personId: string; role: 'chair' | 'member' } | { outsideName: string; role: 'outside_member' };

/** Replaces the committee's members. Staff must belong to the institution. */
export async function setMembers(
  deps: GrievanceDeps,
  actor: Actor,
  input: { institutionId: string; committeeId: string; members: MemberInput[] },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.committee.manage', resource },
    async (tx) => {
      await committeeAt(tx, input.institutionId, input.committeeId);
      const on = await today(tx);
      for (const m of input.members)
        if (
          'personId' in m &&
          (await memberKind(tx, {
            institutionId: input.institutionId,
            personId: m.personId,
            onDate: on,
          })) !== 'staff'
        )
          throw new GrievanceError('not_staff');
      await tx.execute(sql`
        update grievance_member set active = false
        where org_id = app_current_org() and committee_id = ${input.committeeId}`);
      for (const m of input.members) {
        if ('personId' in m)
          await tx.execute(sql`
            insert into grievance_member (org_id, committee_id, person_id, role)
            values (app_current_org(), ${input.committeeId}, ${m.personId}, ${m.role})
            on conflict (org_id, committee_id, person_id) where person_id is not null
            do update set role = excluded.role, active = true`);
        else
          await tx.execute(sql`
            insert into grievance_member (org_id, committee_id, outside_name, role)
            values (app_current_org(), ${input.committeeId}, btrim(${m.outsideName}), 'outside_member')`);
      }
      return {
        result: undefined,
        audit: {
          action: 'grievance.committee.members',
          entityType: 'grievance_committee',
          entityId: input.committeeId,
          dataClass: 'personal',
          detail: { members: input.members.length },
        },
      };
    },
  );
}

export async function recordMeeting(
  deps: GrievanceDeps,
  actor: Actor,
  input: { institutionId: string; committeeId: string; heldOn: string; minutes: string },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.case.raise', resource },
    async (tx) => {
      await committeeAt(tx, input.institutionId, input.committeeId);
      if (!(await isMember(tx, input.committeeId, actor.personId)))
        throw new GrievanceError('not_a_member');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into grievance_meeting (org_id, committee_id, held_on, minutes, recorded_by_person_id)
        values (app_current_org(), ${input.committeeId}, ${input.heldOn}::date, btrim(${input.minutes}), ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('recordMeeting: no row');
      return {
        result: row,
        audit: {
          action: 'grievance.meeting.record',
          entityType: 'grievance_committee',
          entityId: input.committeeId,
          dataClass: 'personal',
          detail: { meetingId: row.id },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

/**
 * Raises a case to a committee. A parent raises it about their own child (`aboutStudentId`,
 * checked by the guardian relation); staff for themselves, optionally about a student.
 */
export async function raiseCase(
  deps: GrievanceDeps,
  actor: Actor,
  input: {
    institutionId: string;
    committeeId: string;
    subject: string;
    details: string;
    anonymous: boolean;
    aboutStudentId?: string | undefined;
  },
): Promise<{ id: string; number: number }> {
  const place = await resAt(deps, actor, input.institutionId);
  const resource: Resource = input.aboutStudentId
    ? { ...place, subjectPersonId: input.aboutStudentId }
    : place;
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.case.raise', resource },
    async (tx) => {
      const g = await committeeAt(tx, input.institutionId, input.committeeId);
      if (!g.active) throw new GrievanceError('committee_not_found');
      const on = await today(tx);
      if (
        input.aboutStudentId &&
        (await memberKind(tx, {
          institutionId: input.institutionId,
          personId: input.aboutStudentId,
          onDate: on,
        })) !== 'student'
      )
        throw new GrievanceError('not_a_student');
      // Numbered per committee; the committee row is locked while counting.
      await tx.execute(sql`
        select 1 from grievance_committee where org_id = app_current_org() and id = ${g.id} for update`);
      const [row] = await tx.execute<{ id: string; number: number }>(sql`
        insert into grievance_case (org_id, committee_id, number, raised_by_person_id, anonymous,
          about_student_id, subject, details, received_on, due_on)
        values (app_current_org(), ${g.id},
          (select coalesce(max(number), 0) + 1 from grievance_case where org_id = app_current_org() and committee_id = ${g.id}),
          ${actor.personId}, ${input.anonymous}, ${input.aboutStudentId ?? null}, btrim(${input.subject}),
          btrim(${input.details}), app_today(), app_today() + ${g.days}::int)
        returning id::text, number`);
      if (!row) throw new Error('raiseCase: no row');
      return {
        result: row,
        // Ids only: neither the subject nor the details go into the audit log.
        audit: {
          action: 'grievance.case.raise',
          entityType: 'grievance_case',
          entityId: row.id,
          dataClass: 'sensitive',
          detail: { committeeId: g.id, anonymous: input.anonymous },
        },
        events: [
          {
            type: CASE_RAISED,
            payload: { caseId: row.id, committeeId: g.id, institutionId: input.institutionId },
          },
        ],
      };
    },
  );
}

export type CaseRow = {
  id: string;
  committeeId: string;
  committee: string;
  number: number;
  subject: string;
  /** "Anonymous" for the committee when the raiser asked; never for the raiser. */
  raisedBy: string;
  state: CaseState;
  receivedOn: string;
  dueOn: string;
  overdue: boolean;
};

async function caseRows(tx: Tx, where: ReturnType<typeof sql>, hideAnonymous: boolean) {
  const on = await today(tx);
  const rows = await tx.execute<
    Omit<CaseRow, 'raisedBy' | 'overdue'> & { byId: string; anonymous: boolean; days: number }
  >(sql`
    select c.id::text, c.committee_id::text as "committeeId", g.name as committee, c.number, c.subject,
      c.raised_by_person_id::text as "byId", c.anonymous, c.state, c.received_on::text as "receivedOn",
      c.due_on::text as "dueOn", g.decide_days as days
    from grievance_case c join grievance_committee g on g.org_id = c.org_id and g.id = c.committee_id
    where c.org_id = app_current_org() and ${where}
    order by (c.state in ('received', 'inquiry', 'appealed')) desc, c.due_on, c.number desc limit 200`);
  const names = await displayNames(
    tx,
    rows.map((r) => r.byId),
  );
  return rows.map(({ byId, anonymous, days, ...r }) => ({
    ...r,
    raisedBy: anonymous && hideAnonymous ? 'Anonymous' : (names[byId] ?? ''),
    overdue: overdue(r.state, r.receivedOn, days, on),
  }));
}

/** Cases of a committee the actor sits on. */
export async function committeeCases(
  deps: GrievanceDeps,
  actor: Actor,
  input: { institutionId: string; committeeId: string },
): Promise<CaseRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'grievance.case.raise',
      await placeRes(tx, actor, input.institutionId),
    );
    await committeeAt(tx, input.institutionId, input.committeeId);
    if (!(await isMember(tx, input.committeeId, actor.personId)))
      throw new GrievanceError('not_a_member');
    return caseRows(tx, sql`c.committee_id = ${input.committeeId}`, true);
  });
}

/** Cases the actor raised, at this institution. */
export async function myCases(
  deps: GrievanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<CaseRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await placeRes(tx, actor, institutionId);
    return caseRows(
      tx,
      sql`c.raised_by_person_id = ${actor.personId} and g.institution_id = ${institutionId}`,
      false,
    );
  });
}

export type CaseDetail = CaseRow & {
  details: string;
  aboutStudent: string | null;
  outcome: string | null;
  decidedOn: string | null;
  appeal: string | null;
  canAppeal: boolean;
  member: boolean;
  notes: { id: string; by: string; body: string; at: string }[];
  meetings: { id: string; heldOn: string; minutes: string }[];
};

/** One case for its committee (with notes and meetings) or its raiser (without them). */
export async function caseDetail(
  deps: GrievanceDeps,
  actor: Actor,
  input: { institutionId: string; caseId: string },
): Promise<CaseDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const c = await caseFor(tx, input.institutionId, input.caseId, actor.personId);
    const [row] = await caseRows(tx, sql`c.id = ${input.caseId}`, !c.raiser);
    const [more] = await tx.execute<{
      details: string;
      about: string | null;
      outcome: string | null;
      decidedOn: string | null;
      appeal: string | null;
      appealOpen: boolean;
    }>(sql`
      select details, about_student_id::text as about, outcome, decided_on::text as "decidedOn", appeal,
        (state = 'decided' and decided_on + ${APPEAL_DAYS}::int >= app_today()) as "appealOpen"
      from grievance_case where org_id = app_current_org() and id = ${input.caseId}`);
    const notes = c.member
      ? await tx.execute<{ id: string; byId: string; body: string; at: string }>(sql`
          select id::text, author_person_id::text as "byId", body, created_at::text as at from grievance_note
          where org_id = app_current_org() and case_id = ${input.caseId} order by created_at`)
      : [];
    const meetings = c.member
      ? await tx.execute<{ id: string; heldOn: string; minutes: string }>(sql`
          select id::text, held_on::text as "heldOn", minutes from grievance_meeting
          where org_id = app_current_org() and committee_id = ${c.committeeId} order by held_on desc limit 20`)
      : [];
    const names = await displayNames(tx, [
      ...notes.map((n) => n.byId),
      ...(more?.about ? [more.about] : []),
    ]);
    if (!row || !more) throw new GrievanceError('case_not_found');
    return {
      ...row,
      details: more.details,
      aboutStudent: more.about ? (names[more.about] ?? '') : null,
      outcome: more.outcome,
      decidedOn: more.decidedOn,
      appeal: more.appeal,
      canAppeal: c.raiser && more.appealOpen,
      member: c.member,
      notes: notes.map(({ byId, ...n }) => ({ ...n, by: names[byId] ?? '' })),
      meetings,
    };
  });
}

export async function addNote(
  deps: GrievanceDeps,
  actor: Actor,
  input: { institutionId: string; caseId: string; body: string },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.case.raise', resource },
    async (tx) => {
      const c = await caseFor(tx, input.institutionId, input.caseId, actor.personId);
      if (!c.member) throw new GrievanceError('not_a_member');
      await tx.execute(sql`
        insert into grievance_note (org_id, case_id, author_person_id, body)
        values (app_current_org(), ${input.caseId}, ${actor.personId}, btrim(${input.body}))`);
      return {
        result: undefined,
        audit: {
          action: 'grievance.case.note',
          entityType: 'grievance_case',
          entityId: input.caseId,
          dataClass: 'sensitive',
        },
      };
    },
  );
}

/**
 * Moves a case: the committee opens an inquiry, decides with an outcome, or closes; the raiser
 * appeals a decision within 30 days.
 */
export async function moveCase(
  deps: GrievanceDeps,
  actor: Actor,
  input: {
    institutionId: string;
    caseId: string;
    to: Exclude<CaseState, 'received'>;
    text?: string | undefined;
  },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'grievance.case.raise', resource },
    async (tx) => {
      const c = await caseFor(tx, input.institutionId, input.caseId, actor.personId);
      const by = input.to === 'appealed' ? 'raiser' : 'committee';
      if ((by === 'committee' && !c.member) || (by === 'raiser' && !c.raiser))
        throw new GrievanceError('not_a_member');
      if (!canMove(c.state, input.to, by)) throw new GrievanceError('bad_move');
      const text = input.text?.trim() ?? '';
      if (input.to === 'decided') {
        if (text.length < 3) throw new GrievanceError('outcome_needed');
        await tx.execute(sql`
          update grievance_case set state = 'decided', outcome = ${text}, decided_on = app_today()
          where org_id = app_current_org() and id = ${input.caseId}`);
      } else if (input.to === 'appealed') {
        const [open] = await tx.execute<{ ok: boolean }>(sql`
          select ${c.decidedOn}::date + ${APPEAL_DAYS}::int >= app_today() as ok`);
        if (!open?.ok) throw new GrievanceError('appeal_closed');
        if (text.length < 10) throw new GrievanceError('outcome_needed');
        await tx.execute(sql`
          update grievance_case set state = 'appealed', appeal = ${text}
          where org_id = app_current_org() and id = ${input.caseId}`);
      } else {
        // A decision on appeal replaces the outcome when the committee closes with a new one.
        await tx.execute(sql`
          update grievance_case set state = ${input.to},
            outcome = coalesce(nullif(${text}, ''), outcome)
          where org_id = app_current_org() and id = ${input.caseId}`);
      }
      return {
        result: undefined,
        audit: {
          action: 'grievance.case.move',
          entityType: 'grievance_case',
          entityId: input.caseId,
          dataClass: 'sensitive',
          detail: { from: c.state, to: input.to },
        },
        events:
          input.to === 'decided' || input.to === 'closed'
            ? [{ type: CASE_DECIDED, payload: { caseId: input.caseId, state: input.to } }]
            : [],
      };
    },
  );
}
