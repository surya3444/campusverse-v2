// Students › Mentoring (rule book §13.5, §16.4; docs/specs/MENTORING.md): one mentor per student,
// check-ins with notes and a concern level, and escalations. Students and staff come from
// people/records; a student's class through AcademicPlacementPort. Never reads academic tables.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  displayNames,
  memberKind,
  staffAt,
  studentIdsAt,
  type AcademicPlacementPort,
} from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  canMove,
  checkInDue,
  loadSummary,
  type Concern,
  type EscalateTo,
  type MeetingState,
} from '../domain/mentoring.js';

type Permissions = ReturnType<typeof createPermissions>;
export type MentoringDeps = {
  db: Db;
  permissions: Permissions;
  placements: Pick<AcademicPlacementPort, 'getPlacements'>[];
};

export const ESCALATION_RAISED = 'mentoring.escalation.raised.v1';

export class MentoringError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'not_a_student'
      | 'not_staff'
      | 'not_your_mentee'
      | 'meeting_not_found'
      | 'meeting_done'
      | 'escalation_not_found'
      | 'already_closed',
  ) {
    super(`mentoring: ${code}`);
    this.name = 'MentoringError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function placeRes(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new MentoringError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}
const resAt = (deps: MentoringDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => placeRes(tx, actor, institutionId));
const allowed = async (deps: MentoringDeps, tx: Tx, actor: Actor, perm: string, r: Resource) =>
  (await deps.permissions.can(tx, actor, perm, r)).allowed;

async function labelsFor(tx: Tx, deps: MentoringDeps, ids: string[], on: string) {
  const found = await Promise.all(
    deps.placements.map((p) => p.getPlacements(tx, { personIds: ids, onDate: on })),
  );
  return (id: string) => found.map((m) => m.get(id)).find((x) => x !== undefined) ?? null;
}

/** The mentor a student has today in this institution, if any. */
async function mentorOf(tx: Tx, institutionId: string, studentId: string) {
  const [r] = await tx.execute<{ mentorId: string }>(sql`
    select mentor_person_id::text as "mentorId" from mentor_assignment
    where org_id = app_current_org() and institution_id = ${institutionId}
      and student_person_id = ${studentId} and valid_during @> app_today()`);
  return r?.mentorId ?? null;
}

/**
 * A mentor may act only for their own mentees; a manager for anyone in the institution. Throws
 * when neither. Returns whether the actor is a manager.
 */
async function assertMenteeAccess(
  deps: MentoringDeps,
  tx: Tx,
  actor: Actor,
  institutionId: string,
  studentId: string,
): Promise<boolean> {
  const r = await placeRes(tx, actor, institutionId);
  if (await allowed(deps, tx, actor, 'mentoring.allocation.manage', r)) return true;
  await deps.permissions.assertCan(tx, actor, 'mentoring.mentee.mentor', r);
  if ((await mentorOf(tx, institutionId, studentId)) !== actor.personId)
    throw new MentoringError('not_your_mentee');
  return false;
}

// ---------------------------------------------------------------------------------------------
// Allocation (the head of department)
// ---------------------------------------------------------------------------------------------

export type MentorLoad = {
  personId: string;
  name: string;
  designation: string | null;
  mentees: number;
};
export type StudentRow = {
  personId: string;
  name: string;
  label: string | null;
  mentor: string | null;
};
export type Allocation = {
  summary: ReturnType<typeof loadSummary>;
  mentors: MentorLoad[];
  students: StudentRow[];
};

/** Every staff member's mentee count and every student with their mentor (or none). */
export async function allocation(
  deps: MentoringDeps,
  actor: Actor,
  institutionId: string,
): Promise<Allocation> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'mentoring.allocation.manage',
      await placeRes(tx, actor, institutionId),
    );
    const on = await today(tx);
    const staff = await staffAt(tx, institutionId, on);
    const studentIds = await studentIdsAt(tx, institutionId);
    const current = await tx.execute<{ studentId: string; mentorId: string }>(sql`
      select student_person_id::text as "studentId", mentor_person_id::text as "mentorId"
      from mentor_assignment
      where org_id = app_current_org() and institution_id = ${institutionId} and valid_during @> app_today()`);
    const byStudent = new Map(current.map((c) => [c.studentId, c.mentorId]));
    const counts = new Map<string, number>();
    for (const c of current) counts.set(c.mentorId, (counts.get(c.mentorId) ?? 0) + 1);
    const names = await displayNames(tx, [...studentIds, ...current.map((c) => c.mentorId)]);
    const label = await labelsFor(tx, deps, studentIds, on);
    const mentors = staff
      .map((s) => ({
        personId: s.personId,
        name: s.name,
        designation: s.designation ?? null,
        mentees: counts.get(s.personId) ?? 0,
      }))
      .sort((a, b) => b.mentees - a.mentees || a.name.localeCompare(b.name));
    const students = studentIds
      .map((id) => {
        const m = byStudent.get(id);
        return {
          personId: id,
          name: names[id] ?? '',
          label: label(id)?.displayLabel ?? null,
          mentor: m ? (names[m] ?? '') : null,
        };
      })
      .sort(
        (a, b) =>
          Number(!!a.mentor) - Number(!!b.mentor) ||
          (a.label ?? '').localeCompare(b.label ?? '') ||
          a.name.localeCompare(b.name),
      );
    return {
      summary: {
        ...loadSummary([...counts.values()], studentIds.length),
        // Counted from the students themselves: a mentor who has left staff still holds mentees.
        unassigned: studentIds.filter((id) => !byStudent.has(id)).length,
      },
      mentors,
      students,
    };
  });
}

