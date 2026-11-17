// Academics › Exams & Results for colleges and universities (rule book §13.2; P0 item 12): marks
// per course of a batch's current term, locked when submitted, results graded on the credits
// pack's scale with SGPA and CGPA, published only with a second person's approval. Students and
// their courses come from academics/structure and academics/registration.
import { approvedCourses, CHOSEN_KINDS } from '@campusverse/academics-registration';
import {
  batchFacts,
  coursesForBatchTerm,
  type BatchFacts,
  type CieComponent,
  type CurriculumCourse,
} from '@campusverse/academics-structure';
import type { FieldKeys } from '@campusverse/crypto';
import type { ObjectStore } from '@campusverse/platform-documents';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, learnerIdsForExport, studentFactsFor } from '@campusverse/people-records';
import { writeAudit, type AuditEntry } from '@campusverse/platform-audit';
import { emit, type EventInput } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { gradingAt } from '@campusverse/platform-rulepacks';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import type { GradingRules } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import {
  cieFrom,
  complete,
  termResults,
  type Mark,
  type StudentResult,
} from '../domain/results.js';
import { withReexams } from '../domain/reexam.js';

type Permissions = ReturnType<typeof createPermissions>;
/** `keys`: the field keys, to open ABC and APAAR IDs for the credit file. */
/** `store` and `verifyBaseUrl`: where hall tickets (frozen, QR-verifiable PDFs) are kept and checked. */
export type ExamDeps = {
  db: Db;
  permissions: Permissions;
  keys?: FieldKeys | undefined;
  store?: ObjectStore | undefined;
  verifyBaseUrl?: string | undefined;
};

export const MARKS = 'academics.exam.marks';
export const MANAGE = 'academics.exam.manage';
export const PUBLISH = 'academics.exam.publish';
const PROCESS = 'academics.results' as const;
export const RESULTS_PUBLISHED = 'academics.results.published.v1';

export type ExamErrorCode =
  | 'batch_not_found'
  | 'course_not_in_term'
  | 'locked'
  | 'not_locked'
  | 'marks_incomplete'
  | 'mark_out_of_range'
  | 'not_taking'
  | 'not_all_locked'
  | 'result_exists'
  | 'result_not_found'
  | 'already_decided'
  | 'not_published'
  | 'reexam_not_allowed'
  | 'reexam_open'
  | 'reexam_not_found'
  | 'reexam_state'
  | 'scores_needed'
  | 'no_components'
  | 'release_reason_needed'
  | 'no_hall_ticket';

export class ExamError extends Error {
  constructor(
    readonly code: ExamErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(`exams: ${code}`);
    this.name = 'ExamError';
  }
}

export const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

export async function batchAt(
  deps: ExamDeps,
  tx: Tx,
  actor: Actor,
  batchId: string,
  permissions: string[],
  subjectPersonId?: string,
): Promise<BatchFacts> {
  const b = await batchFacts(tx, batchId);
  const place = b ? await placeOf(tx, b.institutionId) : null;
  if (!b || !place) throw new ExamError('batch_not_found');
  const resource = {
    orgId: actor.orgId,
    place,
    ...(subjectPersonId ? { subjectPersonId } : {}),
  };
  for (const p of permissions)
    if ((await deps.permissions.can(tx, actor, p, resource)).allowed) return b;
  await deps.permissions.assertCan(tx, actor, permissions[0] ?? MARKS, resource);
  return b;
}

export async function finish<T>(
  tx: Tx,
  actor: Actor,
  out: { result: T; audit: AuditEntry; events?: EventInput[] },
): Promise<T> {
  await writeAudit(tx, actor, out.audit);
  for (const e of out.events ?? []) await emit(tx, e);
  return out.result;
}

/** The term's courses and who takes each: approved registrations, else the compulsory courses. */
export async function term(tx: Tx, b: BatchFacts) {
  const t = await coursesForBatchTerm(tx, b.batchId);
  const courses = t?.courses ?? [];
  const compulsory = courses
    .filter((c) => !(CHOSEN_KINDS as readonly string[]).includes(c.kind))
    .map((c) => c.courseId);
  const approved = await approvedCourses(tx, b.batchId, b.currentTerm);
  const takers = b.students.map((s) => ({
    studentId: s.personId,
    courseIds: approved.get(s.personId) ?? compulsory,
  }));
  return { courses, takers };
}

