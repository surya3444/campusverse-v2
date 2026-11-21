// The year's final result (owner's brief, 21 Nov 2026; rule book §13 Exams & Results › Results:
// "CBSE … grades; publish with approval"): published exams combined with weights (Periodic test
// 10%, Half-yearly 30%, Annual 60%) into each subject's year percentage, graded by the board's
// scheme, previewed, then published as the year's report card. Final results are frozen.
import { withTenant, type Tx } from '@campusverse/db';
import { studentFacts } from '@campusverse/people-records';
import { issueDocumentIn } from '@campusverse/platform-documents';
import { command, emit } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { gradeFor } from '@campusverse/rules';
import { attendanceFigures } from '@campusverse/school-attendance';
import { enrolmentFacts } from '@campusverse/school-enrolment';
import { classInfo, sectionsOn, yearsOf } from '@campusverse/school-setup';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { finalResult, type FinalSubject } from '../domain/results.js';
import {
  ExamError,
  gradesFor,
  place,
  schemeAt,
  today,
  type ExamDeps,
  type ExamRow,
} from './exams.js';

export const FINAL_PUBLISHED = 'school.exam.final_published.v1';

export type ResultPlanInput = {
  id?: string | null | undefined;
  institutionId: string;
  yearId: string;
  name: string;
  classIds: string[];
  exams: { examId: string; weightBp: number }[];
};

export type ResultPlanSummary = {
  id: string;
  institutionId: string;
  name: string;
  yearId: string;
  yearLabel: string;
  state: 'draft' | 'published';
  classIds: string[];
  exams: { examId: string; name: string; weightBp: number; state: string }[];
  publishedAt: string | null;
};

const pct = (bp: number | null) =>
  bp === null ? '—' : `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;

async function plans(tx: Tx, where: ReturnType<typeof sql>): Promise<ResultPlanSummary[]> {
  const rows = await tx.execute<Omit<ResultPlanSummary, 'exams'>>(sql`
    select p.id::text, p.institution_id::text as "institutionId", p.name, p.year_id::text as "yearId", y.label as "yearLabel", p.state,
      p.class_ids::text[] as "classIds", p.published_at::text as "publishedAt"
    from school_result_plan p join school_year y on y.org_id = p.org_id and y.id = p.year_id
    where p.org_id = app_current_org() and ${where} order by p.created_at desc`);
  const exams = await tx.execute<{
    planId: string;
    examId: string;
    name: string;
    weightBp: number;
    state: string;
  }>(sql`
    select x.plan_id::text as "planId", x.exam_id::text as "examId", e.name, x.weight_bp as "weightBp", e.state
    from school_result_plan_exam x join school_exam e on e.org_id = x.org_id and e.id = x.exam_id
    where x.org_id = app_current_org() and x.plan_id = any(${`{${rows.map((r) => r.id).join(',')}}`}::uuid[])
    order by x.seq`);
  return rows.map((r) => ({
    ...r,
    exams: exams
      .filter((x) => x.planId === r.id)
      .map((x) => ({ examId: x.examId, name: x.name, weightBp: x.weightBp, state: x.state })),
  }));
}

/** An institution's final results, newest first. */
export async function resultPlans(
  deps: ExamDeps,
  actor: Actor,
  institutionId: string,
): Promise<ResultPlanSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    return plans(tx, sql`p.institution_id = ${institutionId}`);
  });
}

/**
 * Saves a draft final result: its classes and the exams that count, with weights adding up to
 * 100%. Each exam must be of the same school and year and cover the classes chosen.
 */
export async function saveResultPlan(
  deps: ExamDeps,
  actor: Actor,
  input: ResultPlanInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new ExamError('bad_name');
  if (input.classIds.length === 0) throw new ExamError('no_classes');
  if (input.exams.length === 0 || input.exams.length > 8) throw new ExamError('bad_weights');
  if (new Set(input.exams.map((x) => x.examId)).size !== input.exams.length)
    throw new ExamError('bad_weights');
  if (input.exams.some((x) => !Number.isInteger(x.weightBp) || x.weightBp < 1))
    throw new ExamError('bad_weights');
  const total = input.exams.reduce((a, x) => a + x.weightBp, 0);
  if (total !== 10_000) throw new ExamError('weights_not_100', { totalBp: total });
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.exam.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const year = (await yearsOf(tx, input.institutionId)).find((y) => y.yearId === input.yearId);
      if (!year) throw new ExamError('year_not_found');
      const exams = await tx.execute<{ id: string; classIds: string[]; state: string }>(sql`
        select id::text, class_ids::text[] as "classIds", state from school_exam
        where org_id = app_current_org() and institution_id = ${input.institutionId} and year_id = ${input.yearId}
          and id = any(${`{${input.exams.map((x) => x.examId).join(',')}}`}::uuid[])`);
      if (exams.length !== input.exams.length) throw new ExamError('exam_not_found');
      for (const x of exams) {
        if (x.state === 'cancelled') throw new ExamError('exam_not_found');
        if (!input.classIds.every((c) => x.classIds.includes(c)))
          throw new ExamError('exam_misses_class');
      }
      let id = input.id ?? '';
      if (id) {
        const [row] = await tx.execute<{ state: string }>(sql`
          select state from school_result_plan where org_id = app_current_org() and id = ${id}
            and institution_id = ${input.institutionId} for update`);
        if (!row) throw new ExamError('plan_not_found');
        if (row.state !== 'draft') throw new ExamError('plan_published');
        await tx.execute(sql`
          update school_result_plan set name = ${name}, year_id = ${input.yearId},
            class_ids = ${`{${input.classIds.join(',')}}`}::uuid[]
          where org_id = app_current_org() and id = ${id}`);
        await tx.execute(sql`
          delete from school_result_plan_exam where org_id = app_current_org() and plan_id = ${id}`);
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into school_result_plan (org_id, institution_id, year_id, name, class_ids, created_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${input.yearId}, ${name},
            ${`{${input.classIds.join(',')}}`}::uuid[], ${actor.personId})
          returning id::text`);
        id = row?.id ?? '';
      }
      for (const [i, x] of input.exams.entries())
        await tx.execute(sql`
          insert into school_result_plan_exam (org_id, plan_id, exam_id, weight_bp, seq)
          values (app_current_org(), ${id}, ${x.examId}, ${x.weightBp}, ${i})`);
      return {
        result: { id },
        audit: {
          action: 'school.exam.manage',
          entityType: 'school_result_plan',
          entityId: id,
          dataClass: 'operational',
          detail: {
            name,
            exams: input.exams.map((x) => `${x.examId}:${x.weightBp}`).join(','),
          },
        },
      };
    },
  );
}