/**
 * Gives these students this mentor from today. A student's earlier mentor ends yesterday (or the
 * assignment made today is replaced), so history is kept and only one mentor holds at a time.
 */
export async function assignMentor(
  deps: MentoringDeps,
  actor: Actor,
  input: { institutionId: string; mentorId: string; studentIds: string[] },
): Promise<{ assigned: number }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'mentoring.allocation.manage', resource },
    async (tx) => {
      const on = await today(tx);
      const kind = (personId: string) =>
        memberKind(tx, { institutionId: input.institutionId, personId, onDate: on });
      if ((await kind(input.mentorId)) !== 'staff') throw new MentoringError('not_staff');
      const ids = [...new Set(input.studentIds)];
      for (const id of ids)
        if ((await kind(id)) !== 'student') throw new MentoringError('not_a_student');
      let assigned = 0;
      for (const id of ids) {
        const current = await mentorOf(tx, input.institutionId, id);
        if (current === input.mentorId) continue;
        // Started today: the mentor is changed in place. Started earlier: it ends today and a
        // new one starts, so the history is kept.
        const replaced = await tx.execute(sql`
          update mentor_assignment set mentor_person_id = ${input.mentorId},
            assigned_by_person_id = ${actor.personId}
          where org_id = app_current_org() and institution_id = ${input.institutionId}
            and student_person_id = ${id} and lower(valid_during) = app_today()
          returning 1`);
        if (replaced.length === 0) {
          await tx.execute(sql`
            update mentor_assignment set valid_during = daterange(lower(valid_during), app_today())
            where org_id = app_current_org() and institution_id = ${input.institutionId}
              and student_person_id = ${id} and valid_during @> app_today()`);
          await tx.execute(sql`
            insert into mentor_assignment (org_id, institution_id, student_person_id, mentor_person_id,
              valid_during, assigned_by_person_id)
            values (app_current_org(), ${input.institutionId}, ${id}, ${input.mentorId},
              daterange(app_today(), null), ${actor.personId})`);
        }
        assigned++;
      }
      return {
        result: { assigned },
        audit: {
          action: 'mentoring.mentor.assign',
          entityType: 'person',
          entityId: input.mentorId,
          dataClass: 'personal',
          detail: { students: ids.length, assigned },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// The mentor
// ---------------------------------------------------------------------------------------------

export type MenteeRow = {
  personId: string;
  name: string;
  label: string | null;
  lastHeld: string | null;
  lastConcern: Concern | null;
  nextScheduled: string | null;
  openEscalations: number;
  due: boolean;
};

/** The mentor's own mentees: last check-in, the next one, concern, open escalations. */
export async function myMentees(
  deps: MentoringDeps,
  actor: Actor,
  institutionId: string,
): Promise<MenteeRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'mentoring.mentee.mentor',
      await placeRes(tx, actor, institutionId),
    );
    const on = await today(tx);
    const rows = await tx.execute<Omit<MenteeRow, 'name' | 'label' | 'due'>>(sql`
      select a.student_person_id::text as "personId",
        (select max(m.scheduled_for)::text from mentor_meeting m where m.org_id = a.org_id
          and m.institution_id = a.institution_id and m.student_person_id = a.student_person_id
          and m.state = 'held') as "lastHeld",
        (select m.concern from mentor_meeting m where m.org_id = a.org_id and m.institution_id = a.institution_id
          and m.student_person_id = a.student_person_id and m.state = 'held'
          order by m.scheduled_for desc, m.recorded_at desc limit 1) as "lastConcern",
        (select min(m.scheduled_for)::text from mentor_meeting m where m.org_id = a.org_id
          and m.institution_id = a.institution_id and m.student_person_id = a.student_person_id
          and m.state = 'scheduled') as "nextScheduled",
        (select count(*)::int from mentor_escalation e where e.org_id = a.org_id
          and e.institution_id = a.institution_id and e.student_person_id = a.student_person_id
          and e.state = 'open') as "openEscalations"
      from mentor_assignment a
      where a.org_id = app_current_org() and a.institution_id = ${institutionId}
        and a.mentor_person_id = ${actor.personId} and a.valid_during @> app_today()`);
    const names = await displayNames(
      tx,
      rows.map((r) => r.personId),
    );
    const label = await labelsFor(
      tx,
      deps,
      rows.map((r) => r.personId),
      on,
    );
    const rank = { concern: 0, watch: 1, fine: 2 } as const;
    return rows
      .map((r) => ({
        ...r,
        name: names[r.personId] ?? '',
        label: label(r.personId)?.displayLabel ?? null,
        due: checkInDue(r.lastHeld, on),
      }))
      .sort(
        (a, b) =>
          (a.lastConcern ? rank[a.lastConcern] : 3) - (b.lastConcern ? rank[b.lastConcern] : 3) ||
          Number(b.due) - Number(a.due) ||
          a.name.localeCompare(b.name),
      );
  });
}

