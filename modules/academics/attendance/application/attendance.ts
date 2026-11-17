// Academics › Attendance for colleges and universities (rule book §13.2: "period-wise (college)";
// "Shortage & Condonation: threshold from rule pack (often 75%), alerts, condonation approval,
// feeds exam eligibility"). A session is one period of a course for a section on a date; the
// percentage is per student per course for the batch's current term. Schools keep school/attendance.
import { approvedCourses, CHOSEN_KINDS } from '@campusverse/academics-registration';
import { batchFacts, coursesForBatchTerm, type BatchFacts } from '@campusverse/academics-structure';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import { emit, type EventInput } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { courseAttendanceAt } from '@campusverse/platform-rulepacks';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import type { CourseAttendanceRules } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import {
  attendedBasisPoints,
  standing,
  type MarkStatus,
  type Standing,
} from '../domain/attendance.js';

type Permissions = ReturnType<typeof createPermissions>;
export type AttendanceDeps = { db: Db; permissions: Permissions };

export const MARK = 'academics.attendance.mark';
export const READ = 'academics.attendance.read';
export const CONDONE = 'academics.attendance.condone';
const PROCESS = 'academics.condonation' as const;
export const ATTENDANCE_TAKEN = 'academics.attendance.taken.v1';
export const SHORTAGE_CONDONED = 'academics.attendance.condoned.v1';

export type AttendanceErrorCode =
  | 'batch_not_found'
  | 'section_not_found'
  | 'course_not_in_term'
  | 'date_outside_term'
  | 'period_taken'
  | 'not_in_section'
  | 'not_condonable'
  | 'condonation_open'
  | 'condonation_not_found'
  | 'already_decided'
  | 'reason_required';

export class AttendanceError extends Error {
  constructor(
    readonly code: AttendanceErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(`course attendance: ${code}`);
    this.name = 'CourseAttendanceError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

/** The batch, if the actor holds any of the permissions at its institution (the first is asserted). */
async function batchAt(
  deps: AttendanceDeps,
  tx: Tx,
  actor: Actor,
  batchId: string,
  permissions: string[],
): Promise<BatchFacts> {
  const b = await batchFacts(tx, batchId);
  const place = b ? await placeOf(tx, b.institutionId) : null;
  if (!b || !place || b.status !== 'running') throw new AttendanceError('batch_not_found');
  const resource = { orgId: actor.orgId, place };
  for (const p of permissions)
    if ((await deps.permissions.can(tx, actor, p, resource)).allowed) return b;
  await deps.permissions.assertCan(tx, actor, permissions[0] ?? READ, resource);
  return b;
}

async function finish<T>(
  tx: Tx,
  actor: Actor,
  out: { result: T; audit: AuditEntry; events?: EventInput[] },
): Promise<T> {
  await writeAudit(tx, actor, out.audit);
  for (const e of out.events ?? []) await emit(tx, e);
  return out.result;
}

/** The term's courses and who takes each: approved registrations, else the compulsory courses. */
async function term(tx: Tx, b: BatchFacts) {
  const courses = (await coursesForBatchTerm(tx, b.batchId))?.courses ?? [];
  const compulsory = courses
    .filter((c) => !(CHOSEN_KINDS as readonly string[]).includes(c.kind))
    .map((c) => c.courseId);
  const approved = await approvedCourses(tx, b.batchId, b.currentTerm);
  const taking = (courseId: string) =>
    b.students.filter((s) => (approved.get(s.personId) ?? compulsory).includes(courseId));
  return { courses, taking };
}

export type AttendanceSheet = {
  course: { courseId: string; code: string; title: string };
  section: { id: string; name: string };
  onDate: string;
  period: number;
  /** Already taken: who and when; marking again replaces the marks. */
  taken: { by: string; at: string } | null;
  students: {
    personId: string;
    name: string;
    registerNumber: string | null;
    status: MarkStatus | null;
  }[];
};

/** One period's sheet: the section's students who take the course, with any marks already given. */
export async function attendanceSheet(
  deps: AttendanceDeps,
  actor: Actor,
  input: { batchId: string; sectionId: string; courseId: string; onDate: string; period: number },
): Promise<AttendanceSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MARK, READ]);
    const section = b.sections.find((s) => s.id === input.sectionId);
    if (!section) throw new AttendanceError('section_not_found');
    const { courses, taking } = await term(tx, b);
    const c = courses.find((x) => x.courseId === input.courseId);
    if (!c) throw new AttendanceError('course_not_in_term');
    const who = taking(c.courseId).filter((s) => s.sectionId === section.id);
    const [session] = await tx.execute<{
      id: string;
      courseId: string;
      by: string;
      at: string;
    }>(sql`
      select id::text, course_id::text as "courseId", taken_by_person_id::text as by, taken_at::text as at
      from course_attendance_session where org_id = app_current_org() and section_id = ${section.id}
        and on_date = ${input.onDate}::date and period = ${input.period}`);
    if (session && session.courseId !== c.courseId) throw new AttendanceError('period_taken');
    const marks = session
      ? new Map(
          (
            await tx.execute<{ id: string; status: MarkStatus }>(sql`
              select student_person_id::text as id, status from course_attendance_mark
              where org_id = app_current_org() and session_id = ${session.id}`)
          ).map((m) => [m.id, m.status]),
        )
      : new Map<string, MarkStatus>();
    const names = await displayNames(tx, [
      ...who.map((s) => s.personId),
      ...(session ? [session.by] : []),
    ]);
    return {
      course: { courseId: c.courseId, code: c.code, title: c.title },
      section,
      onDate: input.onDate,
      period: input.period,
      taken: session ? { by: names[session.by] ?? '', at: session.at } : null,
      students: who.map((s) => ({
        personId: s.personId,
        name: names[s.personId] ?? '',
        registerNumber: s.registerNumber,
        status: marks.get(s.personId) ?? null,
      })),
    };
  });
}

