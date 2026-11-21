// Academics › Feedback & Surveys (rule book §13.4; docs/specs/SURVEYS.md). A coordinator builds a
// survey from a template, opens it for dates to staff, parents or students; each person answers
// once (anonymously unless the survey says otherwise); results are averaged and weighted; actions
// taken get owners and due dates for the NAAC action-taken report. People from people/records.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, isGuardianAt, memberKind } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  TEMPLATES,
  answerFits,
  weightedScore,
  type Answer,
  type Audience,
  type Question,
  type SurveyKind,
} from '../domain/surveys.js';

type Permissions = ReturnType<typeof createPermissions>;
export type SurveyDeps = { db: Db; permissions: Permissions };

export class SurveyError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'survey_not_found'
      | 'not_draft'
      | 'not_open'
      | 'not_in_audience'
      | 'already_answered'
      | 'bad_answer'
      | 'no_questions'
      | 'action_not_found'
      | 'not_staff',
  ) {
    super(`survey: ${code}`);
    this.name = 'SurveyError';
  }
}

async function placeRes(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new SurveyError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}
const resAt = (deps: SurveyDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => placeRes(tx, actor, institutionId));
const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

type SurveyHead = {
  id: string;
  kind: SurveyKind;
  title: string;
  audience: Audience;
  anonymous: boolean;
  opensOn: string;
  closesOn: string;
  state: 'draft' | 'open' | 'closed';
};
async function surveyAt(tx: Tx, institutionId: string, surveyId: string, lock = false) {
  const [s] = await tx.execute<SurveyHead>(sql`
    select id::text, kind, title, audience, anonymous, opens_on::text as "opensOn",
      closes_on::text as "closesOn", state
    from survey where org_id = app_current_org() and id = ${surveyId} and institution_id = ${institutionId}
    ${lock ? sql`for update` : sql``}`);
  if (!s) throw new SurveyError('survey_not_found');
  return s;
}
async function questionsOf(tx: Tx, surveyId: string) {
  return tx.execute<Question & { id: string }>(sql`
    select id::text, kind, prompt, options, weight::float as weight from survey_question
    where org_id = app_current_org() and survey_id = ${surveyId} order by position`);
}
async function inAudience(tx: Tx, institutionId: string, audience: Audience, personId: string) {
  if (audience === 'parents') return isGuardianAt(tx, personId, institutionId);
  const kind = await memberKind(tx, { institutionId, personId, onDate: await today(tx) });
  return kind === (audience === 'staff' ? 'staff' : 'student');
}

// ---------------------------------------------------------------------------------------------
// Building and running (the coordinator)
// ---------------------------------------------------------------------------------------------

export type SurveyRow = SurveyHead & { questions: number; responses: number; openActions: number };

export async function surveys(
  deps: SurveyDeps,
  actor: Actor,
  institutionId: string,
): Promise<SurveyRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'survey.form.manage',
      await placeRes(tx, actor, institutionId),
    );
    return tx.execute<SurveyRow>(sql`
      select s.id::text, s.kind, s.title, s.audience, s.anonymous, s.opens_on::text as "opensOn",
        s.closes_on::text as "closesOn", s.state,
        (select count(*)::int from survey_question q where q.org_id = s.org_id and q.survey_id = s.id) as questions,
        (select count(*)::int from survey_response r where r.org_id = s.org_id and r.survey_id = s.id) as responses,
        (select count(*)::int from survey_action a where a.org_id = s.org_id and a.survey_id = s.id
          and a.state = 'open') as "openActions"
      from survey s where s.org_id = app_current_org() and s.institution_id = ${institutionId}
      order by (s.state = 'open') desc, s.created_at desc limit 200`);
  });
}

