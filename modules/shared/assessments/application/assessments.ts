// Academics › Assessments (rule book §13.2; docs/specs/ASSESSMENTS.md): a question bank tagged
// with Bloom level, difficulty and CO; question papers built from it with their blueprint. A paper
// copies each question when it's added, and a final paper never changes (database trigger).
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  blueprint,
  questionProblem,
  type Bloom,
  type Blueprint,
  type Difficulty,
  type QuestionKind,
} from '../domain/assessments.js';

type Permissions = ReturnType<typeof createPermissions>;
export type AssessmentDeps = { db: Db; permissions: Permissions };
const PERMISSION = 'assessment.bank.manage';

export class AssessmentError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'question_not_found'
      | 'paper_not_found'
      | 'paper_final'
      | 'empty_paper'
      | 'bad_options'
      | 'bad_answer',
  ) {
    super(`assessment: ${code}`);
    this.name = 'AssessmentError';
  }
}

async function placeRes(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new AssessmentError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}
const resAt = (deps: AssessmentDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => placeRes(tx, actor, institutionId));
const reader = async <T>(
  deps: AssessmentDeps,
  actor: Actor,
  institutionId: string,
  fn: (tx: Tx) => Promise<T>,
) =>
  withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      PERMISSION,
      await placeRes(tx, actor, institutionId),
    );
    return fn(tx);
  });
const arr = (xs: string[]) =>
  `{${xs.map((o) => `"${o.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`;

// ---------------------------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------------------------

export type QuestionInput = {
  subject: string;
  topic: string | null;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  answer: string | null;
  marks: number;
  difficulty: Difficulty;
  bloom: Bloom;
  coCode: string | null;
};
export type QuestionRow = QuestionInput & { id: string; usedIn: number };

export async function subjects(
  deps: AssessmentDeps,
  actor: Actor,
  institutionId: string,
): Promise<string[]> {
  return reader(deps, actor, institutionId, async (tx) =>
    (
      await tx.execute<{ s: string }>(sql`
        select distinct subject as s from assessment_question
        where org_id = app_current_org() and institution_id = ${institutionId} and archived_at is null
        order by 1`)
    ).map((r) => r.s),
  );
}