export type MeetingRow = {
  id: string;
  scheduledFor: string;
  state: MeetingState;
  notes: string | null;
  concern: Concern | null;
  mentor: string;
};
export type EscalationRow = {
  id: string;
  studentId: string;
  student: string;
  label: string | null;
  to: EscalateTo;
  reason: string;
  raisedBy: string;
  createdAt: string;
  state: 'open' | 'closed';
  closingNote: string | null;
  closedBy: string | null;
};
export type MenteeLog = {
  personId: string;
  name: string;
  label: string | null;
  mentor: string | null;
  meetings: MeetingRow[];
  escalations: EscalationRow[];
};

/** One mentee's check-ins and escalations, for their mentor or a manager. */
export async function menteeLog(
  deps: MentoringDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string },
): Promise<MenteeLog> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await assertMenteeAccess(deps, tx, actor, input.institutionId, input.studentId);
    const on = await today(tx);
    const meetings = await tx.execute<Omit<MeetingRow, 'mentor'> & { mentorId: string }>(sql`
      select id::text, scheduled_for::text as "scheduledFor", state, notes, concern,
        mentor_person_id::text as "mentorId"
      from mentor_meeting where org_id = app_current_org() and institution_id = ${input.institutionId}
        and student_person_id = ${input.studentId}
      order by scheduled_for desc, created_at desc limit 50`);
    const escalations = await escalationRows(tx, deps, input.institutionId, on, {
      studentId: input.studentId,
    });
    const mentorId = await mentorOf(tx, input.institutionId, input.studentId);
    const names = await displayNames(tx, [
      input.studentId,
      ...meetings.map((m) => m.mentorId),
      ...(mentorId ? [mentorId] : []),
    ]);
    const label = await labelsFor(tx, deps, [input.studentId], on);
    return {
      personId: input.studentId,
      name: names[input.studentId] ?? '',
      label: label(input.studentId)?.displayLabel ?? null,
      mentor: mentorId ? (names[mentorId] ?? '') : null,
      meetings: meetings.map(({ mentorId: m, ...x }) => ({ ...x, mentor: names[m] ?? '' })),
      escalations,
    };
  });
}