/** A new draft survey with the template's questions, ready to edit. */
export async function createSurvey(
  deps: SurveyDeps,
  actor: Actor,
  input: {
    institutionId: string;
    kind: SurveyKind;
    title: string;
    audience: Audience;
    anonymous: boolean;
    opensOn: string;
    closesOn: string;
  },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.form.manage', resource },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into survey (org_id, institution_id, kind, title, audience, anonymous, opens_on, closes_on,
        created_by_person_id)
      values (app_current_org(), ${input.institutionId}, ${input.kind}, btrim(${input.title}), ${input.audience},
        ${input.anonymous}, ${input.opensOn}::date, ${input.closesOn}::date, ${actor.personId})
      returning id::text`);
      if (!row) throw new Error('createSurvey: no row');
      await writeQuestions(tx, row.id, TEMPLATES[input.kind]);
      return {
        result: row,
        audit: {
          action: 'survey.form.create',
          entityType: 'survey',
          entityId: row.id,
          dataClass: 'operational',
          detail: { kind: input.kind, audience: input.audience },
        },
      };
    },
  );
}

async function writeQuestions(tx: Tx, surveyId: string, questions: Question[]) {
  await tx.execute(
    sql`delete from survey_question where org_id = app_current_org() and survey_id = ${surveyId}`,
  );
  let position = 0;
  for (const q of questions) {
    const options = `{${q.options.map((o) => `"${o.replace(/["\\]/g, '')}"`).join(',')}}`;
    await tx.execute(sql`
      insert into survey_question (org_id, survey_id, position, kind, prompt, options, weight)
      values (app_current_org(), ${surveyId}, ${position++}, ${q.kind}, btrim(${q.prompt}),
        ${options}::text[], ${q.kind === 'rating' ? q.weight : 0})`);
  }
}

/** Replaces a draft's questions. */
export async function setQuestions(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; surveyId: string; questions: Question[] },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.form.manage', resource },
    async (tx) => {
      const s = await surveyAt(tx, input.institutionId, input.surveyId, true);
      if (s.state !== 'draft') throw new SurveyError('not_draft');
      if (!input.questions.some((q) => q.kind === 'rating')) throw new SurveyError('no_questions');
      await writeQuestions(tx, input.surveyId, input.questions);
      return {
        result: undefined,
        audit: {
          action: 'survey.form.questions',
          entityType: 'survey',
          entityId: input.surveyId,
          dataClass: 'operational',
          detail: { questions: input.questions.length },
        },
      };
    },
  );
}

/** Opens a draft for answers, or closes an open survey. */
export async function setSurveyState(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; surveyId: string; state: 'open' | 'closed' },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.form.manage', resource },
    async (tx) => {
      const s = await surveyAt(tx, input.institutionId, input.surveyId, true);
      if (input.state === 'open' && s.state !== 'draft') throw new SurveyError('not_draft');
      if (input.state === 'closed' && s.state !== 'open') throw new SurveyError('not_open');
      if (input.state === 'open' && (await questionsOf(tx, s.id)).length === 0)
        throw new SurveyError('no_questions');
      await tx.execute(sql`
      update survey set state = ${input.state} where org_id = app_current_org() and id = ${input.surveyId}`);
      return {
        result: undefined,
        audit: {
          action: `survey.form.${input.state === 'open' ? 'open' : 'close'}`,
          entityType: 'survey',
          entityId: input.surveyId,
          dataClass: 'operational',
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Answering (anyone in the audience)
// ---------------------------------------------------------------------------------------------

export type SurveyToAnswer = SurveyHead & { questions: (Question & { id: string })[] };

/** Open surveys for this person's audience that they haven't answered yet, within their dates. */
export async function surveysToAnswer(
  deps: SurveyDeps,
  actor: Actor,
  institutionId: string,
): Promise<SurveyToAnswer[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'survey.response.submit',
      await placeRes(tx, actor, institutionId),
    );
    const open = await tx.execute<SurveyHead>(sql`
      select s.id::text, s.kind, s.title, s.audience, s.anonymous, s.opens_on::text as "opensOn",
        s.closes_on::text as "closesOn", s.state
      from survey s where s.org_id = app_current_org() and s.institution_id = ${institutionId}
        and s.state = 'open' and app_today() between s.opens_on and s.closes_on
        and not exists (select 1 from survey_receipt r where r.org_id = s.org_id and r.survey_id = s.id
          and r.person_id = ${actor.personId})
      order by s.closes_on`);
    const out: SurveyToAnswer[] = [];
    for (const s of open)
      if (await inAudience(tx, institutionId, s.audience, actor.personId))
        out.push({ ...s, questions: await questionsOf(tx, s.id) });
    return out;
  });
}

/** Answers a survey once. Every rating question needs a rating; the rest are optional. */
export async function submitResponse(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; surveyId: string; answers: Record<string, Answer> },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.response.submit', resource },
    async (tx) => {
      const s = await surveyAt(tx, input.institutionId, input.surveyId);
      const [inDates] = await tx.execute<{ ok: boolean }>(sql`
      select app_today() between ${s.opensOn}::date and ${s.closesOn}::date as ok`);
      if (s.state !== 'open' || !inDates?.ok) throw new SurveyError('not_open');
      if (!(await inAudience(tx, input.institutionId, s.audience, actor.personId)))
        throw new SurveyError('not_in_audience');
      const qs = await questionsOf(tx, s.id);
      for (const q of qs)
        if (!answerFits(q, input.answers[q.id])) throw new SurveyError('bad_answer');
      const receipt = await tx.execute(sql`
      insert into survey_receipt (org_id, survey_id, person_id) values (app_current_org(), ${s.id}, ${actor.personId})
      on conflict do nothing returning 1`);
      if (receipt.length === 0) throw new SurveyError('already_answered');
      const [r] = await tx.execute<{ id: string }>(sql`
      insert into survey_response (org_id, survey_id, submitted_on, respondent_person_id)
      values (app_current_org(), ${s.id}, app_today(), ${s.anonymous ? null : actor.personId})
      returning id::text`);
      for (const q of qs) {
        const a = input.answers[q.id];
        const body = a?.text?.trim() || null;
        if (q.kind !== 'rating' && !a?.choice && !body) continue;
        await tx.execute(sql`
        insert into survey_answer (org_id, response_id, question_id, rating, choice, body)
        values (app_current_org(), ${r?.id}, ${q.id}, ${q.kind === 'rating' ? (a?.rating ?? null) : null},
          ${q.kind === 'choice' ? (a?.choice ?? null) : null}, ${q.kind === 'text' ? body : null})`);
      }
      return {
        result: undefined,
        // Never the answers, and for an anonymous survey nothing that links the person to them.
        audit: {
          action: 'survey.response.submit',
          entityType: 'survey',
          entityId: s.id,
          dataClass: 'operational',
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Results and actions taken (the coordinator)
// ---------------------------------------------------------------------------------------------

export type QuestionResult = {
  id: string;
  kind: Question['kind'];
  prompt: string;
  options: string[];
  weight: number;
  answered: number;
  average: number | null;
  /** Ratings 1–5, or choice counts by option. */
  counts: Record<string, number>;
  comments: string[];
};
export type ActionRow = {
  id: string;
  title: string;
  ownerId: string;
  owner: string;
  dueOn: string;
  state: 'open' | 'done';
  outcome: string | null;
  doneOn: string | null;
};
export type SurveyResults = SurveyHead & {
  responses: number;
  score: number | null;
  questions: QuestionResult[];
  actions: ActionRow[];
};

export async function surveyResults(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; surveyId: string },
): Promise<SurveyResults> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'survey.form.manage',
      await placeRes(tx, actor, input.institutionId),
    );
    const s = await surveyAt(tx, input.institutionId, input.surveyId);
    const qs = await questionsOf(tx, s.id);
    const answers = await tx.execute<{
      q: string;
      rating: number | null;
      choice: string | null;
      body: string | null;
    }>(sql`
      select a.question_id::text as q, a.rating, a.choice, a.body from survey_answer a
      join survey_response r on r.org_id = a.org_id and r.id = a.response_id
      where a.org_id = app_current_org() and r.survey_id = ${s.id}`);
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from survey_response where org_id = app_current_org() and survey_id = ${s.id}`);
    const questions = qs.map((q): QuestionResult => {
      const mine = answers.filter((a) => a.q === q.id);
      const ratings = mine.flatMap((a) => (a.rating ? [a.rating] : []));
      const counts: Record<string, number> = {};
      if (q.kind === 'rating')
        for (const v of [1, 2, 3, 4, 5]) counts[v] = ratings.filter((r) => r === v).length;
      if (q.kind === 'choice')
        for (const o of q.options) counts[o] = mine.filter((a) => a.choice === o).length;
      return {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options,
        weight: q.weight,
        answered: mine.length,
        average: ratings.length
          ? Math.round((ratings.reduce((x, y) => x + y, 0) / ratings.length) * 100) / 100
          : null,
        counts,
        // Newest feedback is the most useful; at most 100 comments shown.
        comments: mine
          .flatMap((a) => (a.body ? [a.body] : []))
          .slice(-100)
          .reverse(),
      };
    });
    const actions = await tx.execute<Omit<ActionRow, 'owner'>>(sql`
      select id::text, title, owner_person_id::text as "ownerId", due_on::text as "dueOn", state, outcome,
        done_on::text as "doneOn"
      from survey_action where org_id = app_current_org() and survey_id = ${s.id} order by state, due_on`);
    const names = await displayNames(
      tx,
      actions.map((a) => a.ownerId),
    );
    return {
      ...s,
      responses: n?.n ?? 0,
      score: weightedScore(questions.filter((q) => q.kind === 'rating')),
      questions,
      actions: actions.map((a) => ({ ...a, owner: names[a.ownerId] ?? '' })),
    };
  });
}