type Row = {
  studentId: string;
  name: string;
  classId: string;
  sectionId: string;
  section: string;
  subjects: FinalSubject[];
  percentBp: number | null;
  grade: string | null;
  /** Subjects below the board's pass mark. */
  below: string[];
};

/** Every student's final result for a plan, from the frozen results of its exams. */
async function compute(tx: Tx, plan: ResultPlanSummary, institutionId: string) {
  const first = plan.exams[0];
  const e: ExamRow = {
    id: first?.examId ?? '',
    institutionId,
    yearId: plan.yearId,
    name: plan.name,
    classIds: plan.classIds,
    state: 'published',
  };
  const year = (await yearsOf(tx, institutionId)).find((y) => y.yearId === plan.yearId);
  const d = await today(tx);
  const on = year && d >= year.ends ? year.starts : d;
  const scheme = await schemeAt(tx, e, on);
  if (!scheme) throw new ExamError('no_grade_scheme');
  const grade = (bp: number) => gradeFor(scheme, bp);
  const results = await tx.execute<{
    examId: string;
    studentId: string;
    name: string;
    classId: string;
    sectionId: string;
    subjects: { subjectId: string; subject: string; percentBp: number | null }[];
  }>(sql`
    select r.exam_id::text as "examId", r.student_person_id::text as "studentId", pe.legal_name as name,
      r.class_id::text as "classId", r.section_id::text as "sectionId", r.subjects
    from school_exam_result r join person pe on pe.org_id = r.org_id and pe.id = r.student_person_id
    where r.org_id = app_current_org()
      and r.exam_id = any(${`{${plan.exams.map((x) => x.examId).join(',')}}`}::uuid[])
      and r.class_id = any(${`{${plan.classIds.join(',')}}`}::uuid[])`);
  const sections = new Map(
    (await sectionsOn(tx, institutionId, on)).map((s) => [s.sectionId, s.label]),
  );
  const students = new Map<string, Row>();
  for (const r of results) {
    if (students.has(r.studentId)) continue;
    const mine = plan.exams.map((x) => ({
      weightBp: x.weightBp,
      subjects:
        results.find((y) => y.examId === x.examId && y.studentId === r.studentId)?.subjects ?? [],
    }));
    // The class and section of their latest exam in the plan.
    const last =
      [...plan.exams]
        .reverse()
        .map((x) => results.find((y) => y.examId === x.examId && y.studentId === r.studentId))
        .find((y) => y !== undefined) ?? r;
    const f = finalResult(mine, grade);
    students.set(r.studentId, {
      studentId: r.studentId,
      name: r.name,
      classId: last.classId,
      sectionId: last.sectionId,
      section: sections.get(last.sectionId) ?? '',
      subjects: f.subjects,
      percentBp: f.percentBp,
      grade: f.percentBp === null ? null : grade(f.percentBp),
      below: f.subjects
        .filter((s) => s.percentBp !== null && s.percentBp < scheme.passBasisPoints)
        .map((s) => s.subject),
    });
  }
  return {
    scheme,
    rows: [...students.values()].sort(
      (a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name),
    ),
  };
}

