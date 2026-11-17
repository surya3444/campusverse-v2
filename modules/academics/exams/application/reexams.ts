// Academics › Exams & Results › Re-exams (rule book §13.2: "revaluation, supplementary"; P0 item
// 12). The exam office registers a re-exam on a published course grade; the new end-exam mark is
// entered and graded on the term's frozen scale; the new grade is approved through the workflow
// engine (results are a sensitive action, §14.4) and then counts everywhere the grade is read.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import type { Actor } from '@campusverse/platform-permissions';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import type { GradingRules } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import { reexamGrade, type ReexamKind } from '../domain/reexam.js';
import {
  batchAt,
  effectiveTerms,
  ExamError,
  finish,
  MANAGE,
  MARKS,
  PUBLISH,
  type ExamDeps,
} from './exams.js';

const PROCESS = 'academics.reexam' as const;
export const REEXAM_APPROVED = 'academics.reexam.approved.v1';

type Row = {
  id: string;
  resultId: string;
  batchId: string;
  term: number;
  studentId: string;
  courseId: string;
  kind: ReexamKind;
  state: 'requested' | 'marked' | 'approved' | 'rejected';
  grading: GradingRules;
};

async function load(tx: Tx, id: string): Promise<Row> {
  const [r] = await tx.execute<Row>(sql`
    select x.id::text, x.result_id::text as "resultId", r.batch_id::text as "batchId", r.term_number as term,
      x.student_person_id::text as "studentId", x.course_id::text as "courseId", x.kind, x.state, r.grading
    from exam_reexam x join exam_result r on r.org_id = x.org_id and r.id = x.result_id
    where x.org_id = app_current_org() and x.id = ${id} for update of x`);
  if (!r) throw new ExamError('reexam_not_found');
  return r;
}

/** The course's grade as it stands now (after any approved re-exam). */
async function current(tx: Tx, batchId: string, term: number, studentId: string, courseId: string) {
  const t = (await effectiveTerms(tx, batchId)).find((x) => x.term === term);
  const c = t?.students
    .find((s) => s.studentId === studentId)
    ?.courses.find((x) => x.courseId === courseId);
  return t && c ? { resultId: t.id, ...c } : null;
}

/**
 * Registers a re-exam on a published grade: supplementary for a failed course, revaluation for
 * one with an end-exam script (not absent). One open re-exam per course at a time.
 */
