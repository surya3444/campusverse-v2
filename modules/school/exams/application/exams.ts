import { withTenant, type Db, type Tx } from '@campusverse/db';
import { staffAt, studentFacts } from '@campusverse/people-records';
import { issueDocumentIn, type ObjectStore } from '@campusverse/platform-documents';
import { command, emit, type EventInput } from '@campusverse/platform-events';
import { placeOf as institutionPlace } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { boardRulesAt } from '@campusverse/platform-rulepacks';
import { gradeFor } from '@campusverse/rules';
import { attendanceFigures } from '@campusverse/school-attendance';
import { enrolmentFacts, sectionRoster } from '@campusverse/school-enrolment';
import {
  assertYearOpen,
  classInfo,
  sectionsOn,
  subjectsOf,
  teaches,
  yearsOf,
} from '@campusverse/school-setup';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import {
  CODES,
  fromHundredths,
  hundredths,
  result,
  type Code,
  type Mark,
  type Paper,
} from '../domain/results.js';
import { paperStats, toppers, type PaperStats } from '../domain/analysis.js';

type Permissions = ReturnType<typeof createPermissions>;
export type ExamDeps = {
  db: Db;
  permissions: Permissions;
  store: ObjectStore;
  verifyBaseUrl: string;
};

export const EXAM_PUBLISHED = 'school.exam.published.v1';

export class ExamError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Exam: ${code}`);
    this.name = 'ExamError';
  }
}

async function today(tx: Tx) {
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return r?.d ?? '';
}

type ExamRow = {
  id: string;
  institutionId: string;
  yearId: string;
  name: string;
  classIds: string[];
  state: string;
};

async function loadExam(tx: Tx, examId: string, lock = false): Promise<ExamRow> {
  const [e] = await tx.execute<ExamRow>(sql`
    select id::text, institution_id::text as "institutionId", year_id::text as "yearId", name, class_ids::text[] as "classIds", state
    from school_exam where org_id = app_current_org() and id = ${examId} ${lock ? sql`for update` : sql``}`);
  if (!e) throw new ExamError('exam_not_found');
  return e;
}

async function place(tx: Tx, institutionId: string) {
  const p = await institutionPlace(tx, institutionId);
  if (!p) throw new ExamError('institution_not_found');
  return p;
}

/** The day used for rosters: today within the exam's year, else the year's last day. */
async function rosterDay(tx: Tx, e: ExamRow) {
  const y = (await yearsOf(tx, e.institutionId)).find((x) => x.yearId === e.yearId);
  const d = await today(tx);
  if (!y) return d;
  const last = new Date(Date.parse(`${y.ends}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  return d < y.starts ? y.starts : d > last ? last : d;
}

/**
 * The board's grading in force (rule pack) for an exam's classes on a date. The id is frozen
 * with each result, so a later pack version carries its number and never rewrites an old card.
 */
async function schemeAt(tx: Tx, e: ExamRow, on: string) {
  const board = (await classInfo(tx, e.classIds[0] ?? ''))?.board ?? '';
  const b = await boardRulesAt(tx, e.institutionId, board, on);
  if (!b?.rules.grades) return null;
  const g = b.rules.grades;
  return {
    ...g,
    id: b.version === 1 ? g.id : `${g.id}/v${b.version}`,
    rounding: 'down_2dp' as const,
    source: b.source,
  };
}

/** Runs one exam step: permission on the institution, the work, an audit row and events, in one transaction. */
async function step<T>(
  deps: ExamDeps,
  actor: Actor,
  examId: string,
  permission: string,
  work: (
    tx: Tx,
    e: ExamRow,
  ) => Promise<{
    result: T;
    detail: Record<string, string | number | boolean | null>;
    reason?: string;
    events?: EventInput[];
  }>,
): Promise<T> {
  const p = await withTenant(deps.db, actor.orgId, async (tx) =>
    place(tx, (await loadExam(tx, examId)).institutionId),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission, resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const e = await loadExam(tx, examId, true);
      // A closed year's exams and marks are final.
      await assertYearOpen(tx, e.yearId);
      const out = await work(tx, e);
      return {
        result: out.result,
        audit: {
          action: permission,
          entityType: 'school_exam',
          entityId: examId,
          dataClass: 'personal',
          ...(out.reason ? { reason: out.reason } : {}),
          detail: out.detail,
        },
        events: out.events ?? [],
      };
    },
  );
}

/**
 * A new exam for some classes of a year, with a paper for every subject each class is offered,
 * all with the same maximum unless changed later. Marks are open from the start.
 */