/**
 * Takes (or retakes) a period: every student of the section who takes the course gets a mark.
 * A date outside the current term, in the future, or a period already taken for another course
 * is refused.
 */
export async function takeAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  input: {
    batchId: string;
    sectionId: string;
    courseId: string;
    onDate: string;
    period: number;
    marks: { studentId: string; status: MarkStatus }[];
  },
): Promise<string> {
  if (!DATE.test(input.onDate)) throw new AttendanceError('date_outside_term');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MARK]);
    const section = b.sections.find((s) => s.id === input.sectionId);
    if (!section) throw new AttendanceError('section_not_found');
    if (
      input.onDate > (await today(tx)) ||
      (b.termStartsOn && input.onDate < b.termStartsOn) ||
      (b.termEndsOn && input.onDate > b.termEndsOn)
    )
      throw new AttendanceError('date_outside_term');
    const { courses, taking } = await term(tx, b);
    if (!courses.some((c) => c.courseId === input.courseId))
      throw new AttendanceError('course_not_in_term');
    const who = new Set(
      taking(input.courseId)
        .filter((s) => s.sectionId === section.id)
        .map((s) => s.personId),
    );
    if (input.marks.some((m) => !who.has(m.studentId))) throw new AttendanceError('not_in_section');
    const [existing] = await tx.execute<{ id: string; courseId: string }>(sql`
      select id::text, course_id::text as "courseId" from course_attendance_session
      where org_id = app_current_org() and section_id = ${section.id} and on_date = ${input.onDate}::date
        and period = ${input.period}`);
    if (existing && existing.courseId !== input.courseId) throw new AttendanceError('period_taken');
    const sessionId =
      existing?.id ??
      (
        await tx.execute<{ id: string }>(sql`
          insert into course_attendance_session (org_id, batch_id, term_number, section_id, course_id, on_date, period,
            taken_by_person_id)
          values (app_current_org(), ${b.batchId}, ${b.currentTerm}, ${section.id}, ${input.courseId},
            ${input.onDate}::date, ${input.period}, ${actor.personId})
          returning id::text`)
      )[0]?.id;
    if (!sessionId) throw new Error('takeAttendance: no session');
    await tx.execute(sql`
      delete from course_attendance_mark where org_id = app_current_org() and session_id = ${sessionId}`);
    for (const m of input.marks)
      await tx.execute(sql`
        insert into course_attendance_mark (org_id, session_id, student_person_id, status)
        values (app_current_org(), ${sessionId}, ${m.studentId}, ${m.status})`);
    const absent = input.marks.filter((m) => m.status === 'absent').length;
    return finish(tx, actor, {
      result: sessionId,
      audit: {
        action: existing ? 'academics.attendance.retake' : 'academics.attendance.take',
        entityType: 'course_attendance_session',
        entityId: sessionId,
        dataClass: 'personal',
        detail: { section: section.name, date: input.onDate, period: input.period, absent },
      },
      events: [
        {
          type: ATTENDANCE_TAKEN,
          payload: {
            sessionId,
            batchId: b.batchId,
            courseId: input.courseId,
            onDate: input.onDate,
          },
        },
      ],
    });
  });
}

export type CourseStanding = {
  held: number;
  attended: number;
  basisPoints: number | null;
  standing: Standing;
  condonation: {
    id: string;
    state: 'pending' | 'granted' | 'refused';
    approval: ApprovalState | null;
  } | null;
};

