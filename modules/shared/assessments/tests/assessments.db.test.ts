import { loadEnv } from '@campusverse/config';
import { createDb } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  archiveQuestion,
  createPaper,
  finalisePaper,
  paperDetail,
  papers,
  questions,
  saveQuestion,
  setPaperQuestions,
  subjects,
  type AssessmentDeps,
  type QuestionInput,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: AssessmentDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let teacher: Actor;
let outsider: Actor;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const at = () => ({ institutionId: t.institutionId });
const q = (over: Partial<QuestionInput>): QuestionInput & { institutionId: string } => ({
  ...at(),
  subject: 'Physics',
  topic: 'Motion',
  kind: 'long',
  prompt: 'Derive the equations of motion.',
  options: [],
  answer: null,
  marks: 5,
  difficulty: 'medium',
  bloom: 'apply',
  coCode: null,
  ...over,
});

beforeAll(async () => {
  t = await seedTenant(db, 'Assessments');
  teacher = actor(await seedAdmin(db, t.orgId, ['assessment.bank.manage']));
  outsider = actor(await seedAdmin(db, t.orgId, []));
});
afterAll(() => close());

describe('question bank and papers', () => {
  it('keeps a tagged bank and refuses bad multiple-choice questions', async () => {
    await expect(
      saveQuestion(deps, teacher, q({ kind: 'mcq', options: ['3 m/s'], answer: '3 m/s' })),
    ).rejects.toMatchObject({ code: 'bad_options' });
    await expect(
      saveQuestion(deps, teacher, q({ kind: 'mcq', options: ['3 m/s', '9 m/s'], answer: '6 m/s' })),
    ).rejects.toMatchObject({ code: 'bad_answer' });
    await saveQuestion(
      deps,
      teacher,
      q({
        kind: 'mcq',
        prompt: 'A car goes 30 m in 10 s. Its speed?',
        options: ['3 m/s', ' 300 m/s ', ''],
        answer: '3 m/s',
        marks: 1,
        difficulty: 'easy',
        bloom: 'remember',
        coCode: 'co1',
      }),
    );
    const list = await questions(deps, teacher, { ...at(), subject: 'Physics' });
    expect(list[0]).toMatchObject({ options: ['3 m/s', '300 m/s'], coCode: 'CO1', usedIn: 0 });
    expect(await questions(deps, teacher, { ...at(), search: '30 m in' })).toHaveLength(1);
    expect(await subjects(deps, teacher, t.institutionId)).toContain('Physics');
    await expect(subjects(deps, outsider, t.institutionId)).rejects.toThrow();
  });

  it('builds a paper from copies, shows its blueprint and freezes it when final', async () => {
    const { id: longId } = await saveQuestion(deps, teacher, q({ coCode: 'CO2' }));
    const { id: shortId } = await saveQuestion(
      deps,
      teacher,
      q({ kind: 'short', prompt: 'State Newton’s first law.', marks: 2, bloom: 'understand' }),
    );
    const { id } = await createPaper(deps, teacher, {
      ...at(),
      title: 'Unit test 1',
      subject: 'Physics',
      minutes: 40,
      instructions: 'Answer all questions.',
    });
    await expect(finalisePaper(deps, teacher, { ...at(), paperId: id })).rejects.toMatchObject({
      code: 'empty_paper',
    });
    await setPaperQuestions(deps, teacher, {
      ...at(),
      paperId: id,
      questionIds: [shortId, longId],
    });
    // A later bank edit doesn't change the paper's copy.
    await saveQuestion(deps, teacher, { ...q({ coCode: 'CO2', marks: 8 }), id: longId });
    const p = await paperDetail(deps, teacher, { ...at(), paperId: id });
    expect(p.items.map((i) => [i.prompt, i.marks])).toEqual([
      ['State Newton’s first law.', 2],
      ['Derive the equations of motion.', 5],
    ]);
    expect(p.blueprint).toMatchObject({ marks: 7, noCo: 1, higherOrder: 71 });
    expect(p.blueprint.co).toEqual([{ code: 'CO2', marks: 5 }]);

    // Reordering keeps the copies; archiving a used question leaves the paper alone.
    await setPaperQuestions(deps, teacher, {
      ...at(),
      paperId: id,
      questionIds: [longId, shortId],
    });
    await archiveQuestion(deps, teacher, { ...at(), id: longId });
    const again = await paperDetail(deps, teacher, { ...at(), paperId: id });
    expect(again.items.map((i) => i.marks)).toEqual([5, 2]);

    await finalisePaper(deps, teacher, { ...at(), paperId: id });
    await expect(
      setPaperQuestions(deps, teacher, { ...at(), paperId: id, questionIds: [shortId] }),
    ).rejects.toMatchObject({ code: 'paper_final' });
    expect((await papers(deps, teacher, t.institutionId)).find((x) => x.id === id)).toMatchObject({
      state: 'final',
      questions: 2,
      marks: 7,
    });
  });
});