export async function questions(
  deps: AssessmentDeps,
  actor: Actor,
  input: {
    institutionId: string;
    subject?: string | undefined;
    bloom?: Bloom | undefined;
    difficulty?: Difficulty | undefined;
    search?: string | undefined;
  },
): Promise<QuestionRow[]> {
  const like = input.search?.trim()
    ? `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    : null;
  return reader(deps, actor, input.institutionId, (tx) =>
    tx.execute<QuestionRow>(sql`
      select q.id::text, q.subject, q.topic, q.kind, q.prompt, q.options, q.answer, q.marks::float as marks,
        q.difficulty, q.bloom, q.co_code as "coCode",
        (select count(*)::int from assessment_paper_item i where i.org_id = q.org_id and i.question_id = q.id)
          as "usedIn"
      from assessment_question q
      where q.org_id = app_current_org() and q.institution_id = ${input.institutionId} and q.archived_at is null
        ${input.subject ? sql`and q.subject = ${input.subject}` : sql``}
        ${input.bloom ? sql`and q.bloom = ${input.bloom}` : sql``}
        ${input.difficulty ? sql`and q.difficulty = ${input.difficulty}` : sql``}
        ${like ? sql`and (q.prompt ilike ${like} or q.topic ilike ${like} or q.co_code ilike ${like})` : sql``}
      order by q.subject, q.topic nulls last, q.created_at
      limit 500`),
  );
}

function clean(q: QuestionInput): QuestionInput {
  const options = q.kind === 'mcq' ? q.options.map((o) => o.trim()).filter(Boolean) : [];
  const problem = questionProblem({ kind: q.kind, options, answer: q.answer });
  if (problem) throw new AssessmentError(problem === 'options' ? 'bad_options' : 'bad_answer');
  return {
    ...q,
    subject: q.subject.trim(),
    topic: q.topic?.trim() || null,
    prompt: q.prompt.trim(),
    options,
    answer: q.answer?.trim() || null,
    coCode: q.coCode?.trim().toUpperCase() || null,
  };
}

/** Adds a question, or changes one (papers already holding it keep their copy). */
export async function saveQuestion(
  deps: AssessmentDeps,
  actor: Actor,
  input: QuestionInput & { institutionId: string; id?: string | undefined },
): Promise<{ id: string }> {
  const q = clean(input);
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: PERMISSION, resource },
    async (tx) => {
      const values = sql`${q.subject}, ${q.topic}, ${q.kind}, ${q.prompt}, ${arr(q.options)}::text[], ${q.answer},
      ${q.marks}, ${q.difficulty}, ${q.bloom}, ${q.coCode}`;
      const rows = input.id
        ? await tx.execute<{ id: string }>(sql`
          update assessment_question set (subject, topic, kind, prompt, options, answer, marks, difficulty, bloom,
            co_code) = (${values})
          where org_id = app_current_org() and id = ${input.id} and institution_id = ${input.institutionId}
            and archived_at is null
          returning id::text`)
        : await tx.execute<{ id: string }>(sql`
          insert into assessment_question (org_id, institution_id, subject, topic, kind, prompt, options, answer,
            marks, difficulty, bloom, co_code, created_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${values}, ${actor.personId})
          returning id::text`);
      const row = rows[0];
      if (!row) throw new AssessmentError('question_not_found');
      return {
        result: row,
        audit: {
          action: input.id ? 'assessment.question.update' : 'assessment.question.create',
          entityType: 'assessment_question',
          entityId: row.id,
          dataClass: 'operational',
          detail: { subject: q.subject, bloom: q.bloom },
        },
      };
    },
  );
}

/** Takes a question out of the bank; papers that hold it keep their copy. */
export async function archiveQuestion(
  deps: AssessmentDeps,
  actor: Actor,
  input: { institutionId: string; id: string },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: PERMISSION, resource },
    async (tx) => {
      const rows = await tx.execute(sql`
      update assessment_question set archived_at = now()
      where org_id = app_current_org() and id = ${input.id} and institution_id = ${input.institutionId}
        and archived_at is null
      returning 1`);
      if (rows.length === 0) throw new AssessmentError('question_not_found');
      return {
        result: undefined,
        audit: {
          action: 'assessment.question.archive',
          entityType: 'assessment_question',
          entityId: input.id,
          dataClass: 'operational',
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Question papers
// ---------------------------------------------------------------------------------------------

export type PaperRow = {
  id: string;
  title: string;
  subject: string;
  minutes: number | null;
  state: 'draft' | 'final';
  questions: number;
  marks: number;
};
export type PaperItem = {
  position: number;
  questionId: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  answer: string | null;
  marks: number;
  difficulty: Difficulty;
  bloom: Bloom;
  coCode: string | null;
};
export type PaperDetail = Omit<PaperRow, 'questions' | 'marks'> & {
  instructions: string | null;
  institution: string;
  items: PaperItem[];
  blueprint: Blueprint;
};

export async function papers(
  deps: AssessmentDeps,
  actor: Actor,
  institutionId: string,
): Promise<PaperRow[]> {
  return reader(deps, actor, institutionId, (tx) =>
    tx.execute<PaperRow>(sql`
      select p.id::text, p.title, p.subject, p.minutes, p.state,
        count(i.position)::int as questions, coalesce(sum(i.marks), 0)::float as marks
      from assessment_paper p
      left join assessment_paper_item i on i.org_id = p.org_id and i.paper_id = p.id
      where p.org_id = app_current_org() and p.institution_id = ${institutionId}
      group by p.org_id, p.id
      order by (p.state = 'draft') desc, p.created_at desc
      limit 200`),
  );
}

export async function createPaper(
  deps: AssessmentDeps,
  actor: Actor,
  input: {
    institutionId: string;
    title: string;
    subject: string;
    minutes: number | null;
    instructions: string | null;
  },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: PERMISSION, resource },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into assessment_paper (org_id, institution_id, title, subject, minutes, instructions,
        created_by_person_id)
      values (app_current_org(), ${input.institutionId}, btrim(${input.title}), btrim(${input.subject}),
        ${input.minutes}, ${input.instructions?.trim() || null}, ${actor.personId})
      returning id::text`);
      if (!row) throw new Error('createPaper: no row');
      return {
        result: row,
        audit: {
          action: 'assessment.paper.create',
          entityType: 'assessment_paper',
          entityId: row.id,
          dataClass: 'operational',
        },
      };
    },
  );
}