/** A student's standing in a course, with the latest condonation asked for (if any). */
export type StandingRow = Omit<CourseStanding, 'condonation'> & {
  condonationId: string | null;
  condonationState: string | null;
};

/**
 * Each student's standing per course for the batch's current term (key `courseId:studentId`).
 * For exams (eligibility): call inside the tenant, after the caller's own permission check.
 */
export async function courseStandings(
  tx: Tx,
  b: Pick<BatchFacts, 'batchId' | 'currentTerm' | 'institutionId'>,
  rules: CourseAttendanceRules,
): Promise<Map<string, StandingRow>> {
  const marks = await tx.execute<{ courseId: string; studentId: string; status: MarkStatus }>(sql`
    select s.course_id::text as "courseId", m.student_person_id::text as "studentId", m.status
    from course_attendance_mark m join course_attendance_session s on s.org_id = m.org_id and s.id = m.session_id
    where m.org_id = app_current_org() and s.batch_id = ${b.batchId} and s.term_number = ${b.currentTerm}`);
  const condonations = await tx.execute<{
    id: string;
    courseId: string;
    studentId: string;
    state: string;
  }>(sql`
    select distinct on (course_id, student_person_id) id::text, course_id::text as "courseId",
      student_person_id::text as "studentId", state
    from course_attendance_condonation where org_id = app_current_org() and batch_id = ${b.batchId}
      and term_number = ${b.currentTerm}
    order by course_id, student_person_id, requested_at desc`);
  const by = new Map<string, MarkStatus[]>();
  for (const m of marks) {
    const k = `${m.courseId}:${m.studentId}`;
    by.set(k, [...(by.get(k) ?? []), m.status]);
  }
  const cond = new Map(condonations.map((c) => [`${c.courseId}:${c.studentId}`, c]));
  const out = new Map<string, StandingRow>();
  for (const k of new Set([...by.keys(), ...cond.keys()])) {
    const statuses = by.get(k) ?? [];
    const bp = attendedBasisPoints(statuses);
    const c = cond.get(k);
    out.set(k, {
      held: statuses.length,
      attended: statuses.filter((s) => s !== 'absent').length,
      basisPoints: bp,
      standing: standing(bp, rules, c?.state === 'granted'),
      condonationId: c?.id ?? null,
      condonationState: c?.state ?? null,
    });
  }
  return out;
}

export type AttendanceBoard = {
  batch: { id: string; name: string; term: number; termKind: string };
  rules: CourseAttendanceRules;
  sections: { id: string; name: string }[];
  courses: { courseId: string; code: string; title: string; sessions: number }[];
  students: {
    personId: string;
    name: string;
    registerNumber: string | null;
    section: string;
    courses: Record<string, CourseStanding>;
  }[];
};

/** The batch's attendance this term: classes held per course and each student's standing. */
export async function attendanceBoard(
  deps: AttendanceDeps,
  actor: Actor,
  batchId: string,
): Promise<AttendanceBoard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    // An approver named in the designer may hold only the structure's read permission.
    const b = await batchAt(deps, tx, actor, batchId, [
      READ,
      MARK,
      CONDONE,
      'academics.structure.read',
    ]);
    const { courses, taking } = await term(tx, b);
    const rules = await courseAttendanceAt(tx, b.institutionId, await today(tx));
    const standings = await courseStandings(tx, b, rules);
    const sessions = await tx.execute<{ courseId: string; n: number }>(sql`
      select course_id::text as "courseId", count(*)::int as n from course_attendance_session
      where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${b.currentTerm}
      group by course_id`);
    const ids = [...standings.values()].flatMap((s) =>
      s.condonationState === 'pending' && s.condonationId ? [s.condonationId] : [],
    );
    const approvals = await approvalStates(tx, deps.permissions, actor, PROCESS, ids);
    const names = await displayNames(
      tx,
      b.students.map((s) => s.personId),
    );
    return {
      batch: {
        id: b.batchId,
        name: `${b.programCode} ${b.label}`,
        term: b.currentTerm,
        termKind: b.termKind,
      },
      rules,
      sections: b.sections,
      courses: courses.map((c) => ({
        courseId: c.courseId,
        code: c.code,
        title: c.title,
        sessions: sessions.find((x) => x.courseId === c.courseId)?.n ?? 0,
      })),
      students: b.students.map((s) => ({
        personId: s.personId,
        name: names[s.personId] ?? '',
        registerNumber: s.registerNumber,
        section: s.section,
        courses: Object.fromEntries(
          courses
            .filter((c) => taking(c.courseId).some((x) => x.personId === s.personId))
            .map((c) => {
              const st = standings.get(`${c.courseId}:${s.personId}`);
              return [
                c.courseId,
                {
                  held: st?.held ?? 0,
                  attended: st?.attended ?? 0,
                  basisPoints: st?.basisPoints ?? null,
                  standing: st?.standing ?? 'no_classes',
                  condonation:
                    st?.condonationId && st.condonationState
                      ? {
                          id: st.condonationId,
                          state: st.condonationState as 'pending' | 'granted' | 'refused',
                          approval: approvals[st.condonationId] ?? null,
                        }
                      : null,
                },
              ];
            }),
        ),
      })),
    };
  });
}

