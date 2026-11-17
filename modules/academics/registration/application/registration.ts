// Academics › Course Registration (rule book §13.2, §16.6 step 2): a window per batch term with
// credit limits and elective seats; the office registers each student's courses from their form
// and an approver confirms. Courses, terms and students come from academics/structure.
import {
  batchFacts,
  coursesForBatchTerm,
  type BatchFacts,
  type TermKind,
} from '@campusverse/academics-structure';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import { emit, type EventInput } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { creditFrameworkAt } from '@campusverse/platform-rulepacks';
import { sql } from 'drizzle-orm';
import {
  checkSelection,
  defaultLimits,
  isChosen,
  type Offered,
  type SelectionProblem,
} from '../domain/registration.js';

type Permissions = ReturnType<typeof createPermissions>;
export type RegistrationDeps = { db: Db; permissions: Permissions };

const READ = 'academics.structure.read';
const MANAGE = 'academics.registration.manage';

export const REGISTRATION_SUBMITTED = 'academics.registration.submitted.v1';
/** Timetable, Exams and Fees listen: the student's courses for the term are confirmed. */
export const REGISTRATION_APPROVED = 'academics.registration.approved.v1';

export type RegistrationErrorCode =
  | 'batch_not_found'
  | 'batch_completed'
  | 'no_window'
  | 'window_closed'
  | 'window_dates'
  | 'not_in_batch'
  | 'selection'
  | 'registration_not_found'
  | 'already_decided'
  | 'note_required';

export class RegistrationError extends Error {
  constructor(
    readonly code: RegistrationErrorCode,
    readonly details?: SelectionProblem[],
  ) {
    super(`registration: ${code}`);
    this.name = 'RegistrationError';
  }
}

const one = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T | null> =>
  ((await tx.execute(q)) as T[])[0] ?? null;
const PROCESS = 'academics.registration' as const;
const today = async (tx: Tx) =>
  (await one<{ d: string }>(tx, sql`select app_today()::text as d`))?.d ?? '';