async function marksOf(tx: Tx, batchId: string, termNumber: number): Promise<Map<string, Mark>> {
  const rows = await tx.execute<{
    courseId: string;
    studentId: string;
    cie: string | null;
    see: string | null;
    absent: boolean;
  }>(sql`
    select course_id::text as "courseId", student_person_id::text as "studentId", cie::text, see::text, absent
    from exam_mark where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${termNumber}`);
  return new Map(
    rows.map((r) => [
      `${r.courseId}:${r.studentId}`,
      {
        cie: r.cie === null ? null : Number(r.cie),
        see: r.see === null ? null : Number(r.see),
        absent: r.absent,
      },
    ]),
  );
}

async function locksOf(tx: Tx, batchId: string, termNumber: number): Promise<Set<string>> {
  const rows = await tx.execute<{ id: string }>(sql`
    select course_id::text as id from exam_course_lock
    where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${termNumber}`);
  return new Set(rows.map((r) => r.id));
}

/**
 * A batch's published terms as they stand now: the frozen grades with approved re-exam outcomes
 * applied (domain `withReexams`). Grade cards, CGPA and the ABC file all read this.
 */
export async function effectiveTerms(tx: Tx, batchId: string) {
  const results = await tx.execute<{
    id: string;
    term: number;
    publishedAt: string;
    decidedOn: string;
  }>(sql`
    select id::text, term_number as term, decided_at::text as "publishedAt",
      to_char(decided_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "decidedOn"
    from exam_result where org_id = app_current_org() and batch_id = ${batchId} and state = 'published'
    order by term_number`);
  const terms = [];
  for (const r of results) terms.push({ term: r.term, students: await frozen(tx, r.id) });
  const outcomes = (
    await tx.execute<{
      term: number;
      studentId: string;
      courseId: string;
      see: string | null;
      absent: boolean;
      total: string;
      grade: string;
      point: string;
      passed: boolean;
    }>(sql`
      select distinct on (x.result_id, x.student_person_id, x.course_id) r.term_number as term,
        x.student_person_id::text as "studentId", x.course_id::text as "courseId", x.see::text, x.absent,
        x.total::text, x.grade, x.point::text, x.passed
      from exam_reexam x join exam_result r on r.org_id = x.org_id and r.id = x.result_id
      where x.org_id = app_current_org() and r.batch_id = ${batchId} and x.state = 'approved'
      order by x.result_id, x.student_person_id, x.course_id, x.decided_at desc`)
  ).map((o) => ({
    ...o,
    see: o.see === null ? null : Number(o.see),
    total: Number(o.total),
    point: Number(o.point),
  }));
  const applied = withReexams(terms, outcomes);
  return results.map((r) => ({
    ...r,
    students: applied.find((t) => t.term === r.term)?.students ?? [],
  }));
}

export type TermMarks = {
  /** The term's results are published (attainment is worked out from published terms only). */
  published: boolean;
  cieMax: number;
  courses: Map<
    string,
    {
      studentId: string;
      cie: number | null;
      see: number | null;
      absent: boolean;
      scores: (number | null)[];
    }[]
  >;
};

/**
 * A term's first-attempt marks per course (internal, component scores, end exam), for OBE
 * attainment. Call inside the tenant, after the caller's own permission check.
 */