/**
 * Asks for a shortage to be condoned (the student is below the minimum but within the condonable
 * band), with the reason; decided through the workflow engine (by default `academics.attendance.condone`).
 */
export async function requestCondonation(
  deps: AttendanceDeps,
  actor: Actor,
  input: { batchId: string; courseId: string; studentId: string; reason: string },
): Promise<string> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AttendanceError('reason_required');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [READ, MARK]);
    const rules = await courseAttendanceAt(tx, b.institutionId, await today(tx));
    const st = (await courseStandings(tx, b, rules)).get(`${input.courseId}:${input.studentId}`);
    if (!st || st.standing !== 'condonable')
      throw new AttendanceError(
        st?.condonationState === 'pending' ? 'condonation_open' : 'not_condonable',
      );
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into course_attendance_condonation (org_id, batch_id, term_number, course_id, student_person_id,
        basis_points, reason, requested_by_person_id)
      values (app_current_org(), ${b.batchId}, ${b.currentTerm}, ${input.courseId}, ${input.studentId},
        ${st.basisPoints ?? 0}, ${reason}, ${actor.personId})
      on conflict do nothing returning id::text`);
    if (!row) throw new AttendanceError('condonation_open');
    const name = (await displayNames(tx, [input.studentId]))[input.studentId] ?? '';
    const course = (await coursesForBatchTerm(tx, b.batchId))?.courses.find(
      (c) => c.courseId === input.courseId,
    );
    await startApproval(tx, {
      process: PROCESS,
      subjectId: row.id,
      institutionId: b.institutionId,
      amountPaise: null,
      summary: `Condonation: ${name} · ${course?.code ?? ''} · ${((st.basisPoints ?? 0) / 100).toFixed(2)}%`,
      requestedBy: actor.personId,
    });
    return finish(tx, actor, {
      result: row.id,
      audit: {
        action: 'academics.attendance.condonation_request',
        entityType: 'person',
        entityId: input.studentId,
        dataClass: 'personal',
        reason,
        detail: {
          condonationId: row.id,
          courseId: input.courseId,
          basisPoints: st.basisPoints ?? 0,
        },
      },
    });
  });
}

/** Grants or refuses a condonation through the workflow engine; a refusal needs a note. */
export async function decideCondonation(
  deps: AttendanceDeps,
  actor: Actor,
  input: { condonationId: string; approve: boolean; note: string | null },
): Promise<'granted' | 'refused' | 'pending'> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{
      batchId: string;
      studentId: string;
      courseId: string;
      state: string;
    }>(sql`
      select batch_id::text as "batchId", student_person_id::text as "studentId", course_id::text as "courseId",
        state from course_attendance_condonation where org_id = app_current_org() and id = ${input.condonationId}
      for update`);
    if (!c) throw new AttendanceError('condonation_not_found');
    await batchAt(deps, tx, actor, c.batchId, [CONDONE, READ, MARK, 'academics.structure.read']);
    if (c.state !== 'pending') throw new AttendanceError('already_decided');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: input.condonationId,
      approve: input.approve,
      note: input.note,
    });
    if (outcome === 'pending') return 'pending';
    const state = outcome === 'approved' ? 'granted' : 'refused';
    await tx.execute(sql`
      update course_attendance_condonation set state = ${state}, decided_at = now(),
        decision_note = ${input.note?.trim() || null}
      where org_id = app_current_org() and id = ${input.condonationId}`);
    return finish(tx, actor, {
      result: state,
      audit: {
        action: `academics.attendance.condonation_${state === 'granted' ? 'grant' : 'refuse'}`,
        entityType: 'person',
        entityId: c.studentId,
        dataClass: 'personal',
        detail: { condonationId: input.condonationId, courseId: c.courseId },
      },
      events:
        state === 'granted'
          ? [
              {
                type: SHORTAGE_CONDONED,
                payload: { condonationId: input.condonationId, batchId: c.batchId },
              },
            ]
          : [],
    });
  });
}