export async function scheduleCheckIn(
  deps: MentoringDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string; on: string },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'mentoring.mentee.mentor', resource },
    async (tx) => {
      await assertMenteeAccess(deps, tx, actor, input.institutionId, input.studentId);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into mentor_meeting (org_id, institution_id, student_person_id, mentor_person_id, scheduled_for)
        values (app_current_org(), ${input.institutionId}, ${input.studentId}, ${actor.personId}, ${input.on}::date)
        returning id::text`);
      if (!row) throw new Error('scheduleCheckIn: no row');
      return {
        result: row,
        audit: {
          action: 'mentoring.meeting.schedule',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { meetingId: row.id, on: input.on },
        },
      };
    },
  );
}

/**
 * Records how a check-in went: held (with notes and a concern level), missed or cancelled. With
 * no meeting id, a check-in held today is recorded straight away.
 */
export async function recordCheckIn(
  deps: MentoringDeps,
  actor: Actor,
  input: {
    institutionId: string;
    studentId: string;
    meetingId?: string | undefined;
    state: Exclude<MeetingState, 'scheduled'>;
    notes: string | null;
    concern: Concern | null;
  },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'mentoring.mentee.mentor', resource },
    async (tx) => {
      await assertMenteeAccess(deps, tx, actor, input.institutionId, input.studentId);
      const concern = input.state === 'held' ? (input.concern ?? 'fine') : null;
      const notes = input.notes?.trim() || null;
      let id = input.meetingId ?? null;
      if (id) {
        const [m] = await tx.execute<{ state: MeetingState }>(sql`
          select state from mentor_meeting where org_id = app_current_org() and id = ${id}
            and institution_id = ${input.institutionId} and student_person_id = ${input.studentId}
          for update`);
        if (!m) throw new MentoringError('meeting_not_found');
        if (!canMove(m.state, input.state)) throw new MentoringError('meeting_done');
        await tx.execute(sql`
          update mentor_meeting set state = ${input.state}, notes = ${notes}, concern = ${concern},
            recorded_at = now(), mentor_person_id = ${actor.personId}
          where org_id = app_current_org() and id = ${id}`);
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into mentor_meeting (org_id, institution_id, student_person_id, mentor_person_id,
            scheduled_for, state, notes, concern, recorded_at)
          values (app_current_org(), ${input.institutionId}, ${input.studentId}, ${actor.personId},
            app_today(), ${input.state}, ${notes}, ${concern}, now())
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'mentoring.meeting.record',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { meetingId: id, state: input.state, concern },
        },
      };
    },
  );
}

/** The mentor (or a manager) sends a concern to the head of department, counsellor or parent. */
export async function escalate(
  deps: MentoringDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string; to: EscalateTo; reason: string },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'mentoring.mentee.mentor', resource },
    async (tx) => {
      await assertMenteeAccess(deps, tx, actor, input.institutionId, input.studentId);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into mentor_escalation (org_id, institution_id, student_person_id, raised_by_person_id,
          escalated_to, reason)
        values (app_current_org(), ${input.institutionId}, ${input.studentId}, ${actor.personId},
          ${input.to}, btrim(${input.reason}))
        returning id::text`);
      if (!row) throw new Error('escalate: no row');
      return {
        result: row,
        audit: {
          action: 'mentoring.escalation.raise',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { escalationId: row.id, to: input.to },
        },
        events: [
          {
            type: ESCALATION_RAISED,
            payload: {
              escalationId: row.id,
              institutionId: input.institutionId,
              studentId: input.studentId,
              to: input.to,
              raisedBy: actor.personId,
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Escalations (the head of department and the counsellor)
// ---------------------------------------------------------------------------------------------

async function escalationRows(
  tx: Tx,
  deps: MentoringDeps,
  institutionId: string,
  on: string,
  filter: { studentId?: string; to?: EscalateTo[] },
): Promise<EscalationRow[]> {
  const to = filter.to ? `{${filter.to.join(',')}}` : null;
  const rows = await tx.execute<
    Omit<EscalationRow, 'student' | 'label' | 'raisedBy' | 'closedBy'> & {
      byId: string;
      closedById: string | null;
    }
  >(sql`
    select id::text, student_person_id::text as "studentId", escalated_to as to, reason,
      raised_by_person_id::text as "byId", created_at::text as "createdAt", state,
      closing_note as "closingNote", closed_by_person_id::text as "closedById"
    from mentor_escalation
    where org_id = app_current_org() and institution_id = ${institutionId}
      and (${filter.studentId ?? null}::uuid is null or student_person_id = ${filter.studentId ?? null}::uuid)
      and (${to}::text[] is null or escalated_to = any(${to}::text[]))
      and (state = 'open' or created_at >= now() - interval '90 days')
    order by (state = 'open') desc, created_at desc limit 200`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.studentId, r.byId, ...(r.closedById ? [r.closedById] : [])]),
  );
  const label = await labelsFor(
    tx,
    deps,
    rows.map((r) => r.studentId),
    on,
  );
  return rows.map(({ byId, closedById, ...r }) => ({
    ...r,
    student: names[r.studentId] ?? '',
    label: label(r.studentId)?.displayLabel ?? null,
    raisedBy: names[byId] ?? '',
    closedBy: closedById ? (names[closedById] ?? '') : null,
  }));
}

/**
 * Escalations for the people who handle them: managers see all; a counsellor sees those sent to
 * the counsellor.
 */
export async function escalations(
  deps: MentoringDeps,
  actor: Actor,
  institutionId: string,
): Promise<EscalationRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await placeRes(tx, actor, institutionId);
    const manager = await allowed(deps, tx, actor, 'mentoring.allocation.manage', r);
    if (!manager) await deps.permissions.assertCan(tx, actor, 'mentoring.escalation.counsel', r);
    return escalationRows(tx, deps, institutionId, await today(tx), {
      ...(manager ? {} : { to: ['counsellor' as const] }),
    });
  });
}