export async function termMarks(tx: Tx, batchId: string, termNumber: number): Promise<TermMarks> {
  const [r] = await tx.execute<{ cie: string | null }>(sql`
    select grading ->> 'ciePercent' as cie from exam_result where org_id = app_current_org()
      and batch_id = ${batchId} and term_number = ${termNumber} and state = 'published'`);
  const rows = await tx.execute<{
    courseId: string;
    studentId: string;
    cie: string | null;
    see: string | null;
    absent: boolean;
    scores: { position: number; score: string }[] | null;
  }>(sql`
    select m.course_id::text as "courseId", m.student_person_id::text as "studentId", m.cie::text, m.see::text,
      m.absent,
      (select jsonb_agg(jsonb_build_object('position', s.position, 'score', s.score::text)) from exam_cie_score s
        where s.org_id = m.org_id and s.batch_id = m.batch_id and s.term_number = m.term_number
          and s.course_id = m.course_id and s.student_person_id = m.student_person_id) as scores
    from exam_mark m where m.org_id = app_current_org() and m.batch_id = ${batchId} and m.term_number = ${termNumber}`);
  const courses: TermMarks['courses'] = new Map();
  for (const x of rows) {
    const scores: (number | null)[] = [];
    for (const s of x.scores ?? []) scores[s.position] = Number(s.score);
    courses.set(x.courseId, [
      ...(courses.get(x.courseId) ?? []),
      {
        studentId: x.studentId,
        cie: x.cie === null ? null : Number(x.cie),
        see: x.see === null ? null : Number(x.see),
        absent: x.absent,
        scores: Array.from(scores, (v) => v ?? null),
      },
    ]);
  }
  return { published: !!r, cieMax: r?.cie == null ? 40 : Number(r.cie), courses };
}

/** Earlier published terms' credits and points per student (after re-exams), for CGPA. */
async function earlierOf(tx: Tx, batchId: string, termNumber: number) {
  const out = new Map<string, { credits: number; point: number }[]>();
  for (const t of await effectiveTerms(tx, batchId)) {
    if (t.term >= termNumber) continue;
    for (const s of t.students)
      out.set(s.studentId, [
        ...(out.get(s.studentId) ?? []),
        ...s.courses.map((c) => ({ credits: c.credits, point: c.point })),
      ]);
  }
  return out;
}

const courseInfo = (cs: CurriculumCourse[]) =>
  new Map(
    cs.map((c) => [
      c.courseId,
      { courseId: c.courseId, code: c.code, title: c.title, credits: c.credits },
    ]),
  );

// ---------------------------------------------------------------------------------------------
// The board and marks
// ---------------------------------------------------------------------------------------------

export type ExamBoard = {
  batch: { id: string; name: string; term: number; termKind: string };
  grading: GradingRules;
  courses: {
    courseId: string;
    code: string;
    title: string;
    kind: string;
    credits: number;
    students: number;
    entered: number;
    locked: boolean;
  }[];
  result: {
    id: string;
    state: 'pending' | 'published' | 'rejected';
    decisionNote: string | null;
    approval: ApprovalState | null;
  } | null;
  /** Every student's results: worked out live until sent, then the frozen ones. */
  students: (StudentResult & { name: string; registerNumber: string | null })[];
  /** All courses locked, so results can be sent for approval. */
  ready: boolean;
  /** Terms with published results, for the ABC and NAD credit file. */
  publishedTerms: number[];
};