export async function createExam(
  deps: ExamDeps,
  actor: Actor,
  input: {
    institutionId: string;
    yearId: string;
    name: string;
    classIds: string[];
    maxMarks: string;
    startsOn?: string | null | undefined;
    endsOn?: string | null | undefined;
  },
): Promise<{ id: string; papers: number }> {
  if (hundredths(input.maxMarks) === null || hundredths(input.maxMarks) === 0)
    throw new ExamError('bad_max');
  if (input.classIds.length === 0) throw new ExamError('no_classes');
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.exam.manage', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const year = (await yearsOf(tx, input.institutionId)).find((y) => y.yearId === input.yearId);
      if (!year) throw new ExamError('year_not_found');
      const [e] = await tx.execute<{ id: string }>(sql`
      insert into school_exam (org_id, institution_id, year_id, name, class_ids, starts_on, ends_on, created_by_person_id)
      values (app_current_org(), ${input.institutionId}, ${input.yearId}, ${input.name.trim()}, ${`{${input.classIds.join(',')}}`}::uuid[],
        ${input.startsOn ?? null}::date, ${input.endsOn ?? null}::date, ${actor.personId})
      returning id::text`);
      if (!e) throw new Error('createExam: no row');
      let papers = 0;
      for (const classId of input.classIds) {
        const c = await classInfo(tx, classId);
        if (!c || c.institutionId !== input.institutionId) throw new ExamError('class_not_found');
        for (const s of await subjectsOf(tx, input.yearId, classId)) {
          await tx.execute(sql`
          insert into school_exam_paper (org_id, exam_id, class_id, subject_id, max_marks)
          values (app_current_org(), ${e.id}, ${classId}, ${s.subjectId}, ${input.maxMarks}::numeric)`);
          papers++;
        }
      }
      if (papers === 0) throw new ExamError('no_subjects');
      return {
        result: { id: e.id, papers },
        audit: {
          action: 'school.exam.manage',
          entityType: 'school_exam',
          entityId: e.id,
          dataClass: 'operational',
          detail: { papers },
        },
      };
    },
  );
}

export type ExamSummary = {
  id: string;
  name: string;
  yearLabel: string;
  state: string;
  classes: number;
  papers: number;
  submitted: number;
  publishedAt: string | null;
};

export async function listExams(
  deps: ExamDeps,
  actor: Actor,
  institutionId: string,
): Promise<ExamSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    return [
      ...(await tx.execute<ExamSummary>(sql`
        select e.id::text, e.name, y.label as "yearLabel", e.state, cardinality(e.class_ids) as classes,
          (select count(*)::int from school_exam_paper p where p.org_id = e.org_id and p.exam_id = e.id) as papers,
          (select count(*)::int from school_exam_paper p where p.org_id = e.org_id and p.exam_id = e.id and p.submitted_at is not null) as submitted,
          e.published_at::text as "publishedAt"
        from school_exam e join school_year y on y.org_id = e.org_id and y.id = e.year_id
        where e.org_id = app_current_org() and e.institution_id = ${institutionId}
        order by e.created_at desc`)),
    ];
  });
}

export type ExamDetail = {
  id: string;
  name: string;
  state: string;
  gradeScheme: string | null;
  classes: {
    classId: string;
    name: string;
    sections: { sectionId: string; label: string; students: number }[];
    papers: {
      paperId: string;
      subject: string;
      maxMarks: string;
      entered: number;
      blanks: number;
      submitted: boolean;
    }[];
  }[];
  changes: {
    id: string;
    student: string;
    subject: string;
    newMark: string;
    reason: string;
    requestedBy: string;
    requestedById: string;
  }[];
};

export async function examDetail(
  deps: ExamDeps,
  actor: Actor,
  examId: string,
): Promise<ExamDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const e = await loadExam(tx, examId);
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    });
    const d = await rosterDay(tx, e);
    const sections = await sectionsOn(tx, e.institutionId, d);
    const [scheme] = await tx.execute<{ s: string | null }>(
      sql`select grade_scheme as s from school_exam where org_id = app_current_org() and id = ${examId}`,
    );
    const classes: ExamDetail['classes'] = [];
    for (const classId of e.classIds) {
      const c = await classInfo(tx, classId);
      const mine = sections.filter((s) => s.classId === classId);
      const students = new Set<string>();
      const sectionRows = [];
      for (const s of mine) {
        const roster = await sectionRoster(tx, s.sectionId, d);
        roster.forEach((r) => students.add(r.personId));
        sectionRows.push({ sectionId: s.sectionId, label: s.label, students: roster.length });
      }
      const ids = `{${[...students].join(',')}}`;
      const papers = await tx.execute<{
        paperId: string;
        subject: string;
        maxMarks: string;
        entered: number;
        submitted: boolean;
      }>(sql`
        select p.id::text as "paperId", s.name as subject, p.max_marks::text as "maxMarks",
          (select count(*)::int from school_exam_mark m where m.org_id = p.org_id and m.paper_id = p.id
            and (m.value is not null or m.code is not null) and m.student_person_id = any(${ids}::uuid[])) as entered,
          p.submitted_at is not null as submitted
        from school_exam_paper p join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
        where p.org_id = app_current_org() and p.exam_id = ${examId} and p.class_id = ${classId} order by s.code`);
      classes.push({
        classId,
        name: c?.name ?? '',
        sections: sectionRows,
        papers: papers.map((p) => ({
          ...p,
          maxMarks: fromHundredths(hundredths(p.maxMarks) ?? 0),
          blanks: students.size - p.entered,
        })),
      });
    }
    const changes = await tx.execute<
      Omit<ExamDetail['changes'][number], 'newMark'> & { value: string | null; code: string | null }
    >(sql`
      select c.id::text, st.legal_name as student, s.name as subject, c.new_value::text as value, c.new_code as code,
        c.reason, r.legal_name as "requestedBy", c.requested_by_person_id::text as "requestedById"
      from school_exam_mark_change c
      join school_exam_paper p on p.org_id = c.org_id and p.id = c.paper_id
      join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
      join person st on st.org_id = c.org_id and st.id = c.student_person_id
      join person r on r.org_id = c.org_id and r.id = c.requested_by_person_id
      where c.org_id = app_current_org() and p.exam_id = ${examId} and c.state = 'requested' order by c.created_at`);
    return {
      id: e.id,
      name: e.name,
      state: e.state,
      // Frozen at publishing; before that, the scheme publishing will use.
      gradeScheme: scheme?.s ?? (await schemeAt(tx, e, await rosterDay(tx, e)))?.id ?? null,
      classes,
      // "70.00" shows as "70": formatted from hundredths, never by trimming text.
      changes: changes.map(({ value, code, ...c }) => ({
        ...c,
        newMark: code ?? (value === null ? '' : fromHundredths(hundredths(value) ?? 0)),
      })),
    };
  });
}

