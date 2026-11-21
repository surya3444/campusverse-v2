import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addAction,
  completeAction,
  createSurvey,
  setQuestions,
  setSurveyState,
  submitResponse,
  surveyResults,
  surveysToAnswer,
  type SurveyDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: SurveyDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let principal: Actor;
let staffA: Actor;
let staffB: Actor;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const at = () => ({ institutionId: t.institutionId });
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function staff(permissions: string[]) {
  const id = await seedAdmin(db, t.orgId, permissions);
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
      values (${t.orgId}, ${id}, ${t.institutionId}, 'staff', daterange(current_date - 1, null))`),
  );
  return id;
}

beforeAll(async () => {
  t = await seedTenant(db, 'Surveys');
  principal = actor(await seedAdmin(db, t.orgId, ['survey.form.manage', 'survey.response.submit']));
  staffA = actor(await staff(['survey.response.submit']));
  staffB = actor(await staff(['survey.response.submit']));
});
afterAll(() => close());

describe('feedback and surveys', () => {
  it('runs a survey: template, open, answer once anonymously, weighted results, actions', async () => {
    const { id } = await createSurvey(deps, principal, {
      ...at(),
      kind: 'facility',
      title: 'Facilities 2026',
      audience: 'staff',
      anonymous: true,
      opensOn: day(0),
      closesOn: day(14),
    });
    // Drafts aren't answerable; a staff survey isn't shown to the student audience.
    expect(await surveysToAnswer(deps, staffA, t.institutionId)).toEqual([]);
    await setSurveyState(deps, principal, { ...at(), surveyId: id, state: 'open' });
    await expect(
      setQuestions(deps, principal, { ...at(), surveyId: id, questions: [] }),
    ).rejects.toMatchObject({ code: 'not_draft' });

    const [open] = await surveysToAnswer(deps, staffA, t.institutionId);
    expect(open?.questions.map((q) => q.kind)).toEqual(['rating', 'rating', 'rating', 'text']);
    const qs = open!.questions;
    // Every rating needs an answer.
    await expect(
      submitResponse(deps, staffA, {
        ...at(),
        surveyId: id,
        answers: { [qs[0]!.id]: { rating: 5 } },
      }),
    ).rejects.toMatchObject({ code: 'bad_answer' });
    await submitResponse(deps, staffA, {
      ...at(),
      surveyId: id,
      answers: {
        [qs[0]!.id]: { rating: 4 },
        [qs[1]!.id]: { rating: 3 },
        [qs[2]!.id]: { rating: 2 },
        [qs[3]!.id]: { text: 'Fix the water cooler on floor 2' },
      },
    });
    await submitResponse(deps, staffB, {
      ...at(),
      surveyId: id,
      answers: {
        [qs[0]!.id]: { rating: 2 },
        [qs[1]!.id]: { rating: 5 },
        [qs[2]!.id]: { rating: 4 },
      },
    });
    // Once each, and no longer listed.
    await expect(
      submitResponse(deps, staffA, {
        ...at(),
        surveyId: id,
        answers: {
          [qs[0]!.id]: { rating: 1 },
          [qs[1]!.id]: { rating: 1 },
          [qs[2]!.id]: { rating: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: 'already_answered' });
    expect(await surveysToAnswer(deps, staffA, t.institutionId)).toEqual([]);
    // Anonymous: nothing on a response says who wrote it.
    const responses = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ who: string | null }>(sql`
        select respondent_person_id::text as who from survey_response where survey_id = ${id}`),
    );
    expect(responses.map((r) => r.who)).toEqual([null, null]);

    const r = await surveyResults(deps, principal, { ...at(), surveyId: id });
    expect(r.responses).toBe(2);
    expect(r.questions.map((q) => q.average)).toEqual([3, 4, 3, null]);
    // (3×1 + 4×1 + 3×2) / 4 = 3.25
    expect(r.score).toBe(3.25);
    expect(r.questions[3]?.comments).toEqual(['Fix the water cooler on floor 2']);
    expect(r.questions[0]?.counts).toMatchObject({ 2: 1, 4: 1 });

    await setSurveyState(deps, principal, { ...at(), surveyId: id, state: 'closed' });
    await expect(
      addAction(deps, principal, {
        ...at(),
        surveyId: id,
        title: 'Water',
        ownerId: t.studentId,
        dueOn: day(30),
      }),
    ).rejects.toMatchObject({ code: 'not_staff' });
    const { id: actionId } = await addAction(deps, principal, {
      ...at(),
      surveyId: id,
      title: 'Replace the floor 2 water cooler',
      ownerId: staffA.personId,
      dueOn: day(30),
    });
    await completeAction(deps, principal, { ...at(), actionId, outcome: 'Replaced on 20 Nov.' });
    const after = await surveyResults(deps, principal, { ...at(), surveyId: id });
    expect(after.actions[0]).toMatchObject({ state: 'done', outcome: 'Replaced on 20 Nov.' });
  });

  it('only the coordinator sees results; a closed survey takes no answers', async () => {
    const { id } = await createSurvey(deps, principal, {
      ...at(),
      kind: 'other',
      title: 'Quick pulse',
      audience: 'staff',
      anonymous: false,
      opensOn: day(0),
      closesOn: day(1),
    });
    await expect(surveyResults(deps, staffA, { ...at(), surveyId: id })).rejects.toThrow();
    await expect(
      submitResponse(deps, staffA, { ...at(), surveyId: id, answers: {} }),
    ).rejects.toMatchObject({ code: 'not_open' });
  });
});