export async function examBoard(deps: ExamDeps, actor: Actor, batchId: string): Promise<ExamBoard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    // Anyone who reads the academic structure sees the board (an approver named in the designer may
    // hold no exams permission); marks and actions are checked on their own.
    const b = await batchAt(deps, tx, actor, batchId, [
      MANAGE,
      PUBLISH,
      MARKS,
      'academics.structure.read',
    ]);
    const { courses, takers } = await term(tx, b);
    const marks = await marksOf(tx, batchId, b.currentTerm);
    const locks = await locksOf(tx, batchId, b.currentTerm);
    const grading = await gradingAt(tx, b.institutionId, await today(tx));
    const [r] = await tx.execute<{
      id: string;
      state: 'pending' | 'published' | 'rejected';
      decisionNote: string | null;
    }>(sql`
      select id::text, state, decision_note as "decisionNote" from exam_result
      where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${b.currentTerm}
      order by requested_at desc limit 1`);
    const live = r && r.state !== 'rejected' ? r : null;
    const students = live
      ? await frozen(tx, live.id)
      : termResults({
          students: takers,
          courses: courseInfo(courses),
          marks,
          grading,
          earlier: await earlierOf(tx, batchId, b.currentTerm),
        });
    const names = await displayNames(
      tx,
      b.students.map((s) => s.personId),
    );
    const reg = new Map(b.students.map((s) => [s.personId, s.registerNumber]));
    const approvals = r ? await approvalStates(tx, deps.permissions, actor, PROCESS, [r.id]) : {};
    return {
      batch: {
        id: b.batchId,
        name: `${b.programCode} ${b.label}`,
        term: b.currentTerm,
        termKind: b.termKind,
      },
      grading,
      courses: courses.map((c) => {
        const who = takers.filter((t) => t.courseIds.includes(c.courseId));
        return {
          courseId: c.courseId,
          code: c.code,
          title: c.title,
          kind: c.kind,
          credits: c.credits,
          students: who.length,
          entered: who.filter((t) => complete(marks.get(`${c.courseId}:${t.studentId}`))).length,
          locked: locks.has(c.courseId),
        };
      }),
      result: r ? { ...r, approval: approvals[r.id] ?? null } : null,
      students: students
        .map((s) => ({
          ...s,
          name: names[s.studentId] ?? '',
          registerNumber: reg.get(s.studentId) ?? null,
        }))
        .sort(
          (a, c) =>
            (a.registerNumber ?? '').localeCompare(c.registerNumber ?? '') ||
            a.name.localeCompare(c.name),
        ),
      ready: courses.length > 0 && courses.every((c) => locks.has(c.courseId)),
      publishedTerms: (
        await tx.execute<{ term: number }>(sql`
          select term_number as term from exam_result where org_id = app_current_org()
            and batch_id = ${batchId} and state = 'published' order by term_number`)
      ).map((x) => x.term),
    };
  });
}

async function frozen(tx: Tx, resultId: string): Promise<StudentResult[]> {
  const grades = await tx.execute<{
    studentId: string;
    courseId: string;
    code: string;
    title: string;
    credits: string;
    cie: string | null;
    see: string | null;
    absent: boolean;
    total: string;
    grade: string;
    point: string;
  }>(sql`
    select g.student_person_id::text as "studentId", g.course_id::text as "courseId", c.code, c.title,
      g.credits::text, g.cie::text, g.see::text, g.absent, g.total::text, g.grade, g.point::text
    from exam_grade g join academic_course c on c.org_id = g.org_id and c.id = g.course_id
    where g.org_id = app_current_org() and g.result_id = ${resultId}
    order by c.code`);
  const gpas = await tx.execute<{
    studentId: string;
    credits: string;
    earned: string;
    sgpa: string | null;
    cgpa: string | null;
  }>(sql`
    select student_person_id::text as "studentId", credits::text, credits_earned::text as earned,
      sgpa::text, cgpa::text
    from exam_gpa where org_id = app_current_org() and result_id = ${resultId}`);
  return gpas.map((g) => ({
    studentId: g.studentId,
    courses: grades
      .filter((x) => x.studentId === g.studentId)
      .map((x) => ({
        courseId: x.courseId,
        code: x.code,
        title: x.title,
        credits: Number(x.credits),
        cie: x.cie === null ? null : Number(x.cie),
        see: x.see === null ? null : Number(x.see),
        absent: x.absent,
        total: Number(x.total),
        grade: x.grade,
        point: Number(x.point),
        passed: Number(x.point) > 0,
      })),
    credits: Number(g.credits),
    creditsEarned: Number(g.earned),
    sgpa: g.sgpa === null ? null : Number(g.sgpa),
    cgpa: g.cgpa === null ? null : Number(g.cgpa),
  }));
}

export type MarksSheet = {
  course: { courseId: string; code: string; title: string; credits: number };
  /** The course's internal assessment components; the internal mark is worked out from them. */
  components: CieComponent[] | null;
  cieMax: number;
  seeMax: number;
  locked: boolean;
  rows: {
    personId: string;
    name: string;
    registerNumber: string | null;
    cie: number | null;
    /** A score per component, in the plan's order, when the course has components. */
    scores: (number | null)[] | null;
    see: number | null;
    absent: boolean;
  }[];
};