type PaperRow = {
  paperId: string;
  examId: string;
  classId: string;
  subjectId: string;
  subject: string;
  maxMarks: string;
  submitted: boolean;
};

async function loadPaper(tx: Tx, paperId: string): Promise<PaperRow> {
  const [p] = await tx.execute<PaperRow>(sql`
    select p.id::text as "paperId", p.exam_id::text as "examId", p.class_id::text as "classId", p.subject_id::text as "subjectId",
      s.name as subject, p.max_marks::text as "maxMarks", p.submitted_at is not null as submitted
    from school_exam_paper p join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
    where p.org_id = app_current_org() and p.id = ${paperId}`);
  if (!p) throw new ExamError('paper_not_found');
  return p;
}

/** Subject teacher or class teacher of the section, or someone who manages exams. */
async function mayEnter(
  tx: Tx,
  deps: ExamDeps,
  actor: Actor,
  e: ExamRow,
  p: PaperRow,
  sectionId: string,
  d: string,
) {
  if (await teaches(tx, { personId: actor.personId, sectionId, subjectId: p.subjectId, onDate: d }))
    return true;
  return (
    await deps.permissions.can(tx, actor, 'school.exam.manage', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    })
  ).allowed;
}

export type MarksSheet = {
  paperId: string;
  exam: string;
  examState: string;
  subject: string;
  section: string;
  maxMarks: string;
  submitted: boolean;
  canEdit: boolean;
  students: { personId: string; name: string; rollNumber: number | null; mark: string }[];
};

/** One paper for one section: the students in roll order and what is entered ("72.5", "AB", or ""). */
export async function marksSheet(
  deps: ExamDeps,
  actor: Actor,
  input: { paperId: string; sectionId: string },
): Promise<MarksSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await loadPaper(tx, input.paperId);
    const e = await loadExam(tx, p.examId);
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    });
    const d = await rosterDay(tx, e);
    const section = (await sectionsOn(tx, e.institutionId, d)).find(
      (s) => s.sectionId === input.sectionId && s.classId === p.classId,
    );
    if (!section) throw new ExamError('section_not_found');
    const roster = await sectionRoster(tx, input.sectionId, d);
    const marks = new Map(
      (
        await tx.execute<{ id: string; value: string | null; code: Code | null }>(sql`
          select student_person_id::text as id, value::text, code from school_exam_mark
          where org_id = app_current_org() and paper_id = ${p.paperId}`)
      ).map((m) => [
        m.id,
        m.code ?? (m.value !== null ? fromHundredths(hundredths(m.value) ?? 0) : ''),
      ]),
    );
    const entering = (
      await deps.permissions.can(tx, actor, 'school.exam.enter_marks', {
        orgId: actor.orgId,
        place: await place(tx, e.institutionId),
      })
    ).allowed;
    return {
      paperId: p.paperId,
      exam: e.name,
      examState: e.state,
      subject: p.subject,
      section: section.label,
      maxMarks: fromHundredths(hundredths(p.maxMarks) ?? 0),
      submitted: p.submitted,
      canEdit:
        e.state === 'marks_open' &&
        entering &&
        (await mayEnter(tx, deps, actor, e, p, input.sectionId, d)),
      students: roster.map((r) => ({ ...r, mark: marks.get(r.personId) ?? '' })),
    };
  });
}

/** "72.5", "AB" or "" (clear) → a value or a code; anything else is refused. */
function parseEntry(raw: string, max: number): Mark | 'not_a_mark' | 'over_max' {
  const t = raw.trim().toUpperCase();
  if (t === '') return { value: null, code: null };
  if ((CODES as readonly string[]).includes(t)) return { value: null, code: t as Code };
  const h = hundredths(t);
  if (h === null) return 'not_a_mark';
  if (h > max) return 'over_max';
  return { value: fromHundredths(h), code: null };
}

/**
 * Saves a batch of marks for one section's students while marks are open (autosave and paste
 * from Excel send these). Every entry is checked before anything is written.
 */