/** The batch, after checking `permission` at its institution. */
async function batchFor(
  deps: RegistrationDeps,
  tx: Tx,
  actor: Actor,
  batchId: string,
  permission: string,
  subjectPersonId?: string,
): Promise<BatchFacts> {
  const b = await batchFacts(tx, batchId);
  const place = b ? await placeOf(tx, b.institutionId) : null;
  if (!b || !place) throw new RegistrationError('batch_not_found');
  await deps.permissions.assertCan(tx, actor, permission, {
    orgId: actor.orgId,
    place,
    ...(subjectPersonId ? { subjectPersonId } : {}),
  });
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

type WindowRow = {
  id: string;
  term: number;
  opensOn: string;
  closesOn: string;
  minCredits: number;
  maxCredits: number;
};

async function windowOf(tx: Tx, batchId: string, term: number): Promise<WindowRow | null> {
  return one<WindowRow>(
    tx,
    sql`select id::text, term_number as term, opens_on::text as "opensOn", closes_on::text as "closesOn",
      min_credits::float as "minCredits", max_credits::float as "maxCredits"
    from registration_window where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${term}`,
  );
}

/** Seats taken in each capped elective of a window, by everyone but `except`. */
async function seatsLeft(
  tx: Tx,
  windowId: string,
  except: string | null,
  lock: boolean,
): Promise<Record<string, number>> {
  const caps = lock
    ? await tx.execute<{ courseId: string; seats: number }>(sql`
        select course_id::text as "courseId", seats from registration_cap
        where org_id = app_current_org() and window_id = ${windowId} order by course_id for update`)
    : await tx.execute<{ courseId: string; seats: number }>(sql`
        select course_id::text as "courseId", seats from registration_cap
        where org_id = app_current_org() and window_id = ${windowId}`);
  const taken = await tx.execute<{ courseId: string; n: number }>(sql`
    select i.course_id::text as "courseId", count(*)::int as n
    from course_registration_item i join course_registration r on r.org_id = i.org_id and r.id = i.registration_id
    where i.org_id = app_current_org() and r.window_id = ${windowId} and r.status <> 'returned'
      and (${except}::uuid is null or r.student_person_id <> ${except}::uuid)
    group by i.course_id`);
  const n = Object.fromEntries(taken.map((t) => [t.courseId, t.n]));
  return Object.fromEntries(caps.map((c) => [c.courseId, c.seats - (n[c.courseId] ?? 0)]));
}

const offeredOf = async (tx: Tx, batchId: string) => {
  const term = await coursesForBatchTerm(tx, batchId);
  return {
    term,
    offered: (term?.courses ?? []).map((c) => ({
      courseId: c.courseId,
      code: c.code,
      title: c.title,
      kind: c.kind,
      credits: c.credits,
    })),
  };
};

// ---------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------

export type RegistrationBoard = {
  batch: {
    id: string;
    name: string;
    currentTerm: number;
    termKind: TermKind;
    parity: 'odd' | 'even';
    status: 'running' | 'completed';
  };
  window: (WindowRow & { open: boolean; upcoming: boolean }) | null;
  /** For opening a window: the framework's term load, else compulsory to everything. */
  defaults: { min: number; max: number; closesBy: string | null };
  courses: (Offered & {
    title: string;
    chosen: boolean;
    seats: number | null;
    taken: number;
  })[];
  students: {
    personId: string;
    name: string;
    registerNumber: string | null;
    section: string;
    registration: {
      id: string;
      status: 'submitted' | 'approved' | 'returned';
      credits: number;
      courseIds: string[];
      note: string | null;
      submittedAt: string;
      /** The approval in the shared engine: step, who decides, and whether the viewer may. */
      approval: ApprovalState | null;
    } | null;
  }[];
};

/** A batch's registration for its current term: the window, the courses with seats, every student. */
export async function registrationBoard(
  deps: RegistrationDeps,
  actor: Actor,
  batchId: string,
): Promise<RegistrationBoard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchFor(deps, tx, actor, batchId, READ);
    const { term, offered } = await offeredOf(tx, batchId);
    const w = await windowOf(tx, batchId, b.currentTerm);
    const d = await today(tx);
    const left = w ? await seatsLeft(tx, w.id, null, false) : {};
    const caps = w
      ? Object.fromEntries(
          (
            await tx.execute<{ courseId: string; seats: number }>(sql`
              select course_id::text as "courseId", seats from registration_cap
              where org_id = app_current_org() and window_id = ${w.id}`)
          ).map((c) => [c.courseId, c.seats]),
        )
      : {};
    const regs = w
      ? await tx.execute<{
          id: string;
          personId: string;
          status: 'submitted' | 'approved' | 'returned';
          credits: number;
          note: string | null;
          submittedAt: string;
          courseIds: string[];
        }>(sql`
          select r.id::text, r.student_person_id::text as "personId", r.status, r.credits::float as credits,
            r.note, r.submitted_at::text as "submittedAt",
            coalesce(array_agg(i.course_id::text) filter (where i.course_id is not null), '{}') as "courseIds"
          from course_registration r
          left join course_registration_item i on i.org_id = r.org_id and i.registration_id = r.id
          where r.org_id = app_current_org() and r.window_id = ${w.id}
          group by r.org_id, r.id`)
      : [];
    const byStudent = new Map(regs.map((r) => [r.personId, r]));
    const approvals = await approvalStates(
      tx,
      deps.permissions,
      actor,
      PROCESS,
      regs.map((r) => r.id),
    );
    const names = await displayNames(
      tx,
      b.students.map((s) => s.personId),
    );
    const framework = await creditFrameworkAt(tx, b.institutionId, b.framework, d);
    return {
      batch: {
        id: b.batchId,
        name: `${b.programCode} ${b.label}`,
        currentTerm: b.currentTerm,
        termKind: b.termKind,
        parity: term?.parity ?? (b.currentTerm % 2 ? 'odd' : 'even'),
        status: b.status,
      },
      window: w
        ? {
            ...w,
            open: b.status === 'running' && d >= w.opensOn && d <= w.closesOn,
            upcoming: d < w.opensOn,
          }
        : null,
      defaults: { ...defaultLimits(offered, framework?.perTerm ?? null), closesBy: b.termEndsOn },
      courses: offered.map((c) => {
        const seats = caps[c.courseId] ?? null;
        return {
          ...c,
          chosen: isChosen(c.kind),
          seats,
          taken: seats === null ? 0 : seats - (left[c.courseId] ?? seats),
        };
      }),
      students: b.students.map((s) => {
        const r = byStudent.get(s.personId);
        return {
          ...s,
          name: names[s.personId] ?? '',
          registration: r
            ? {
                id: r.id,
                status: r.status,
                credits: r.credits,
                courseIds: r.courseIds,
                note: r.note,
                submittedAt: r.submittedAt,
                approval: approvals[r.id] ?? null,
              }
            : null,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/**
 * Opens the registration window for a batch's current term, or changes its dates, credit limits
 * and elective seats. A window always belongs to the term the batch is in when it is saved.
 */
export async function saveWindow(
  deps: RegistrationDeps,
  actor: Actor,
  input: {
    batchId: string;
    opensOn: string;
    closesOn: string;
    minCredits: number;
    maxCredits: number;
    caps: { courseId: string; seats: number }[];
  },
): Promise<string> {
  if (input.closesOn < input.opensOn || input.maxCredits < input.minCredits)
    throw new RegistrationError('window_dates');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchFor(deps, tx, actor, input.batchId, MANAGE);
    if (b.status !== 'running') throw new RegistrationError('batch_completed');
    const { offered } = await offeredOf(tx, input.batchId);
    const electives = new Set(offered.filter((c) => isChosen(c.kind)).map((c) => c.courseId));
    const caps = input.caps.filter((c) => electives.has(c.courseId));
    const row = await one<{ id: string }>(
      tx,
      sql`
      insert into registration_window (org_id, batch_id, term_number, opens_on, closes_on, min_credits, max_credits)
      values (app_current_org(), ${input.batchId}, ${b.currentTerm}, ${input.opensOn}::date, ${input.closesOn}::date,
        ${input.minCredits}, ${input.maxCredits})
      on conflict (org_id, batch_id, term_number) do update set opens_on = excluded.opens_on,
        closes_on = excluded.closes_on, min_credits = excluded.min_credits, max_credits = excluded.max_credits
      returning id::text`,
    );
    if (!row) throw new Error('saveWindow: no row');
    await tx.execute(
      sql`delete from registration_cap where org_id = app_current_org() and window_id = ${row.id}`,
    );
    for (const c of caps)
      await tx.execute(sql`
        insert into registration_cap (org_id, window_id, course_id, seats)
        values (app_current_org(), ${row.id}, ${c.courseId}, ${c.seats})`);
    return finish(tx, actor, {
      result: row.id,
      audit: {
        action: 'academics.registration.window',
        entityType: 'registration_window',
        entityId: row.id,
        dataClass: 'operational',
        detail: {
          batchId: input.batchId,
          term: b.currentTerm,
          opensOn: input.opensOn,
          closesOn: input.closesOn,
          minCredits: input.minCredits,
          maxCredits: input.maxCredits,
          caps: caps.length,
        },
      },
    });
  });
}

/**
 * Registers a student for the term (or changes their registration while the window is open):
 * every compulsory course plus the chosen electives, within the credit limits and the seats left.
 * It goes to an approver; a change after approval goes back for approval.
 */
export async function register(
  deps: RegistrationDeps,
  actor: Actor,
  input: { batchId: string; studentId: string; electiveIds: string[] },
): Promise<string> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchFor(deps, tx, actor, input.batchId, MANAGE, input.studentId);
    if (b.status !== 'running') throw new RegistrationError('batch_completed');
    if (!b.students.some((s) => s.personId === input.studentId))
      throw new RegistrationError('not_in_batch');
    const w = await windowOf(tx, input.batchId, b.currentTerm);
    if (!w) throw new RegistrationError('no_window');
    const d = await today(tx);
    if (d < w.opensOn || d > w.closesOn) throw new RegistrationError('window_closed');
    const { offered } = await offeredOf(tx, input.batchId);
    const check = checkSelection({
      offered,
      chosen: input.electiveIds,
      min: w.minCredits,
      max: w.maxCredits,
      seatsLeft: await seatsLeft(tx, w.id, input.studentId, true),
    });
    if (check.problems.length) throw new RegistrationError('selection', check.problems);
    const row = await one<{ id: string }>(
      tx,
      sql`
      insert into course_registration (org_id, window_id, student_person_id, status, credits, submitted_by_person_id)
      values (app_current_org(), ${w.id}, ${input.studentId}, 'submitted', ${check.credits}, ${actor.personId})
      on conflict (org_id, window_id, student_person_id) do update set status = 'submitted',
        credits = excluded.credits, submitted_at = now(), submitted_by_person_id = excluded.submitted_by_person_id,
        decided_at = null, decided_by_person_id = null, note = null
      returning id::text`,
    );
    if (!row) throw new Error('register: no row');
    await tx.execute(sql`
      delete from course_registration_item where org_id = app_current_org() and registration_id = ${row.id}`);
    for (const c of check.courses)
      await tx.execute(sql`
        insert into course_registration_item (org_id, registration_id, course_id, credits, elective)
        values (app_current_org(), ${row.id}, ${c.courseId}, ${c.credits}, ${isChosen(c.kind)})`);
    const name = (await displayNames(tx, [input.studentId]))[input.studentId] ?? '';
    await startApproval(tx, {
      process: PROCESS,
      subjectId: row.id,
      institutionId: b.institutionId,
      amountPaise: null,
      summary: `${name} · ${b.programCode} ${b.label} · ${check.credits} credits`,
      requestedBy: actor.personId,
    });
    return finish(tx, actor, {
      result: row.id,
      audit: {
        action: 'academics.registration.submit',
        entityType: 'person',
        entityId: input.studentId,
        dataClass: 'personal',
        detail: {
          batchId: input.batchId,
          term: b.currentTerm,
          courses: check.courses.map((c) => c.code).join(', '),
          credits: check.credits,
        },
      },
      events: [
        {
          type: REGISTRATION_SUBMITTED,
          payload: { registrationId: row.id, studentId: input.studentId, batchId: input.batchId },
        },
      ],
    });
  });
}