/** Component scores of a course's students: student → scores in the plan's order. */
async function scoresOf(
  tx: Tx,
  batchId: string,
  termNumber: number,
  courseId: string,
  size: number,
): Promise<Map<string, (number | null)[]>> {
  const rows = await tx.execute<{ studentId: string; position: number; score: string }>(sql`
    select student_person_id::text as "studentId", position, score::text from exam_cie_score
    where org_id = app_current_org() and batch_id = ${batchId} and term_number = ${termNumber}
      and course_id = ${courseId}`);
  const out = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const list = out.get(r.studentId) ?? Array<number | null>(size).fill(null);
    if (r.position < size) list[r.position] = Number(r.score);
    out.set(r.studentId, list);
  }
  return out;
}

/** One course's marks for the batch's current term, student by student. */
export async function marksSheet(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; courseId: string },
): Promise<MarksSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MARKS, MANAGE]);
    const { courses, takers } = await term(tx, b);
    const c = courses.find((x) => x.courseId === input.courseId);
    if (!c) throw new ExamError('course_not_in_term');
    const grading = await gradingAt(tx, b.institutionId, await today(tx));
    const marks = await marksOf(tx, input.batchId, b.currentTerm);
    const who = takers.filter((t) => t.courseIds.includes(c.courseId)).map((t) => t.studentId);
    const names = await displayNames(tx, who);
    const reg = new Map(b.students.map((s) => [s.personId, s.registerNumber]));
    const plan = c.cieComponents;
    const scores = plan
      ? await scoresOf(tx, input.batchId, b.currentTerm, c.courseId, plan.length)
      : null;
    return {
      course: { courseId: c.courseId, code: c.code, title: c.title, credits: c.credits },
      components: plan,
      cieMax: grading.ciePercent,
      seeMax: 100 - grading.ciePercent,
      locked: (await locksOf(tx, input.batchId, b.currentTerm)).has(c.courseId),
      rows: who
        .map((id) => {
          const m = marks.get(`${c.courseId}:${id}`);
          return {
            personId: id,
            name: names[id] ?? '',
            registerNumber: reg.get(id) ?? null,
            cie: m?.cie ?? null,
            scores: plan ? (scores?.get(id) ?? Array<number | null>(plan.length).fill(null)) : null,
            see: m?.see ?? null,
            absent: m?.absent ?? false,
          };
        })
        .sort(
          (a, z) =>
            (a.registerNumber ?? '').localeCompare(z.registerNumber ?? '') ||
            a.name.localeCompare(z.name),
        ),
    };
  });
}

/** Saves marks for a course (blank stays blank). Refused once the course is locked. */
export async function saveMarks(
  deps: ExamDeps,
  actor: Actor,
  input: {
    batchId: string;
    courseId: string;
    rows: {
      studentId: string;
      cie: number | null;
      see: number | null;
      absent: boolean;
      /** For a course with components: a score per component; the internal mark comes from them. */
      scores?: (number | null)[] | undefined;
    }[];
  },
): Promise<number> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MARKS, MANAGE]);
    const { courses, takers } = await term(tx, b);
    const course = courses.find((c) => c.courseId === input.courseId);
    if (!course) throw new ExamError('course_not_in_term');
    if ((await locksOf(tx, input.batchId, b.currentTerm)).has(input.courseId))
      throw new ExamError('locked');
    const grading = await gradingAt(tx, b.institutionId, await today(tx));
    const seeMax = 100 - grading.ciePercent;
    const plan = course.cieComponents;
    const taking = new Set(
      takers.filter((t) => t.courseIds.includes(input.courseId)).map((t) => t.studentId),
    );
    for (const r of input.rows) {
      if (!taking.has(r.studentId)) throw new ExamError('not_taking');
      // With components, the internal mark is worked out from their scores, never typed.
      if (plan && (r.scores?.length !== plan.length || r.cie !== null))
        throw new ExamError('scores_needed', { components: plan.length });
      if (!plan && r.scores) throw new ExamError('no_components');
      if (
        plan?.some((c, i) => {
          const v = r.scores?.[i];
          return v != null && (v < 0 || v > c.maxMarks);
        })
      )
        throw new ExamError('mark_out_of_range', { components: plan.map((c) => c.maxMarks) });
      const cie = plan ? cieFrom(plan, r.scores ?? [], grading.ciePercent) : r.cie;
      if (
        (cie !== null && (cie < 0 || cie > grading.ciePercent)) ||
        (r.see !== null && (r.see < 0 || r.see > seeMax))
      )
        throw new ExamError('mark_out_of_range', { cieMax: grading.ciePercent, seeMax });
      await tx.execute(sql`
        insert into exam_mark (org_id, batch_id, term_number, course_id, student_person_id, cie, see, absent,
          entered_by_person_id)
        values (app_current_org(), ${input.batchId}, ${b.currentTerm}, ${input.courseId}, ${r.studentId},
          ${cie}, ${r.absent ? null : r.see}, ${r.absent}, ${actor.personId})
        on conflict (org_id, batch_id, term_number, course_id, student_person_id) do update set
          cie = excluded.cie, see = excluded.see, absent = excluded.absent,
          entered_by_person_id = excluded.entered_by_person_id, updated_at = now()`);
      if (plan) {
        await tx.execute(sql`
          delete from exam_cie_score where org_id = app_current_org() and batch_id = ${input.batchId}
            and term_number = ${b.currentTerm} and course_id = ${input.courseId} and student_person_id = ${r.studentId}`);
        for (const [i, v] of (r.scores ?? []).entries())
          if (v !== null)
            await tx.execute(sql`
              insert into exam_cie_score (org_id, batch_id, term_number, course_id, student_person_id, position, score)
              values (app_current_org(), ${input.batchId}, ${b.currentTerm}, ${input.courseId}, ${r.studentId}, ${i}, ${v})`);
      }
    }
    return finish(tx, actor, {
      result: input.rows.length,
      audit: {
        action: 'academics.exam.marks',
        entityType: 'academic_course',
        entityId: input.courseId,
        dataClass: 'personal',
        detail: { batchId: input.batchId, term: b.currentTerm, rows: input.rows.length },
      },
    });
  });
}