export async function saveMarks(
  deps: ExamDeps,
  actor: Actor,
  input: { paperId: string; sectionId: string; entries: { studentId: string; mark: string }[] },
): Promise<{ saved: number }> {
  const examId = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => (await loadPaper(tx, input.paperId)).examId,
  );
  return step(deps, actor, examId, 'school.exam.enter_marks', async (tx, e) => {
    if (e.state !== 'marks_open') throw new ExamError('marks_closed');
    const p = await loadPaper(tx, input.paperId);
    const d = await rosterDay(tx, e);
    if (!(await mayEnter(tx, deps, actor, e, p, input.sectionId, d)))
      throw new PermissionDenied('school.exam.enter_marks', 'no_relationship');
    const roster = new Set((await sectionRoster(tx, input.sectionId, d)).map((r) => r.personId));
    const max = hundredths(p.maxMarks) ?? 0;
    const parsed = input.entries.map((x) => ({ ...x, parsed: parseEntry(x.mark, max) }));
    const bad = parsed.find((x) => typeof x.parsed === 'string' || !roster.has(x.studentId));
    if (bad)
      throw new ExamError(typeof bad.parsed === 'string' ? bad.parsed : 'not_in_section', {
        studentId: bad.studentId,
      });
    for (const x of parsed) {
      const m = x.parsed as Mark;
      await tx.execute(sql`
        insert into school_exam_mark (org_id, paper_id, student_person_id, value, code, entered_by_person_id)
        values (app_current_org(), ${p.paperId}, ${x.studentId}, ${m.value}::numeric, ${m.code}, ${actor.personId})
        on conflict (org_id, paper_id, student_person_id) do update
          set value = excluded.value, code = excluded.code, entered_by_person_id = excluded.entered_by_person_id, entered_at = now()`);
    }
    return {
      result: { saved: parsed.length },
      detail: { paperId: p.paperId, saved: parsed.length },
    };
  });
}

async function blanksOf(tx: Tx, e: ExamRow, p: PaperRow, d: string): Promise<number> {
  let blanks = 0;
  for (const s of (await sectionsOn(tx, e.institutionId, d)).filter(
    (x) => x.classId === p.classId,
  )) {
    const ids = (await sectionRoster(tx, s.sectionId, d)).map((r) => r.personId);
    if (ids.length === 0) continue;
    const [r] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_exam_mark where org_id = app_current_org() and paper_id = ${p.paperId}
        and (value is not null or code is not null) and student_person_id = any(${`{${ids.join(',')}}`}::uuid[])`);
    blanks += ids.length - (r?.n ?? 0);
  }
  return blanks;
}

/** The teacher's "done" for a paper: refused while any enrolled student is blank. */
export async function submitPaper(deps: ExamDeps, actor: Actor, paperId: string): Promise<void> {
  const examId = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => (await loadPaper(tx, paperId)).examId,
  );
  await step(deps, actor, examId, 'school.exam.enter_marks', async (tx, e) => {
    if (e.state !== 'marks_open') throw new ExamError('marks_closed');
    const p = await loadPaper(tx, paperId);
    const blanks = await blanksOf(tx, e, p, await rosterDay(tx, e));
    if (blanks > 0) throw new ExamError('blanks', { blanks });
    await tx.execute(sql`
      update school_exam_paper set submitted_by_person_id = ${actor.personId}, submitted_at = now()
      where org_id = app_current_org() and id = ${paperId}`);
    return { result: undefined, detail: { paperId } };
  });
}

/** The principal locks the exam once every paper is submitted. After this, changes need a second person. */
export async function lockExam(deps: ExamDeps, actor: Actor, examId: string): Promise<void> {
  await step(deps, actor, examId, 'school.exam.lock', async (tx, e) => {
    if (e.state !== 'marks_open') throw new ExamError('not_open');
    const [open] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_exam_paper where org_id = app_current_org() and exam_id = ${examId} and submitted_at is null`);
    if ((open?.n ?? 0) > 0) throw new ExamError('papers_not_submitted', { papers: open?.n });
    await tx.execute(sql`
      update school_exam set state = 'marks_locked', locked_by_person_id = ${actor.personId}, locked_at = now()
      where org_id = app_current_org() and id = ${examId}`);
    return { result: undefined, detail: {} };
  });
}