/** An action the institution will take on the feedback, with an owner on staff and a date. */
export async function addAction(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; surveyId: string; title: string; ownerId: string; dueOn: string },
): Promise<{ id: string }> {
  const resource = await resAt(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.form.manage', resource },
    async (tx) => {
      await surveyAt(tx, input.institutionId, input.surveyId);
      if (
        (await memberKind(tx, {
          institutionId: input.institutionId,
          personId: input.ownerId,
          onDate: await today(tx),
        })) !== 'staff'
      )
        throw new SurveyError('not_staff');
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into survey_action (org_id, survey_id, title, owner_person_id, due_on)
      values (app_current_org(), ${input.surveyId}, btrim(${input.title}), ${input.ownerId}, ${input.dueOn}::date)
      returning id::text`);
      if (!row) throw new Error('addAction: no row');
      return {
        result: row,
        audit: {
          action: 'survey.action.add',
          entityType: 'survey',
          entityId: input.surveyId,
          dataClass: 'operational',
        },
      };
    },
  );
}

/** Marks an action done with what was done: the evidence for the action-taken report. */
export async function completeAction(
  deps: SurveyDeps,
  actor: Actor,
  input: { institutionId: string; actionId: string; outcome: string },
): Promise<void> {
  const resource = await resAt(deps, actor, input.institutionId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'survey.form.manage', resource },
    async (tx) => {
      const done = await tx.execute<{ surveyId: string }>(sql`
      update survey_action a set state = 'done', outcome = btrim(${input.outcome}), done_on = app_today()
      from survey s
      where a.org_id = app_current_org() and a.id = ${input.actionId} and a.state = 'open'
        and s.org_id = a.org_id and s.id = a.survey_id and s.institution_id = ${input.institutionId}
      returning a.survey_id::text as "surveyId"`);
      if (done.length === 0) throw new SurveyError('action_not_found');
      return {
        result: undefined,
        audit: {
          action: 'survey.action.done',
          entityType: 'survey',
          entityId: done[0]?.surveyId ?? '',
          dataClass: 'operational',
          detail: { actionId: input.actionId },
        },
      };
    },
  );
}