/** Submits a course's marks (every student complete) or reopens them; the exam controller's. */
export async function setCourseLock(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; courseId: string; locked: boolean },
): Promise<void> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MANAGE]);
    const { courses, takers } = await term(tx, b);
    if (!courses.some((c) => c.courseId === input.courseId))
      throw new ExamError('course_not_in_term');
    const [live] = await tx.execute(sql`
      select 1 from exam_result where org_id = app_current_org() and batch_id = ${input.batchId}
        and term_number = ${b.currentTerm} and state <> 'rejected'`);
    if (live) throw new ExamError('result_exists');
    if (input.locked) {
      const marks = await marksOf(tx, input.batchId, b.currentTerm);
      const missing = takers.filter(
        (t) =>
          t.courseIds.includes(input.courseId) &&
          !complete(marks.get(`${input.courseId}:${t.studentId}`)),
      ).length;
      if (missing) throw new ExamError('marks_incomplete', { missing });
      await tx.execute(sql`
        insert into exam_course_lock (org_id, batch_id, term_number, course_id, locked_by_person_id)
        values (app_current_org(), ${input.batchId}, ${b.currentTerm}, ${input.courseId}, ${actor.personId})
        on conflict do nothing`);
    } else
      await tx.execute(sql`
        delete from exam_course_lock where org_id = app_current_org() and batch_id = ${input.batchId}
          and term_number = ${b.currentTerm} and course_id = ${input.courseId}`);
    return finish(tx, actor, {
      result: undefined,
      audit: {
        action: input.locked ? 'academics.exam.lock' : 'academics.exam.unlock',
        entityType: 'academic_course',
        entityId: input.courseId,
        dataClass: 'operational',
        detail: { batchId: input.batchId, term: b.currentTerm },
      },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/**
 * Freezes the term's results (every course locked) and sends them for approval in the workflow
 * engine. Nothing is visible to students until an approver who didn't send them publishes them.
 */
export async function sendResults(deps: ExamDeps, actor: Actor, batchId: string): Promise<string> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, batchId, [MANAGE]);
    const { courses, takers } = await term(tx, b);
    const locks = await locksOf(tx, batchId, b.currentTerm);
    if (courses.length === 0 || !courses.every((c) => locks.has(c.courseId)))
      throw new ExamError('not_all_locked');
    const grading = await gradingAt(tx, b.institutionId, await today(tx));
    const results = termResults({
      students: takers,
      courses: courseInfo(courses),
      marks: await marksOf(tx, batchId, b.currentTerm),
      grading,
      earlier: await earlierOf(tx, batchId, b.currentTerm),
    });
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into exam_result (org_id, batch_id, term_number, grading, requested_by_person_id)
      values (app_current_org(), ${batchId}, ${b.currentTerm}, ${JSON.stringify(grading)}::jsonb, ${actor.personId})
      on conflict do nothing
      returning id::text`);
    if (!row) throw new ExamError('result_exists');
    for (const s of results) {
      for (const c of s.courses)
        await tx.execute(sql`
          insert into exam_grade (org_id, result_id, student_person_id, course_id, credits, cie, see, absent, total,
            grade, point)
          values (app_current_org(), ${row.id}, ${s.studentId}, ${c.courseId}, ${c.credits}, ${c.cie}, ${c.see},
            ${c.absent}, ${c.total}, ${c.grade}, ${c.point})`);
      await tx.execute(sql`
        insert into exam_gpa (org_id, result_id, student_person_id, credits, credits_earned, sgpa, cgpa)
        values (app_current_org(), ${row.id}, ${s.studentId}, ${s.credits}, ${s.creditsEarned}, ${s.sgpa}, ${s.cgpa})`);
    }
    await startApproval(tx, {
      process: PROCESS,
      subjectId: row.id,
      institutionId: b.institutionId,
      amountPaise: null,
      summary: `Results: ${b.programCode} ${b.label}, term ${b.currentTerm} (${results.length} students)`,
      requestedBy: actor.personId,
    });
    return finish(tx, actor, {
      result: row.id,
      audit: {
        action: 'academics.results.send',
        entityType: 'exam_result',
        entityId: row.id,
        dataClass: 'personal',
        detail: { batchId, term: b.currentTerm, students: results.length },
      },
    });
  });
}

/** Publishes or sends back a term's results through the workflow engine. */
export async function decideResults(
  deps: ExamDeps,
  actor: Actor,
  input: { resultId: string; approve: boolean; note: string | null },
): Promise<'published' | 'rejected' | 'pending'> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ batchId: string; term: number; state: string }>(sql`
      select batch_id::text as "batchId", term_number as term, state from exam_result
      where org_id = app_current_org() and id = ${input.resultId} for update`);
    if (!r) throw new ExamError('result_not_found');
    // Who may decide each step is the approval designer's; here only that they can see the batch.
    await batchAt(deps, tx, actor, r.batchId, [PUBLISH, MANAGE, MARKS, 'academics.structure.read']);
    if (r.state !== 'pending') throw new ExamError('already_decided');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: input.resultId,
      approve: input.approve,
      note: input.note,
    });
    if (outcome === 'pending') return 'pending';
    const state = outcome === 'approved' ? 'published' : 'rejected';
    await tx.execute(sql`
      update exam_result set state = ${state}, decided_at = now(), decision_note = ${input.note?.trim() || null}
      where org_id = app_current_org() and id = ${input.resultId}`);
    return finish(tx, actor, {
      result: state,
      audit: {
        action: `academics.results.${state === 'published' ? 'publish' : 'reject'}`,
        entityType: 'exam_result',
        entityId: input.resultId,
        dataClass: 'personal',
        detail: { batchId: r.batchId, term: r.term },
      },
      events:
        state === 'published'
          ? [
              {
                type: RESULTS_PUBLISHED,
                payload: { resultId: input.resultId, batchId: r.batchId, term: r.term },
              },
            ]
          : [],
    });
  });
}

export type GradeCard = {
  name: string;
  registerNumber: string | null;
  batch: string;
  terms: {
    term: number;
    publishedAt: string;
    courses: StudentResult['courses'];
    credits: number;
    creditsEarned: number;
    sgpa: number | null;
    cgpa: number | null;
  }[];
};

/** A student's published results, term by term: the grade card and transcript in one. */
export async function gradeCard(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; studentId: string },
): Promise<GradeCard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(
      deps,
      tx,
      actor,
      input.batchId,
      ['academics.structure.read', MANAGE],
      input.studentId,
    );
    const terms: GradeCard['terms'] = [];
    for (const r of await effectiveTerms(tx, input.batchId)) {
      const st = r.students.find((x) => x.studentId === input.studentId);
      if (st) terms.push({ term: r.term, publishedAt: r.publishedAt, ...st });
    }
    const name = (await displayNames(tx, [input.studentId]))[input.studentId] ?? '';
    return {
      name,
      registerNumber:
        b.students.find((x) => x.personId === input.studentId)?.registerNumber ?? null,
      batch: `${b.programCode} ${b.label}`,
      terms,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// ABC and NAD (rule book §15: "credit and marksheet upload against APAAR"; P0 item 15)
// ---------------------------------------------------------------------------------------------

/** The credit file's columns: one row per student per course of a published term. */
export const ABC_COLUMNS = [
  'ABC ID',
  'APAAR ID',
  'Register number',
  'Name',
  'Date of birth',
  'Gender',
  'Programme',
  'Batch',
  'Term',
  'Course code',
  'Course title',
  'Credits',
  'Grade',
  'Grade point',
  'Result',
  'SGPA',
  'CGPA',
  'Result date',
];
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export type AbcCreditFile = {
  term: number;
  csv: string;
  students: number;
  rows: number;
  /** Students without an ABC ID: their credits can't be uploaded until it is on their record. */
  withoutAbc: { personId: string; name: string }[];
};

/**
 * A published term's credits for upload to the Academic Bank of Credits and NAD: full ABC and
 * APAAR IDs (people.student.reveal), recorded as a restricted export. A working file in the
 * portal's terms; check the columns against the current NAD template before uploading.
 */
export async function abcCreditFile(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; term: number },
): Promise<AbcCreditFile> {
  if (!deps.keys) throw new Error('abcCreditFile: field keys missing');
  const keys = deps.keys;
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MANAGE]);
    const place = await placeOf(tx, b.institutionId);
    await deps.permissions.assertCan(tx, actor, 'people.student.reveal', {
      orgId: actor.orgId,
      ...(place ? { place } : {}),
    });
    const r = (await effectiveTerms(tx, input.batchId)).find((x) => x.term === input.term);
    if (!r) throw new ExamError('not_published');
    const results = r.students;
    const ids = await learnerIdsForExport(
      tx,
      keys,
      actor.orgId,
      results.map((s) => s.studentId),
    );
    const facts = new Map(
      (
        await studentFactsFor(
          tx,
          results.map((s) => s.studentId),
        )
      ).map((f) => [f.personId, f]),
    );
    const reg = new Map(b.students.map((s) => [s.personId, s.registerNumber]));
    const lines: string[] = [ABC_COLUMNS.join(',')];
    const withoutAbc: AbcCreditFile['withoutAbc'] = [];
    for (const s of results) {
      const f = facts.get(s.studentId);
      const id = ids[s.studentId];
      if (!id?.abc) withoutAbc.push({ personId: s.studentId, name: f?.name ?? '' });
      for (const c of s.courses)
        lines.push(
          [
            id?.abc ?? '',
            id?.apaar ?? '',
            reg.get(s.studentId) ?? '',
            f?.name ?? '',
            f?.dateOfBirth ?? '',
            f?.gender ?? '',
            b.programCode,
            b.label,
            String(input.term),
            c.code,
            c.title,
            String(c.credits),
            c.grade,
            String(c.point),
            c.passed ? 'PASS' : 'FAIL',
            s.sgpa === null ? '' : s.sgpa.toFixed(2),
            s.cgpa === null ? '' : s.cgpa.toFixed(2),
            r.decidedOn,
          ]
            .map(csvCell)
            .join(','),
        );
    }
    await writeAudit(tx, actor, {
      action: 'academics.results.abc_export',
      entityType: 'exam_result',
      entityId: r.id,
      dataClass: 'restricted',
      detail: {
        batchId: input.batchId,
        term: input.term,
        students: results.length,
        rows: lines.length - 1,
      },
    });
    return {
      term: input.term,
      csv: lines.join('\n'),
      students: results.length,
      rows: lines.length - 1,
      withoutAbc,
    };
  });
}