/** After the lock: a change is asked for with a reason, and decided by someone else. */
export async function requestMarkChange(
  deps: ExamDeps,
  actor: Actor,
  input: { paperId: string; studentId: string; mark: string; reason: string },
): Promise<{ id: string }> {
  if (input.reason.trim().length < 3) throw new ExamError('reason_required');
  const examId = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => (await loadPaper(tx, input.paperId)).examId,
  );
  return step(deps, actor, examId, 'school.exam.enter_marks', async (tx, e) => {
    if (e.state !== 'marks_locked') throw new ExamError('not_locked');
    const p = await loadPaper(tx, input.paperId);
    const m = parseEntry(input.mark, hundredths(p.maxMarks) ?? 0);
    if (typeof m === 'string' || (m.value === null && m.code === null))
      throw new ExamError(typeof m === 'string' ? m : 'blank_not_allowed');
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into school_exam_mark_change (org_id, paper_id, student_person_id, new_value, new_code, reason, requested_by_person_id)
      values (app_current_org(), ${p.paperId}, ${input.studentId}, ${m.value}::numeric, ${m.code}, ${input.reason.trim()}, ${actor.personId})
      returning id::text`);
    if (!row) throw new Error('requestMarkChange: no row');
    return {
      result: row,
      reason: input.reason.trim(),
      detail: { paperId: p.paperId, studentId: input.studentId },
    };
  });
}

export async function decideMarkChange(
  deps: ExamDeps,
  actor: Actor,
  input: { changeId: string; approve: boolean },
): Promise<void> {
  const examId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{ paperId: string }>(sql`
      select paper_id::text as "paperId" from school_exam_mark_change where org_id = app_current_org() and id = ${input.changeId}`);
    if (!c) throw new ExamError('change_not_found');
    return (await loadPaper(tx, c.paperId)).examId;
  });
  await step(deps, actor, examId, 'school.exam.lock', async (tx, e) => {
    if (e.state !== 'marks_locked') throw new ExamError('not_locked');
    const [c] = await tx.execute<{
      paperId: string;
      studentId: string;
      value: string | null;
      code: Code | null;
      requestedBy: string;
    }>(sql`
      select paper_id::text as "paperId", student_person_id::text as "studentId", new_value::text as value, new_code as code,
        requested_by_person_id::text as "requestedBy"
      from school_exam_mark_change where org_id = app_current_org() and id = ${input.changeId} and state = 'requested' for update`);
    if (!c) throw new ExamError('change_not_found');
    if (c.requestedBy === actor.personId) throw new ExamError('maker_cannot_approve');
    await tx.execute(sql`
      update school_exam_mark_change set state = ${input.approve ? 'approved' : 'rejected'}, decided_by_person_id = ${actor.personId},
        decided_at = now()
      where org_id = app_current_org() and id = ${input.changeId}`);
    if (input.approve) {
      await tx.execute(sql`
        insert into school_exam_mark (org_id, paper_id, student_person_id, value, code, entered_by_person_id)
        values (app_current_org(), ${c.paperId}, ${c.studentId}, ${c.value}::numeric, ${c.code}, ${actor.personId})
        on conflict (org_id, paper_id, student_person_id) do update
          set value = excluded.value, code = excluded.code, entered_by_person_id = excluded.entered_by_person_id, entered_at = now()`);
    }
    return { result: undefined, detail: { changeId: input.changeId, approved: input.approve } };
  });
}

/** The class teacher's remark for the report card. */
export async function setRemark(
  deps: ExamDeps,
  actor: Actor,
  input: { examId: string; studentId: string; remark: string },
): Promise<void> {
  if (input.remark.trim().length < 2 || input.remark.length > 300)
    throw new ExamError('bad_remark');
  await step(deps, actor, input.examId, 'school.exam.enter_marks', async (tx, e) => {
    if (e.state === 'published' || e.state === 'cancelled') throw new ExamError('published');
    await tx.execute(sql`
      insert into school_exam_remark (org_id, exam_id, student_person_id, remark, written_by_person_id)
      values (app_current_org(), ${input.examId}, ${input.studentId}, ${input.remark.trim()}, ${actor.personId})
      on conflict (org_id, exam_id, student_person_id) do update set remark = excluded.remark,
        written_by_person_id = excluded.written_by_person_id, updated_at = now()`);
    return { result: undefined, detail: { studentId: input.studentId } };
  });
}

/**
 * Publishes a locked exam: each student's result is frozen with the grading scheme version, a
 * report card PDF is issued (QR-verifiable), and parents are told. Refused while anyone is blank.
 */
export async function publishExam(
  deps: ExamDeps,
  actor: Actor,
  examId: string,
): Promise<{ results: number }> {
  return step(deps, actor, examId, 'school.exam.publish', async (tx, e) => {
    if (e.state !== 'marks_locked') throw new ExamError('not_locked');
    const inst = (await yearsOf(tx, e.institutionId)).find((y) => y.yearId === e.yearId);
    const d = await rosterDay(tx, e);
    const scheme = await schemeAt(tx, e, d);
    if (!scheme || !inst) throw new ExamError('no_grade_scheme');
    let count = 0;
    // ponytail: renders every report card inside this transaction; move to a worker job past a few hundred students.
    for (const classId of e.classIds) {
      const papers = await tx.execute<Paper>(sql`
        select p.id::text as "paperId", p.subject_id::text as "subjectId", s.name as subject, p.max_marks::text as max
        from school_exam_paper p join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
        where p.org_id = app_current_org() and p.exam_id = ${examId} and p.class_id = ${classId} order by s.code`);
      for (const section of (await sectionsOn(tx, e.institutionId, d)).filter(
        (s) => s.classId === classId,
      )) {
        for (const st of await sectionRoster(tx, section.sectionId, d)) {
          const marks = new Map(
            (
              await tx.execute<{ paperId: string; value: string | null; code: Code | null }>(sql`
                select paper_id::text as "paperId", value::text, code from school_exam_mark
                where org_id = app_current_org() and student_person_id = ${st.personId}
                  and paper_id = any(${`{${papers.map((p) => p.paperId).join(',')}}`}::uuid[])`)
            ).map((m): [string, Mark] => [
              m.paperId,
              {
                value: m.value === null ? null : fromHundredths(hundredths(m.value) ?? 0),
                code: m.code,
              },
            ]),
          );
          const r = result([...papers], marks, (bp) => gradeFor(scheme, bp));
          if (r.blanks.length > 0)
            throw new ExamError('blanks', { student: st.name, subjects: r.blanks });
          const [remark] = await tx.execute<{ remark: string }>(sql`
            select remark from school_exam_remark where org_id = app_current_org() and exam_id = ${examId} and student_person_id = ${st.personId}`);
          const att = await attendanceFigures(tx, {
            studentId: st.personId,
            from: inst.starts,
            until:
              d < inst.ends
                ? new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)
                : inst.ends,
          });
          const enr = await enrolmentFacts(tx, st.personId, d);
          const facts = await studentFacts(tx, st.personId);
          const pct =
            r.percentBp === null
              ? '—'
              : `${Math.floor(r.percentBp / 100)}.${String(r.percentBp % 100).padStart(2, '0')}%`;
          const doc = await issueDocumentIn(
            tx,
            deps.store,
            actor,
            { verifyBaseUrl: deps.verifyBaseUrl },
            {
              kind: 'report_card',
              number: `RC/${inst.label}/${examId.slice(-8)}/${enr?.admissionNumber ?? st.personId.slice(-8)}`,
              title: `Report card: ${e.name}`,
              subjectPersonId: st.personId,
              lines: [
                ['Student', facts?.name ?? st.name],
                ['Class', section.label],
                ['Academic year', inst.label],
                ...r.subjects.map((s): [string, string] => [
                  s.subject,
                  s.marks === null
                    ? `${s.shown}${s.note ? ` (${s.note})` : ''}`
                    : `${s.shown} / ${fromHundredths(s.max ?? 0)}  ${s.grade ?? ''}`,
                ]),
                ['Total', `${fromHundredths(r.marks)} / ${fromHundredths(r.max)}  (${pct})`],
                [
                  'Attendance',
                  `${Math.floor(att.attendedHalfDays / 2)}${att.attendedHalfDays % 2 ? '.5' : ''} of ${att.workingDays} days`,
                ],
                ['Remark', remark?.remark ?? ''],
                ['Grading', scheme.id],
              ],
            },
          );
          await tx.execute(sql`
            insert into school_exam_result (org_id, exam_id, student_person_id, class_id, section_id, subjects, marks, max_marks,
              percent, grade, grade_scheme, report_document_id)
            values (app_current_org(), ${examId}, ${st.personId}, ${classId}, ${section.sectionId}, ${JSON.stringify(r.subjects)}::jsonb,
              ${fromHundredths(r.marks)}::numeric, ${fromHundredths(r.max)}::numeric,
              ${r.percentBp === null ? null : (r.percentBp / 100).toFixed(2)}::numeric,
              ${r.percentBp === null ? null : gradeFor(scheme, r.percentBp)}, ${scheme.id}, ${doc.id})`);
          await notifyGuardians(tx, {
            studentId: st.personId,
            flag: 'academic_messages',
            kind: 'notice',
            language: 'en',
            title: `${e.name} results`,
            body: `${(facts?.name ?? st.name).split(' ')[0]}'s report card for ${e.name} is ready in the app.`,
            dedupeKey: `exam-result:${examId}:${st.personId}`,
          });
          count++;
        }
      }
    }
    await tx.execute(sql`
      update school_exam set state = 'published', grade_scheme = ${scheme.id}, published_by_person_id = ${actor.personId}, published_at = now()
      where org_id = app_current_org() and id = ${examId}`);
    await emit(tx, { type: EXAM_PUBLISHED, payload: { examId, results: count } });
    return { result: { results: count }, detail: { results: count, scheme: scheme.id } };
  });
}