export type ResultPlanDetail = ResultPlanSummary & {
  classes: { classId: string; name: string }[];
  /** Exams in the plan not published yet: the final result waits for them. */
  waitingFor: string[];
  passBasisPoints: number | null;
  gradeScheme: string | null;
  /** Each student's year result, once every exam is published. */
  students: Omit<Row, 'classId' | 'sectionId'>[] | null;
};

export async function resultPlanDetail(
  deps: ExamDeps,
  actor: Actor,
  planId: string,
): Promise<ResultPlanDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [p] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from school_result_plan
      where org_id = app_current_org() and id = ${planId}`);
    if (!p) throw new ExamError('plan_not_found');
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, p.institutionId),
    });
    const [plan] = await plans(tx, sql`p.id = ${planId}`);
    if (!plan) throw new ExamError('plan_not_found');
    const waitingFor = plan.exams.filter((x) => x.state !== 'published').map((x) => x.name);
    const classes = [];
    for (const classId of plan.classIds)
      classes.push({ classId, name: (await classInfo(tx, classId))?.name ?? '' });
    const computed = waitingFor.length === 0 ? await compute(tx, plan, p.institutionId) : null;
    return {
      ...plan,
      classes,
      waitingFor,
      passBasisPoints: computed?.scheme.passBasisPoints ?? null,
      gradeScheme: computed?.scheme.id ?? null,
      students: computed
        ? computed.rows.map((r) => ({
            studentId: r.studentId,
            name: r.name,
            section: r.section,
            subjects: r.subjects,
            percentBp: r.percentBp,
            grade: r.grade,
            below: r.below,
          }))
        : null,
    };
  });
}

/**
 * Publishes the year's result once every exam in it is published: each student's final result is
 * frozen with the grading scheme, the year's report card is issued (QR-verifiable), and parents
 * are told. The card shows each subject's percentage in every exam, the year percentage and
 * grade, the latest exam's co-scholastic grades and remark, and the year's attendance.
 */
export async function publishResultPlan(
  deps: ExamDeps,
  actor: Actor,
  planId: string,
): Promise<{ results: number }> {
  const institutionId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [p] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from school_result_plan
      where org_id = app_current_org() and id = ${planId}`);
    if (!p) throw new ExamError('plan_not_found');
    return p.institutionId;
  });
  const where = await withTenant(deps.db, actor.orgId, (tx) => place(tx, institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.exam.publish', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [locked] = await tx.execute<{ state: string }>(sql`
        select state from school_result_plan where org_id = app_current_org() and id = ${planId} for update`);
      if (locked?.state !== 'draft') throw new ExamError('plan_published');
      const [plan] = await plans(tx, sql`p.id = ${planId}`);
      if (!plan) throw new ExamError('plan_not_found');
      const waiting = plan.exams.filter((x) => x.state !== 'published').map((x) => x.name);
      if (waiting.length) throw new ExamError('exams_not_published', { exams: waiting.join(', ') });
      const { scheme, rows } = await compute(tx, plan, institutionId);
      if (rows.length === 0) throw new ExamError('no_results');
      const year = (await yearsOf(tx, institutionId)).find((y) => y.yearId === plan.yearId);
      const lastExam = plan.exams.at(-1)?.examId ?? '';
      const short = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}.` : name);
      for (const r of rows) {
        const facts = await studentFacts(tx, r.studentId);
        const enr = await enrolmentFacts(tx, r.studentId, await today(tx));
        const [remark] = await tx.execute<{ remark: string }>(sql`
          select remark from school_exam_remark where org_id = app_current_org() and exam_id = ${lastExam}
            and student_person_id = ${r.studentId}`);
        const att = year
          ? await attendanceFigures(tx, {
              studentId: r.studentId,
              from: year.starts,
              until: year.ends,
            })
          : null;
        const doc = await issueDocumentIn(
          tx,
          deps.store,
          actor,
          { verifyBaseUrl: deps.verifyBaseUrl },
          {
            kind: 'report_card',
            number: `RC/${year?.label ?? ''}/FINAL/${planId.slice(-8)}/${enr?.admissionNumber ?? r.studentId.slice(-8)}`,
            title: `Report card: ${plan.name}`,
            subjectPersonId: r.studentId,
            lines: [
              ['Student', facts?.name ?? r.name],
              ['Class', r.section],
              ['Academic year', year?.label ?? ''],
              ...r.subjects.map((s): [string, string] => [
                s.subject,
                `${plan.exams
                  .map((x, i) => `${short(x.name)} ${pct(s.byExam[i] ?? null)}`)
                  .join(' · ')}  =  ${pct(s.percentBp)} ${s.grade ?? ''}`,
              ]),
              ['Overall', `${pct(r.percentBp)} ${r.grade ?? ''}`],
              ...(await gradesFor(tx, lastExam, r.studentId)),
              ...(att
                ? [
                    [
                      'Attendance',
                      `${Math.floor(att.attendedHalfDays / 2)}${att.attendedHalfDays % 2 ? '.5' : ''} of ${att.workingDays} days`,
                    ] as [string, string],
                  ]
                : []),
              ['Remark', remark?.remark ?? ''],
              [
                'Result',
                r.below.length ? `Below the pass mark in ${r.below.join(', ')}` : 'Passed',
              ],
              [
                'Weights',
                plan.exams.map((x) => `${x.name} ${pct(x.weightBp).replace('.00', '')}`).join(', '),
              ],
              ['Grading', scheme.id],
            ],
          },
        );
        await tx.execute(sql`
          insert into school_final_result (org_id, plan_id, student_person_id, class_id, section_id, subjects,
            percent, grade, grade_scheme, report_document_id)
          values (app_current_org(), ${planId}, ${r.studentId}, ${r.classId}, ${r.sectionId},
            ${JSON.stringify(r.subjects)}::jsonb,
            ${r.percentBp === null ? null : (r.percentBp / 100).toFixed(2)}::numeric, ${r.grade},
            ${scheme.id}, ${doc.id})`);
        await notifyGuardians(tx, {
          studentId: r.studentId,
          flag: 'academic_messages',
          kind: 'notice',
          language: 'en',
          title: `${plan.name}`,
          body: `${(facts?.name ?? r.name).split(' ')[0]}'s report card for ${plan.name} is ready in the app.`,
          dedupeKey: `final-result:${planId}:${r.studentId}`,
        });
      }
      await tx.execute(sql`
        update school_result_plan set state = 'published', grade_scheme = ${scheme.id},
          published_by_person_id = ${actor.personId}, published_at = now()
        where org_id = app_current_org() and id = ${planId}`);
      await emit(tx, { type: FINAL_PUBLISHED, payload: { planId, results: rows.length } });
      return {
        result: { results: rows.length },
        audit: {
          action: 'school.exam.publish',
          entityType: 'school_result_plan',
          entityId: planId,
          dataClass: 'personal',
          detail: { results: rows.length, scheme: scheme.id },
        },
      };
    },
  );
}