export async function requestReexam(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; term: number; studentId: string; courseId: string; kind: ReexamKind },
): Promise<string> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await batchAt(deps, tx, actor, input.batchId, [MANAGE]);
    const c = await current(tx, input.batchId, input.term, input.studentId, input.courseId);
    if (!c) throw new ExamError('not_published');
    if (input.kind === 'supplementary' ? c.passed : c.absent || c.see === null)
      throw new ExamError('reexam_not_allowed');
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into exam_reexam (org_id, result_id, student_person_id, course_id, kind, old_see, old_total, old_grade,
        old_point, requested_by_person_id)
      values (app_current_org(), ${c.resultId}, ${input.studentId}, ${input.courseId}, ${input.kind}, ${c.see},
        ${c.total}, ${c.grade}, ${c.point}, ${actor.personId})
      on conflict do nothing returning id::text`);
    if (!row) throw new ExamError('reexam_open');
    return finish(tx, actor, {
      result: row.id,
      audit: {
        action: 'academics.reexam.request',
        entityType: 'person',
        entityId: input.studentId,
        dataClass: 'personal',
        detail: {
          reexamId: row.id,
          kind: input.kind,
          term: input.term,
          course: c.code,
          grade: c.grade,
        },
      },
    });
  });
}

/**
 * Enters the re-exam's end-exam mark (or absent), grades it on the term's frozen scale and sends
 * the new grade for approval. Entered again while waiting, it replaces the mark and restarts approval.
 */
export async function markReexam(
  deps: ExamDeps,
  actor: Actor,
  input: { reexamId: string; see: number | null; absent: boolean },
): Promise<{ grade: string; changed: boolean }> {
  if (input.absent ? input.see !== null : input.see === null)
    throw new ExamError('mark_out_of_range');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await load(tx, input.reexamId);
    const b = await batchAt(deps, tx, actor, r.batchId, [MARKS, MANAGE]);
    if (r.state !== 'requested' && r.state !== 'marked') throw new ExamError('reexam_state');
    const seeMax = 100 - r.grading.ciePercent;
    if (
      input.see !== null &&
      (input.see < 0 || input.see > seeMax || Math.round(input.see * 4) !== input.see * 4)
    )
      throw new ExamError('mark_out_of_range', { max: seeMax });
    const c = await current(tx, r.batchId, r.term, r.studentId, r.courseId);
    if (!c) throw new ExamError('not_published');
    const g = reexamGrade(r.grading, r.kind, c, { see: input.see, absent: input.absent });
    await tx.execute(sql`
      update exam_reexam set state = 'marked', see = ${g.see}, absent = ${g.absent}, total = ${g.total},
        grade = ${g.grade}, point = ${g.point}, passed = ${g.passed}, marked_by_person_id = ${actor.personId},
        marked_at = now()
      where org_id = app_current_org() and id = ${r.id}`);
    const name = (await displayNames(tx, [r.studentId]))[r.studentId] ?? '';
    await startApproval(tx, {
      process: PROCESS,
      subjectId: r.id,
      institutionId: b.institutionId,
      amountPaise: null,
      summary: `${r.kind === 'revaluation' ? 'Revaluation' : 'Supplementary'}: ${name} · ${c.code} · ${c.grade} → ${g.grade}`,
      requestedBy: actor.personId,
    });
    return finish(tx, actor, {
      result: { grade: g.grade, changed: g.grade !== c.grade || g.total !== c.total },
      audit: {
        action: 'academics.reexam.mark',
        entityType: 'person',
        entityId: r.studentId,
        dataClass: 'personal',
        detail: { reexamId: r.id, course: c.code, from: c.grade, to: g.grade, total: g.total },
      },
    });
  });
}

/** Approves (the new grade counts from now) or sends back a marked re-exam through the workflow engine. */
export async function decideReexam(
  deps: ExamDeps,
  actor: Actor,
  input: { reexamId: string; approve: boolean; note: string | null },
): Promise<'approved' | 'rejected' | 'pending'> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await load(tx, input.reexamId);
    await batchAt(deps, tx, actor, r.batchId, [PUBLISH, MANAGE, MARKS, 'academics.structure.read']);
    if (r.state !== 'marked') throw new ExamError('reexam_state');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: r.id,
      approve: input.approve,
      note: input.note,
    });
    if (outcome === 'pending') return 'pending';
    await tx.execute(sql`
      update exam_reexam set state = ${outcome}, decided_at = now(), decision_note = ${input.note?.trim() || null}
      where org_id = app_current_org() and id = ${r.id}`);
    return finish(tx, actor, {
      result: outcome,
      audit: {
        action: `academics.reexam.${outcome === 'approved' ? 'approve' : 'reject'}`,
        entityType: 'person',
        entityId: r.studentId,
        dataClass: 'personal',
        detail: { reexamId: r.id, kind: r.kind, term: r.term },
      },
      events:
        outcome === 'approved'
          ? [
              {
                type: REEXAM_APPROVED,
                payload: { reexamId: r.id, batchId: r.batchId, term: r.term },
              },
            ]
          : [],
    });
  });
}

export type ReexamItem = {
  id: string;
  term: number;
  studentId: string;
  name: string;
  courseId: string;
  code: string;
  title: string;
  kind: ReexamKind;
  state: 'requested' | 'marked' | 'approved' | 'rejected';
  oldGrade: string;
  grade: string | null;
  total: number | null;
  absent: boolean | null;
  decisionNote: string | null;
  approval: ApprovalState | null;
};

export type ReexamBoard = {
  /** Most recent first. */
  reexams: ReexamItem[];
  /** Published courses not passed (as they stand now), with no re-exam open: the supplementary list. */
  failed: {
    term: number;
    studentId: string;
    name: string;
    courseId: string;
    code: string;
    title: string;
    grade: string;
  }[];
  /** The end exam's maximum on the scale (the internal share is the rest of 100). */
  seeMax: number | null;
};

/** A batch's re-exams and the courses still failed, for the exam office. */
export async function reexamBoard(
  deps: ExamDeps,
  actor: Actor,
  batchId: string,
): Promise<ReexamBoard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await batchAt(deps, tx, actor, batchId, [MANAGE, PUBLISH, MARKS, 'academics.structure.read']);
    const rows = await tx.execute<
      Omit<ReexamItem, 'name' | 'approval' | 'total'> & { total: string | null }
    >(sql`
      select x.id::text, r.term_number as term, x.student_person_id::text as "studentId",
        x.course_id::text as "courseId", c.code, c.title, x.kind, x.state, x.old_grade as "oldGrade", x.grade,
        x.total::text, x.absent, x.decision_note as "decisionNote"
      from exam_reexam x join exam_result r on r.org_id = x.org_id and r.id = x.result_id
      join academic_course c on c.org_id = x.org_id and c.id = x.course_id
      where x.org_id = app_current_org() and r.batch_id = ${batchId}
      order by x.requested_at desc limit 300`);
    const terms = await effectiveTerms(tx, batchId);
    const open = new Set(
      rows
        .filter((x) => x.state === 'requested' || x.state === 'marked')
        .map((x) => `${x.term}:${x.studentId}:${x.courseId}`),
    );
    const failed = terms.flatMap((t) =>
      t.students.flatMap((s) =>
        s.courses
          .filter((c) => !c.passed && !open.has(`${t.term}:${s.studentId}:${c.courseId}`))
          .map((c) => ({
            term: t.term,
            studentId: s.studentId,
            courseId: c.courseId,
            code: c.code,
            title: c.title,
            grade: c.grade,
          })),
      ),
    );
    const names = await displayNames(tx, [
      ...new Set([...rows.map((x) => x.studentId), ...failed.map((f) => f.studentId)]),
    ]);
    const approvals = await approvalStates(
      tx,
      deps.permissions,
      actor,
      PROCESS,
      rows.filter((x) => x.state === 'marked').map((x) => x.id),
    );
    const [g] = await tx.execute<{ cie: string | null }>(sql`
      select grading ->> 'ciePercent' as cie from exam_result
      where org_id = app_current_org() and batch_id = ${batchId} and state = 'published'
      order by term_number desc limit 1`);
    return {
      reexams: rows.map((x) => ({
        ...x,
        total: x.total === null ? null : Number(x.total),
        name: names[x.studentId] ?? '',
        approval: approvals[x.id] ?? null,
      })),
      failed: failed.map((f) => ({ ...f, name: names[f.studentId] ?? '' })),
      seeMax: g?.cie == null ? null : 100 - Number(g.cie),
    };
  });
}