export type StudentResult = {
  examId: string;
  exam: string;
  publishedAt: string;
  percent: string | null;
  grade: string | null;
  subjects: {
    subject: string;
    shown: string;
    max: number | null;
    grade: string | null;
    note: string | null;
  }[];
  reportDocumentId: string | null;
};

/** A student's published results, for the record and for parents (own child only). */
export async function studentResults(
  deps: ExamDeps,
  actor: Actor,
  studentId: string,
): Promise<StudentResult[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const enr = await enrolmentFacts(tx, studentId, await today(tx));
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      ...(enr ? { place: await place(tx, enr.institutionId) } : {}),
      subjectPersonId: studentId,
    });
    return [
      ...(await tx.execute<StudentResult>(sql`
        select r.exam_id::text as "examId", e.name as exam, r.published_at::text as "publishedAt", r.percent::text, r.grade,
          r.subjects, r.report_document_id::text as "reportDocumentId"
        from school_exam_result r join school_exam e on e.org_id = r.org_id and e.id = r.exam_id
        where r.org_id = app_current_org() and r.student_person_id = ${studentId} order by r.published_at desc`)),
    ];
  });
}

/** For rollover and the section planner: the student's latest published result, per subject. */
export async function latestResult(
  tx: Tx,
  studentId: string,
): Promise<{
  percentBp: number | null;
  subjects: { subject: string; percentBp: number | null }[];
} | null> {
  const [r] = await tx.execute<{
    percent: string | null;
    subjects: { subject: string; percentBp: number | null }[];
  }>(sql`
    select percent::text, subjects from school_exam_result
    where org_id = app_current_org() and student_person_id = ${studentId} order by published_at desc limit 1`);
  if (!r) return null;
  return {
    percentBp: r.percent === null ? null : Math.round(Number(r.percent) * 100),
    subjects: r.subjects.map((s) => ({ subject: s.subject, percentBp: s.percentBp })),
  };
}