async function paperAt(tx: Tx, institutionId: string, paperId: string, lock = false) {
  const [p] = await tx.execute<{
    id: string;
    title: string;
    subject: string;
    minutes: number | null;
    state: 'draft' | 'final';
    instructions: string | null;
    institution: string;
  }>(sql`
    select p.id::text, p.title, p.subject, p.minutes, p.state, p.instructions, i.name as institution
    from assessment_paper p join institution i on i.org_id = p.org_id and i.id = p.institution_id
    where p.org_id = app_current_org() and p.id = ${paperId} and p.institution_id = ${institutionId}
    ${lock ? sql`for update of p` : sql``}`);
  if (!p) throw new AssessmentError('paper_not_found');
  return p;
}

export async function paperDetail(
  deps: AssessmentDeps,
  actor: Actor,
  input: { institutionId: string; paperId: string },
): Promise<PaperDetail> {
  return reader(deps, actor, input.institutionId, async (tx) => {
    const p = await paperAt(tx, input.institutionId, input.paperId);
    const items = await tx.execute<PaperItem>(sql`
      select position, question_id::text as "questionId", kind, prompt, options, answer, marks::float as marks,
        difficulty, bloom, co_code as "coCode"
      from assessment_paper_item where org_id = app_current_org() and paper_id = ${p.id} order by position`);
    return { ...p, items, blueprint: blueprint(items) };
  });
}

/**
 * Sets a draft paper's questions in order. Questions already on it keep their copy; new ones are
 * copied from the bank as they are now.
 */
export async function setPaperQuestions(
  deps: AssessmentDeps,
  actor: Actor,
  input: { institutionId: string; paperId: string; questionIds: string[] },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: PERMISSION, resource },
    async (tx) => {
      const p = await paperAt(tx, input.institutionId, input.paperId, true);
      if (p.state === 'final') throw new AssessmentError('paper_final');
      const ids = [...new Set(input.questionIds)];
      const kept = await tx.execute<PaperItem>(sql`
      select position, question_id::text as "questionId", kind, prompt, options, answer, marks::float as marks,
        difficulty, bloom, co_code as "coCode"
      from assessment_paper_item where org_id = app_current_org() and paper_id = ${p.id}`);
      const have = new Map(kept.map((k) => [k.questionId, k]));
      const missing = ids.filter((id) => !have.has(id));
      const fresh = missing.length
        ? await tx.execute<PaperItem>(sql`
          select 0 as position, id::text as "questionId", kind, prompt, options, answer, marks::float as marks,
            difficulty, bloom, co_code as "coCode"
          from assessment_question
          where org_id = app_current_org() and institution_id = ${input.institutionId} and archived_at is null
            and id = any(${`{${missing.join(',')}}`}::uuid[])`)
        : [];
      for (const f of fresh) have.set(f.questionId, f);
      if (ids.some((id) => !have.has(id))) throw new AssessmentError('question_not_found');
      await tx.execute(
        sql`delete from assessment_paper_item where org_id = app_current_org() and paper_id = ${p.id}`,
      );
      let position = 0;
      for (const id of ids) {
        const q = have.get(id);
        if (!q) continue;
        await tx.execute(sql`
        insert into assessment_paper_item (org_id, paper_id, position, question_id, kind, prompt, options, answer,
          marks, difficulty, bloom, co_code)
        values (app_current_org(), ${p.id}, ${position++}, ${q.questionId}, ${q.kind}, ${q.prompt},
          ${arr(q.options)}::text[], ${q.answer}, ${q.marks}, ${q.difficulty}, ${q.bloom}, ${q.coCode})`);
      }
      return {
        result: undefined,
        audit: {
          action: 'assessment.paper.questions',
          entityType: 'assessment_paper',
          entityId: p.id,
          dataClass: 'operational',
          detail: { questions: ids.length },
        },
      };
    },
  );
}

/** Freezes a paper: its questions and marks can no longer change. */
export async function finalisePaper(
  deps: AssessmentDeps,
  actor: Actor,
  input: { institutionId: string; paperId: string },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: PERMISSION, resource },
    async (tx) => {
      const p = await paperAt(tx, input.institutionId, input.paperId, true);
      if (p.state === 'final') throw new AssessmentError('paper_final');
      const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from assessment_paper_item where org_id = app_current_org() and paper_id = ${p.id}`);
      if (!n?.n) throw new AssessmentError('empty_paper');
      await tx.execute(sql`
      update assessment_paper set state = 'final', finalised_at = now()
      where org_id = app_current_org() and id = ${p.id}`);
      return {
        result: undefined,
        audit: {
          action: 'assessment.paper.finalise',
          entityType: 'assessment_paper',
          entityId: p.id,
          dataClass: 'operational',
        },
      };
    },
  );
}