export async function closeEscalation(
  deps: MentoringDeps,
  actor: Actor,
  input: { institutionId: string; escalationId: string; note: string },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  const counsel = await withTenant(deps.db, actor.orgId, async (tx) =>
    (await allowed(deps, tx, actor, 'mentoring.allocation.manage', resource))
      ? 'mentoring.allocation.manage'
      : 'mentoring.escalation.counsel',
  );
  await command(deps.db, deps.permissions, actor, { permission: counsel, resource }, async (tx) => {
    const [e] = await tx.execute<{ state: string; to: EscalateTo; studentId: string }>(sql`
        select state, escalated_to as to, student_person_id::text as "studentId" from mentor_escalation
        where org_id = app_current_org() and id = ${input.escalationId}
          and institution_id = ${input.institutionId} for update`);
    if (!e || (counsel === 'mentoring.escalation.counsel' && e.to !== 'counsellor'))
      throw new MentoringError('escalation_not_found');
    if (e.state === 'closed') throw new MentoringError('already_closed');
    await tx.execute(sql`
        update mentor_escalation set state = 'closed', closed_at = now(),
          closed_by_person_id = ${actor.personId}, closing_note = btrim(${input.note})
        where org_id = app_current_org() and id = ${input.escalationId}`);
    return {
      result: undefined,
      audit: {
        action: 'mentoring.escalation.close',
        entityType: 'person',
        entityId: e.studentId,
        dataClass: 'personal',
        detail: { escalationId: input.escalationId },
      },
    };
  });
}