// ---------------------------------------------------------------------------------------------
// Milestone 22: the date sheet and result analysis.
// ---------------------------------------------------------------------------------------------

export type DateSheet = {
  examId: string;
  name: string;
  state: string;
  papers: {
    paperId: string;
    classId: string;
    className: string;
    subjectCode: string;
    subject: string;
    maxMarks: string;
    onDate: string | null;
    startsAt: string | null;
    durationMinutes: number | null;
    room: string | null;
    invigilator: { personId: string; name: string } | null;
  }[];
  staff: { personId: string; name: string }[];
};

/** Every paper's date, time, room and invigilator, in date order (unscheduled papers last). */
export async function dateSheet(deps: ExamDeps, actor: Actor, examId: string): Promise<DateSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const e = await loadExam(tx, examId);
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    });
    const rows = await tx.execute<
      Omit<DateSheet['papers'][number], 'invigilator'> & {
        invigilatorId: string | null;
        invigilatorName: string | null;
      }
    >(sql`
      select p.id::text as "paperId", p.class_id::text as "classId", c.name as "className", s.code as "subjectCode",
        s.name as subject, p.max_marks::text as "maxMarks", p.on_date::text as "onDate",
        to_char(p.starts_at, 'HH24:MI') as "startsAt", p.duration_minutes as "durationMinutes", p.room,
        p.invigilator_person_id::text as "invigilatorId", inv.legal_name as "invigilatorName"
      from school_exam_paper p
      join school_class c on c.org_id = p.org_id and c.id = p.class_id
      join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
      left join person inv on inv.org_id = p.org_id and inv.id = p.invigilator_person_id
      where p.org_id = app_current_org() and p.exam_id = ${examId}
      order by p.on_date nulls last, p.starts_at nulls last, c.sequence, s.code`);
    return {
      examId,
      name: e.name,
      state: e.state,
      papers: rows.map(({ invigilatorId, invigilatorName, ...p }) => ({
        ...p,
        maxMarks: fromHundredths(hundredths(p.maxMarks) ?? 0),
        invigilator: invigilatorId
          ? { personId: invigilatorId, name: invigilatorName ?? '' }
          : null,
      })),
      staff: (await staffAt(tx, e.institutionId, await rosterDay(tx, e))).map((s) => ({
        personId: s.personId,
        name: s.name,
      })),
    };
  });
}

export type PaperSchedule = {
  onDate: string | null;
  startsAt: string | null;
  durationMinutes: number | null;
  room: string | null;
  invigilatorId: string | null;
};

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Sets a paper's date, time, room and invigilator while marks are open. A class can't sit two
 * papers at once, and an invigilator can't be in two rooms at once.
 */
export async function schedulePaper(
  deps: ExamDeps,
  actor: Actor,
  paperId: string,
  s: PaperSchedule,
): Promise<void> {
  if ((s.startsAt === null) !== (s.durationMinutes === null))
    throw new ExamError('time_needs_length');
  const examId = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => (await loadPaper(tx, paperId)).examId,
  );
  await step(deps, actor, examId, 'school.exam.manage', async (tx, e) => {
    if (e.state !== 'marks_open') throw new ExamError('marks_not_open');
    const p = await loadPaper(tx, paperId);
    if (
      s.invigilatorId &&
      !(await staffAt(tx, e.institutionId, s.onDate ?? (await rosterDay(tx, e)))).some(
        (x) => x.personId === s.invigilatorId,
      )
    )
      throw new ExamError('not_on_staff');
    if (s.onDate && s.startsAt && s.durationMinutes) {
      const start = minutes(s.startsAt);
      const end = start + s.durationMinutes;
      const others = await tx.execute<{
        classId: string;
        invigilator: string | null;
        startsAt: string;
        duration: number;
      }>(sql`
        select class_id::text as "classId", invigilator_person_id::text as invigilator,
          to_char(starts_at, 'HH24:MI') as "startsAt", duration_minutes as duration
        from school_exam_paper
        where org_id = app_current_org() and id <> ${paperId} and on_date = ${s.onDate}::date
          and starts_at is not null and duration_minutes is not null
          and exam_id in (select id from school_exam where org_id = app_current_org() and institution_id = ${e.institutionId})`);
      const overlapping = others.filter(
        (o) => minutes(o.startsAt) < end && start < minutes(o.startsAt) + o.duration,
      );
      if (overlapping.some((o) => o.classId === p.classId)) throw new ExamError('class_clash');
      if (s.invigilatorId && overlapping.some((o) => o.invigilator === s.invigilatorId))
        throw new ExamError('invigilator_clash');
    }
    await tx.execute(sql`
      update school_exam_paper set on_date = ${s.onDate}::date, starts_at = ${s.startsAt}::time,
        duration_minutes = ${s.durationMinutes}, room = ${s.room?.trim() || null}, invigilator_person_id = ${s.invigilatorId}
      where org_id = app_current_org() and id = ${paperId}`);
    return {
      result: undefined,
      detail: { paperId, onDate: s.onDate, startsAt: s.startsAt, invigilator: s.invigilatorId },
    };
  });
}