/**
 * Decides the current approval step of a registration through the shared engine (who may decide
 * comes from the approval designer). The registration is approved after the last step, or
 * returned with the reason at once.
 */
export async function decideRegistration(
  deps: RegistrationDeps,
  actor: Actor,
  input: { registrationId: string; decision: 'approve' | 'return'; note: string | null },
): Promise<'approved' | 'returned' | 'pending'> {
  const note = input.note?.trim() || null;
  if (input.decision === 'return' && !note) throw new RegistrationError('note_required');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await one<{ batchId: string; term: number; studentId: string; status: string }>(
      tx,
      sql`select w.batch_id::text as "batchId", w.term_number as term, r.student_person_id::text as "studentId",
        r.status
      from course_registration r join registration_window w on w.org_id = r.org_id and w.id = r.window_id
      where r.org_id = app_current_org() and r.id = ${input.registrationId} for update of r`,
    );
    if (!r) throw new RegistrationError('registration_not_found');
    await batchFor(deps, tx, actor, r.batchId, READ, r.studentId);
    if (r.status !== 'submitted') throw new RegistrationError('already_decided');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: input.registrationId,
      approve: input.decision === 'approve',
      note,
    });
    if (outcome === 'pending')
      return finish(tx, actor, {
        result: 'pending' as const,
        audit: {
          action: 'academics.registration.step_approve',
          entityType: 'person',
          entityId: r.studentId,
          dataClass: 'personal',
          detail: { registrationId: input.registrationId, term: r.term },
        },
      });
    const status = outcome === 'approved' ? 'approved' : 'returned';
    await tx.execute(sql`
      update course_registration set status = ${status}, decided_at = now(),
        decided_by_person_id = ${actor.personId}, note = ${note}
      where org_id = app_current_org() and id = ${input.registrationId}`);
    const courseIds = (
      await tx.execute<{ id: string }>(sql`
        select course_id::text as id from course_registration_item
        where org_id = app_current_org() and registration_id = ${input.registrationId}`)
    ).map((c) => c.id);
    return finish(tx, actor, {
      result: status,
      audit: {
        action: `academics.registration.${input.decision}`,
        entityType: 'person',
        entityId: r.studentId,
        dataClass: 'personal',
        detail: { registrationId: input.registrationId, term: r.term, note },
      },
      events:
        status === 'approved'
          ? [
              {
                type: REGISTRATION_APPROVED,
                payload: {
                  registrationId: input.registrationId,
                  studentId: r.studentId,
                  batchId: r.batchId,
                  term: r.term,
                  courseIds,
                },
              },
            ]
          : [],
    });
  });
}

/**
 * Each student's approved courses for a batch term, for exams and the timetable. Students with no
 * approved registration are absent from the map. Call inside the tenant, after the caller's check.
 */
export async function approvedCourses(
  tx: Tx,
  batchId: string,
  term: number,
): Promise<Map<string, string[]>> {
  const rows = await tx.execute<{ studentId: string; courseId: string }>(sql`
    select r.student_person_id::text as "studentId", i.course_id::text as "courseId"
    from course_registration r
    join registration_window w on w.org_id = r.org_id and w.id = r.window_id
    join course_registration_item i on i.org_id = r.org_id and i.registration_id = r.id
    where r.org_id = app_current_org() and w.batch_id = ${batchId} and w.term_number = ${term}
      and r.status = 'approved'`);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.studentId, [...(out.get(r.studentId) ?? []), r.courseId]);
  return out;
}
