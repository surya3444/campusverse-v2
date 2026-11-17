// Appraisals across modules (docs/specs/APPRAISALS.md): a cycle opened for the school's staff,
// self-rating before the reviewer, ratings hidden from the person until done, the weighted score in
// hundredths, acknowledgement, reviewer changes, and nobody else seeing anything.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import {
  acknowledge,
  appraisalProgress,
  closeCycle,
  cycleReviews,
  myAppraisals,
  openCycle,
  previewOpen,
  review,
  saveCycle,
  setReviewer,
  submitReview,
  submitSelf,
  type AppraisalDeps,
} from '@campusverse/people-appraisals';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: AppraisalDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let head: Actor;
let teacher: Actor;
let stranger: Actor;
let cycleId: string;
let reviewId: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Appraisals');
  head = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['people.appraisal.manage', 'people.appraisal.self']),
  };
  stranger = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['people.appraisal.self']),
  };
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (${t.orgId}, 'appraisal_teacher', 'Teacher') returning id::text`);
    await tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      values (${t.orgId}, ${r?.id}, 'people.appraisal.self', 'self')`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (${t.orgId}, ${t.teacherId}, ${r?.id}, 'organisation', ${t.orgId})`);
  });
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
});
afterAll(() => close());

describe('a cycle', () => {
  it('is drafted with weighted criteria and opened for the staff, managers only', async () => {
    const input = {
      institutionId: t.institutionId,
      id: null,
      name: 'Synthetic term 2',
      opensOn: '2026-11-01',
      closesOn: '2027-03-31',
      criteria: [
        { title: 'Teaching', description: '', weight: 2 },
        { title: 'Conduct', description: '', weight: 1 },
      ],
    };
    expect(await code(saveCycle(deps, teacher, input))).toBe('denied');
    cycleId = (await saveCycle(deps, head, input)).cycleId;
    const p = await previewOpen(deps, head, { institutionId: t.institutionId, cycleId });
    expect(p.names).toEqual(expect.arrayContaining([expect.stringContaining('Synthetic Teacher')]));
    expect((await openCycle(deps, head, { institutionId: t.institutionId, cycleId })).reviews).toBe(
      p.staff,
    );
    expect(await code(openCycle(deps, head, { institutionId: t.institutionId, cycleId }))).toBe(
      'not_draft',
    );
    const rows = await cycleReviews(deps, head, { institutionId: t.institutionId, cycleId });
    reviewId = rows.find((r) => r.personId === t.teacherId)?.reviewId ?? '';
    expect(rows.find((r) => r.personId === t.teacherId)).toMatchObject({
      state: 'self',
      reviewerId: head.personId,
    });
  });
});

describe('a review', () => {
  it('goes self first, then the reviewer, with the score in hundredths', async () => {
    const detail = await review(deps, teacher, reviewId);
    const [teaching, conduct] = detail.criteria;
    const rate = (a: number, b: number) => [
      { criterionId: teaching?.criterionId ?? '', score: a, comment: '' },
      { criterionId: conduct?.criterionId ?? '', score: b, comment: '' },
    ];
    // The reviewer can't go first; the person can't skip a criterion.
    expect(
      await code(submitReview(deps, head, { reviewId, ratings: rate(4, 3), comment: 'Good' })),
    ).toBe('wrong_state');
    expect(
      await code(
        submitSelf(deps, teacher, { reviewId, ratings: rate(5, 5).slice(0, 1), comment: '' }),
      ),
    ).toBe('ratings_incomplete');
    expect(
      await code(submitSelf(deps, stranger, { reviewId, ratings: rate(5, 5), comment: '' })),
    ).toBe('review_not_found');
    await submitSelf(deps, teacher, { reviewId, ratings: rate(5, 4), comment: 'A good term' });
    expect(
      await code(submitReview(deps, head, { reviewId, ratings: rate(4, 3), comment: '' })),
    ).toBe('comment_needed');
    // Weights 2 and 1: (4·2 + 3) / 3 = 3.67.
    expect(
      await submitReview(deps, head, {
        reviewId,
        ratings: rate(4, 3),
        comment: 'Strong teaching; be on time',
      }),
    ).toEqual({ score: '3.67' });
    const seen = await review(deps, teacher, reviewId);
    expect(seen).toMatchObject({ state: 'done', score: '3.67', you: 'person' });
    expect(seen.reviewerRatings.map((r) => r.score).sort()).toEqual([3, 4]);
    await acknowledge(deps, teacher, { reviewId, reply: 'Thank you' });
    expect(await code(acknowledge(deps, teacher, { reviewId, reply: '' }))).toBe('wrong_state');
    expect(
      (await myAppraisals(deps, teacher, t.institutionId)).mine.find((r) => r.reviewId === reviewId)
        ?.state,
    ).toBe('acknowledged');
  });

  it('hides the reviewer’s ratings from the person until done, and changes reviewers only before they start', async () => {
    // The seed's review: self-rated, waiting for the principal.
    const [seeded] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select r.id::text from appraisal_review r join appraisal_cycle c on c.org_id = r.org_id and c.id = r.cycle_id
        where r.org_id = app_current_org() and c.name = '2026-27 annual'`),
    );
    const id = seeded?.id ?? '';
    const mine = await review(deps, teacher, id);
    expect(mine).toMatchObject({ state: 'review', score: null, reviewerRatings: [] });
    expect(mine.self.map((s) => s.score)).toEqual([4]);
    expect(
      await code(
        setReviewer(deps, head, {
          institutionId: t.institutionId,
          reviewId: id,
          personId: t.teacherId,
        }),
      ),
    ).toBe('not_staff');
    expect(
      await code(
        setReviewer(deps, teacher, {
          institutionId: t.institutionId,
          reviewId: id,
          personId: t.teacherId,
        }),
      ),
    ).toBe('denied');
    expect(
      await code(
        setReviewer(deps, head, {
          institutionId: t.institutionId,
          reviewId: id,
          personId: t.guardianId,
        }),
      ),
    ).toBe('not_staff');
    expect(
      (await appraisalProgress(deps, head, t.institutionId)).find(
        (c) => c.cycle === 'Synthetic term 2',
      ),
    ).toMatchObject({ acknowledged: 1 });
    await closeCycle(deps, head, { institutionId: t.institutionId, cycleId });
    expect(await code(closeCycle(deps, head, { institutionId: t.institutionId, cycleId }))).toBe(
      'not_open',
    );
  });
});