export type ExamAnalysis = {
  examId: string;
  name: string;
  passBasisPoints: number | null;
  classes: {
    classId: string;
    name: string;
    students: number;
    papers: ({ paperId: string; subject: string; maxMarks: string } & PaperStats)[];
    toppers: { personId: string; name: string; percentBp: number; rank: number }[];
  }[];
};

/** How each paper went (averages, pass rates, grades) and each class's top five so far. */
export async function examAnalysis(
  deps: ExamDeps,
  actor: Actor,
  examId: string,
): Promise<ExamAnalysis> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const e = await loadExam(tx, examId);
    await deps.permissions.assertCan(tx, actor, 'school.exam.read', {
      orgId: actor.orgId,
      place: await place(tx, e.institutionId),
    });
    const d = await rosterDay(tx, e);
    const scheme = await schemeAt(tx, e, d);
    const grade = (bp: number) => (scheme ? gradeFor(scheme, bp) : '');
    const sections = await sectionsOn(tx, e.institutionId, d);
    const classes: ExamAnalysis['classes'] = [];
    for (const classId of e.classIds) {
      const roster = new Map<string, string>();
      for (const s of sections.filter((x) => x.classId === classId))
        for (const r of await sectionRoster(tx, s.sectionId, d)) roster.set(r.personId, r.name);
      const papers = await tx.execute<{
        paperId: string;
        subjectId: string;
        subject: string;
        max: string;
      }>(sql`
        select p.id::text as "paperId", p.subject_id::text as "subjectId", s.name as subject, p.max_marks::text as max
        from school_exam_paper p join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
        where p.org_id = app_current_org() and p.exam_id = ${examId} and p.class_id = ${classId} order by s.code`);
      const marks = await tx.execute<{
        paperId: string;
        studentId: string;
        value: string | null;
        code: Code | null;
      }>(sql`
        select paper_id::text as "paperId", student_person_id::text as "studentId", value::text as value, code
        from school_exam_mark where org_id = app_current_org()
          and paper_id = any(${`{${papers.map((p) => p.paperId).join(',')}}`}::uuid[])`);
      const markOf = new Map(
        marks.map((m) => [`${m.paperId}:${m.studentId}`, { value: m.value, code: m.code }]),
      );
      const students = [...roster.keys()];
      const overall = students.map((studentId) => {
        const r = result(
          papers.map((p) => ({
            paperId: p.paperId,
            subjectId: p.subjectId,
            subject: p.subject,
            max: p.max,
          })),
          new Map(
            papers.map((p) => [
              p.paperId,
              markOf.get(`${p.paperId}:${studentId}`) ?? { value: null, code: null },
            ]),
          ),
          grade,
        );
        return { studentId, percentBp: r.percentBp, complete: r.blanks.length === 0 };
      });
      classes.push({
        classId,
        name: (await classInfo(tx, classId))?.name ?? '',
        students: students.length,
        papers: papers.map((p) => ({
          paperId: p.paperId,
          subject: p.subject,
          maxMarks: fromHundredths(hundredths(p.max) ?? 0),
          ...paperStats(
            p.max,
            students.map((sid) => markOf.get(`${p.paperId}:${sid}`) ?? { value: null, code: null }),
            scheme?.passBasisPoints ?? 0,
            grade,
          ),
        })),
        toppers: toppers(overall, 5).map((t) => ({
          personId: t.studentId,
          name: roster.get(t.studentId) ?? '',
          percentBp: t.percentBp,
          rank: t.rank,
        })),
      });
    }
    return { examId, name: e.name, passBasisPoints: scheme?.passBasisPoints ?? null, classes };
  });
}

export type PaperOn = {
  classId: string;
  className: string;
  exam: string;
  subject: string;
  /** Null when the date sheet has no time yet: the class sits it some time that day. */
  startsAt: string | null;
  endsAt: string | null;
  room: string | null;
  invigilatorPersonId: string | null;
};

/** Papers sat at an institution on a date (for the timetable's exam days). The caller checks. */
export async function papersOn(tx: Tx, institutionId: string, onDate: string): Promise<PaperOn[]> {
  return [
    ...(await tx.execute<PaperOn>(sql`
      select p.class_id::text as "classId", c.name as "className", e.name as exam, s.name as subject,
        to_char(p.starts_at, 'HH24:MI') as "startsAt",
        to_char(p.starts_at + make_interval(mins => p.duration_minutes), 'HH24:MI') as "endsAt",
        p.room, p.invigilator_person_id::text as "invigilatorPersonId"
      from school_exam_paper p
      join school_exam e on e.org_id = p.org_id and e.id = p.exam_id
      join school_class c on c.org_id = p.org_id and c.id = p.class_id
      join school_subject s on s.org_id = p.org_id and s.id = p.subject_id
      where p.org_id = app_current_org() and e.institution_id = ${institutionId}
        and e.state <> 'cancelled' and p.on_date = ${onDate}::date
      order by c.sequence, p.starts_at nulls last`)),
  ];
}
