// Appraisals (docs/specs/APPRAISALS.md): cycles with weighted criteria, opened for every staff
// member (preview, then commit); self-rating, then the reviewer's rating and the exact weighted
// score, then acknowledgement. Private: the person, their reviewer and appraisal managers only.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, memberKind, staffAt } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
  type Resource,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { completeRatings, fromHundredths, weightedScore } from '../domain/appraisals.js';

type Permissions = ReturnType<typeof createPermissions>;
export type AppraisalDeps = { db: Db; permissions: Permissions };

export const REVIEWED = 'people.appraisal.reviewed.v1';
export const DEFAULT_CRITERIA = [
  'Subject knowledge and teaching',
  'Classroom management',
  'Student progress',
  'Punctuality and attendance',
  'Teamwork and conduct',
  'Communication with parents',
];

export class AppraisalError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'cycle_not_found'
      | 'not_draft'
      | 'not_open'
      | 'no_criteria'
      | 'no_staff'
      | 'review_not_found'
      | 'wrong_state'
      | 'ratings_incomplete'
      | 'comment_needed'
      | 'not_staff'
      | 'reviewer_started',
  ) {
    super(`appraisals: ${code}`);
    this.name = 'AppraisalError';
  }
}

export type State = 'self' | 'review' | 'done' | 'acknowledged';

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new AppraisalError('institution_not_found');
  return p;
}
const res = (actor: Actor, p: Resource['place'] | null, subjectPersonId?: string): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
  ...(subjectPersonId ? { subjectPersonId } : {}),
});
const manageAt = async (deps: AppraisalDeps, actor: Actor, institutionId: string) => ({
  permission: 'people.appraisal.manage',
  resource: await withTenant(deps.db, actor.orgId, async (tx) =>
    res(actor, await place(tx, institutionId)),
  ),
});
/** Acting as oneself: one's own review, or one where one is the reviewer (checked in the step). */
async function selfCheck(deps: AppraisalDeps, actor: Actor, reviewId: string) {
  // At the review's school: staff roles are usually scoped to it.
  const p = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{ institutionId: string }>(sql`
      select c.institution_id::text as "institutionId" from appraisal_review r
      join appraisal_cycle c on c.org_id = r.org_id and c.id = r.cycle_id
      where r.org_id = app_current_org() and r.id = ${reviewId}`);
    if (!c) throw new AppraisalError('review_not_found');
    return place(tx, c.institutionId);
  });
  return { permission: 'people.appraisal.self', resource: res(actor, p, actor.personId) };
}

async function cycleOf(tx: Tx, cycleId: string) {
  const [c] = await tx.execute<{
    institutionId: string;
    state: 'draft' | 'open' | 'closed';
    createdBy: string;
  }>(sql`
    select institution_id::text as "institutionId", state, created_by_person_id::text as "createdBy"
    from appraisal_cycle where org_id = app_current_org() and id = ${cycleId} for update`);
  if (!c) throw new AppraisalError('cycle_not_found');
  return c;
}

// ---------------------------------------------------------------------------------------------
// Cycles (managers)
// ---------------------------------------------------------------------------------------------

export type Criterion = {
  criterionId: string;
  position: number;
  title: string;
  description: string;
  weight: number;
};
export type CycleRow = {
  cycleId: string;
  name: string;
  opensOn: string;
  closesOn: string;
  state: 'draft' | 'open' | 'closed';
  criteria: Criterion[];
  counts: Record<State, number>;
};

const toCriterion = (c: Criterion): Criterion => ({
  criterionId: c.criterionId,
  position: c.position,
  title: c.title,
  description: c.description,
  weight: c.weight,
});

async function criteriaOf(tx: Tx, cycleIds: string[]) {
  if (cycleIds.length === 0) return [];
  return tx.execute<Criterion & { cycleId: string }>(sql`
    select id::text as "criterionId", cycle_id::text as "cycleId", position, title, description, weight
    from appraisal_criterion where org_id = app_current_org() and cycle_id = any(${`{${cycleIds.join(',')}}`}::uuid[])
    order by position`);
}

export async function cycles(
  deps: AppraisalDeps,
  actor: Actor,
  institutionId: string,
): Promise<CycleRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'people.appraisal.manage',
      res(actor, await place(tx, institutionId)),
    );
    const rows = await tx.execute<Omit<CycleRow, 'criteria' | 'counts'>>(sql`
      select id::text as "cycleId", name, opens_on::text as "opensOn", closes_on::text as "closesOn", state
      from appraisal_cycle where org_id = app_current_org() and institution_id = ${institutionId}
      order by opens_on desc, created_at desc`);
    const crit = await criteriaOf(
      tx,
      rows.map((r) => r.cycleId),
    );
    const counts = await tx.execute<{ cycleId: string; state: State; n: number }>(sql`
      select cycle_id::text as "cycleId", state, count(*)::int as n from appraisal_review
      where org_id = app_current_org() and cycle_id = any(${`{${rows.map((r) => r.cycleId).join(',')}}`}::uuid[])
      group by cycle_id, state`);
    return rows.map((r) => ({
      ...r,
      criteria: crit.filter((c) => c.cycleId === r.cycleId).map(toCriterion),
      counts: {
        self: 0,
        review: 0,
        done: 0,
        acknowledged: 0,
        ...Object.fromEntries(
          counts.filter((c) => c.cycleId === r.cycleId).map((c) => [c.state, c.n]),
        ),
      },
    }));
  });
}

export type CycleInput = {
  institutionId: string;
  id: string | null;
  name: string;
  opensOn: string;
  closesOn: string;
  criteria: { title: string; description: string; weight: number }[];
};

/** Creates a draft cycle, or edits one while it's a draft (criteria replaced). */
export async function saveCycle(
  deps: AppraisalDeps,
  actor: Actor,
  input: CycleInput,
): Promise<{ cycleId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    await manageAt(deps, actor, input.institutionId),
    async (tx) => {
      if (input.criteria.length === 0) throw new AppraisalError('no_criteria');
      let cycleId = input.id;
      if (cycleId) {
        const c = await cycleOf(tx, cycleId);
        if (c.institutionId !== input.institutionId) throw new AppraisalError('cycle_not_found');
        if (c.state !== 'draft') throw new AppraisalError('not_draft');
        await tx.execute(sql`
        update appraisal_cycle set name = ${input.name.trim()}, opens_on = ${input.opensOn}::date,
          closes_on = ${input.closesOn}::date where org_id = app_current_org() and id = ${cycleId}`);
        await tx.execute(
          sql`delete from appraisal_criterion where org_id = app_current_org() and cycle_id = ${cycleId}`,
        );
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
        insert into appraisal_cycle (org_id, institution_id, name, opens_on, closes_on, created_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.name.trim()}, ${input.opensOn}::date,
          ${input.closesOn}::date, ${actor.personId})
        returning id::text`);
        cycleId = row?.id ?? '';
      }
      for (const [i, c] of input.criteria.entries())
        await tx.execute(sql`
        insert into appraisal_criterion (org_id, cycle_id, position, title, description, weight)
        values (app_current_org(), ${cycleId}, ${i + 1}, ${c.title.trim()}, ${c.description.trim()}, ${c.weight})`);
      return {
        result: { cycleId },
        audit: {
          action: 'people.appraisal.cycle_save',
          entityType: 'appraisal_cycle',
          entityId: cycleId,
          dataClass: 'operational',
          detail: { name: input.name.trim(), criteria: input.criteria.length },
        },
      };
    },
  );
}

/** Who would get a review if the cycle opened now: every staff member but the person opening it. */
async function openTargets(tx: Tx, institutionId: string, actor: Actor) {
  return (await staffAt(tx, institutionId, await today(tx))).filter(
    (s) => s.personId !== actor.personId,
  );
}

export async function previewOpen(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; cycleId: string },
): Promise<{ staff: number; names: string[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'people.appraisal.manage',
      res(actor, await place(tx, input.institutionId)),
    );
    const c = await cycleOf(tx, input.cycleId);
    if (c.institutionId !== input.institutionId) throw new AppraisalError('cycle_not_found');
    const staff = await openTargets(tx, input.institutionId, actor);
    return { staff: staff.length, names: staff.slice(0, 20).map((s) => s.name) };
  });
}

/** Opens a draft cycle: a review for every staff member, reviewed by the person opening it. */
export async function openCycle(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; cycleId: string },
): Promise<{ reviews: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    await manageAt(deps, actor, input.institutionId),
    async (tx) => {
      const c = await cycleOf(tx, input.cycleId);
      if (c.institutionId !== input.institutionId) throw new AppraisalError('cycle_not_found');
      if (c.state !== 'draft') throw new AppraisalError('not_draft');
      const [crit] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from appraisal_criterion where org_id = app_current_org() and cycle_id = ${input.cycleId}`);
      if (!crit?.n) throw new AppraisalError('no_criteria');
      const staff = await openTargets(tx, input.institutionId, actor);
      if (staff.length === 0) throw new AppraisalError('no_staff');
      for (const s of staff)
        await tx.execute(sql`
        insert into appraisal_review (org_id, cycle_id, person_id, reviewer_person_id)
        values (app_current_org(), ${input.cycleId}, ${s.personId}, ${actor.personId})
        on conflict do nothing`);
      await tx.execute(
        sql`update appraisal_cycle set state = 'open' where org_id = app_current_org() and id = ${input.cycleId}`,
      );
      return {
        result: { reviews: staff.length },
        audit: {
          action: 'people.appraisal.cycle_open',
          entityType: 'appraisal_cycle',
          entityId: input.cycleId,
          dataClass: 'operational',
          detail: { reviews: staff.length },
        },
      };
    },
  );
}

export async function closeCycle(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; cycleId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    await manageAt(deps, actor, input.institutionId),
    async (tx) => {
      const c = await cycleOf(tx, input.cycleId);
      if (c.institutionId !== input.institutionId) throw new AppraisalError('cycle_not_found');
      if (c.state !== 'open') throw new AppraisalError('not_open');
      await tx.execute(
        sql`update appraisal_cycle set state = 'closed' where org_id = app_current_org() and id = ${input.cycleId}`,
      );
      return {
        result: undefined,
        audit: {
          action: 'people.appraisal.cycle_close',
          entityType: 'appraisal_cycle',
          entityId: input.cycleId,
          dataClass: 'operational',
          detail: {},
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

export type ReviewRow = {
  reviewId: string;
  cycleId: string;
  cycle: string;
  cycleState: 'draft' | 'open' | 'closed';
  closesOn: string;
  personId: string;
  person: string | null;
  reviewerId: string;
  reviewer: string | null;
  state: State;
  score: string | null;
};

async function reviewRows(tx: Tx, filter: ReturnType<typeof sql>): Promise<ReviewRow[]> {
  const rows = await tx.execute<Omit<ReviewRow, 'person' | 'reviewer'>>(sql`
    select r.id::text as "reviewId", r.cycle_id::text as "cycleId", c.name as "cycle", c.state as "cycleState",
      c.closes_on::text as "closesOn", r.person_id::text as "personId", r.reviewer_person_id::text as "reviewerId",
      r.state, r.score::text as score
    from appraisal_review r join appraisal_cycle c on c.org_id = r.org_id and c.id = r.cycle_id
    where r.org_id = app_current_org() and c.state <> 'draft' and ${filter}
    order by c.opens_on desc, r.state, r.id`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.personId, r.reviewerId]),
  );
  return rows.map((r) => ({
    ...r,
    person: names[r.personId] ?? null,
    reviewer: names[r.reviewerId] ?? null,
  }));
}

export async function cycleReviews(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; cycleId: string },
): Promise<ReviewRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'people.appraisal.manage',
      res(actor, await place(tx, input.institutionId)),
    );
    return reviewRows(
      tx,
      sql`r.cycle_id = ${input.cycleId} and c.institution_id = ${input.institutionId}`,
    );
  });
}

/** The person's own reviews at a school, and the ones there where they are the reviewer. */
export async function myAppraisals(
  deps: AppraisalDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ mine: ReviewRow[]; toReview: ReviewRow[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'people.appraisal.self',
      res(actor, await place(tx, institutionId), actor.personId),
    );
    const here = sql`c.institution_id = ${institutionId}`;
    return {
      mine: await reviewRows(tx, sql`${here} and r.person_id = ${actor.personId}`),
      toReview: await reviewRows(tx, sql`${here} and r.reviewer_person_id = ${actor.personId}`),
    };
  });
}

/** One staff member's reviews at the school, newest first, for their staff record (`manage`). */
export async function appraisalsOf(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<ReviewRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'people.appraisal.manage',
      res(actor, await place(tx, input.institutionId)),
    );
    return reviewRows(
      tx,
      sql`c.institution_id = ${input.institutionId} and r.person_id = ${input.personId}`,
    );
  });
}

export type ReviewDetail = ReviewRow & {
  criteria: Criterion[];
  self: { criterionId: string; score: number; comment: string }[];
  reviewerRatings: { criterionId: string; score: number; comment: string }[];
  selfComment: string;
  reviewerComment: string;
  reply: string;
  you: 'person' | 'reviewer' | 'manager';
};

async function access(deps: AppraisalDeps, tx: Tx, actor: Actor, reviewId: string) {
  const [r] = await reviewRows(tx, sql`r.id = ${reviewId}`);
  if (!r) throw new AppraisalError('review_not_found');
  const [c] = await tx.execute<{ institutionId: string }>(sql`
    select institution_id::text as "institutionId" from appraisal_cycle where org_id = app_current_org() and id = ${r.cycleId}`);
  const manager = c
    ? (
        await deps.permissions.can(
          tx,
          actor,
          'people.appraisal.manage',
          res(actor, await place(tx, c.institutionId)),
        )
      ).allowed
    : false;
  const you: ReviewDetail['you'] | null =
    r.personId === actor.personId
      ? 'person'
      : r.reviewerId === actor.personId
        ? 'reviewer'
        : manager
          ? 'manager'
          : null;
  if (!you) throw new AppraisalError('review_not_found');
  return { r, you };
}

/**
 * One review. The person sees the reviewer's ratings only once it's done; the reviewer sees the
 * self-rating once it's submitted.
 */
export async function review(
  deps: AppraisalDeps,
  actor: Actor,
  reviewId: string,
): Promise<ReviewDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const { r, you } = await access(deps, tx, actor, reviewId);
    const crit = (await criteriaOf(tx, [r.cycleId])).map(toCriterion);
    const ratings = await tx.execute<{
      criterionId: string;
      by: 'self' | 'reviewer';
      score: number;
      comment: string;
    }>(sql`
      select criterion_id::text as "criterionId", by_role as by, score, comment from appraisal_rating
      where org_id = app_current_org() and review_id = ${reviewId}`);
    const [text] = await tx.execute<{
      selfComment: string;
      reviewerComment: string;
      reply: string;
    }>(sql`
      select self_comment as "selfComment", reviewer_comment as "reviewerComment", reply
      from appraisal_review where org_id = app_current_org() and id = ${reviewId}`);
    const done = r.state === 'done' || r.state === 'acknowledged';
    const showSelf = you === 'person' || r.state !== 'self';
    const showReviewer = you !== 'person' || done;
    const pick = (by: 'self' | 'reviewer') =>
      ratings
        .filter((x) => x.by === by)
        .map((x) => ({ criterionId: x.criterionId, score: x.score, comment: x.comment }));
    return {
      ...r,
      score: showReviewer ? r.score : null,
      criteria: crit,
      self: showSelf ? pick('self') : [],
      reviewerRatings: showReviewer ? pick('reviewer') : [],
      selfComment: showSelf ? (text?.selfComment ?? '') : '',
      reviewerComment: showReviewer ? (text?.reviewerComment ?? '') : '',
      reply: text?.reply ?? '',
      you,
    };
  });
}

type RatingInput = { criterionId: string; score: number; comment: string };

async function writeRatings(
  tx: Tx,
  reviewId: string,
  by: 'self' | 'reviewer',
  cycleId: string,
  ratings: RatingInput[],
) {
  const crit = await criteriaOf(tx, [cycleId]);
  if (
    !completeRatings(
      crit.map((c) => c.criterionId),
      ratings,
    )
  )
    throw new AppraisalError('ratings_incomplete');
  for (const x of ratings)
    await tx.execute(sql`
      insert into appraisal_rating (org_id, review_id, criterion_id, by_role, score, comment)
      values (app_current_org(), ${reviewId}, ${x.criterionId}, ${by}, ${x.score}, ${x.comment.trim()})
      on conflict (org_id, review_id, criterion_id, by_role) do update set score = excluded.score, comment = excluded.comment`);
  return crit;
}

/** The person rates themselves; it then goes to the reviewer. */
export async function submitSelf(
  deps: AppraisalDeps,
  actor: Actor,
  input: { reviewId: string; ratings: RatingInput[]; comment: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    await selfCheck(deps, actor, input.reviewId),
    async (tx) => {
      const { r, you } = await access(deps, tx, actor, input.reviewId);
      if (you !== 'person') throw new PermissionDenied('people.appraisal.self', 'no_relationship');
      if (r.cycleState !== 'open') throw new AppraisalError('not_open');
      if (r.state !== 'self') throw new AppraisalError('wrong_state');
      await writeRatings(tx, input.reviewId, 'self', r.cycleId, input.ratings);
      await tx.execute(sql`
      update appraisal_review set state = 'review', self_comment = ${input.comment.trim()}, self_at = now()
      where org_id = app_current_org() and id = ${input.reviewId}`);
      return {
        result: undefined,
        audit: {
          action: 'people.appraisal.self',
          entityType: 'appraisal_review',
          entityId: input.reviewId,
          dataClass: 'sensitive',
          detail: { ratings: input.ratings.length },
        },
      };
    },
  );
}

/** The reviewer rates; the weighted score is worked out and the person is told. */
export async function submitReview(
  deps: AppraisalDeps,
  actor: Actor,
  input: { reviewId: string; ratings: RatingInput[]; comment: string },
): Promise<{ score: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    await selfCheck(deps, actor, input.reviewId),
    async (tx) => {
      const { r, you } = await access(deps, tx, actor, input.reviewId);
      if (you !== 'reviewer')
        throw new PermissionDenied('people.appraisal.self', 'no_relationship');
      if (r.cycleState !== 'open') throw new AppraisalError('not_open');
      if (r.state !== 'review') throw new AppraisalError('wrong_state');
      if (input.comment.trim().length < 3) throw new AppraisalError('comment_needed');
      const crit = await writeRatings(tx, input.reviewId, 'reviewer', r.cycleId, input.ratings);
      const score = fromHundredths(
        weightedScore(
          crit.map((c) => ({
            weight: c.weight,
            score: input.ratings.find((x) => x.criterionId === c.criterionId)?.score ?? 0,
          })),
        ),
      );
      await tx.execute(sql`
      update appraisal_review set state = 'done', reviewer_comment = ${input.comment.trim()}, score = ${score}::numeric,
        reviewed_at = now()
      where org_id = app_current_org() and id = ${input.reviewId}`);
      return {
        result: { score },
        audit: {
          action: 'people.appraisal.review',
          entityType: 'appraisal_review',
          entityId: input.reviewId,
          dataClass: 'sensitive',
          detail: { score },
        },
        events: [{ type: REVIEWED, payload: { reviewId: input.reviewId, personId: r.personId } }],
      };
    },
  );
}

/** The person reads the result and acknowledges it, with an optional reply. */
export async function acknowledge(
  deps: AppraisalDeps,
  actor: Actor,
  input: { reviewId: string; reply: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    await selfCheck(deps, actor, input.reviewId),
    async (tx) => {
      const { r, you } = await access(deps, tx, actor, input.reviewId);
      if (you !== 'person') throw new PermissionDenied('people.appraisal.self', 'no_relationship');
      if (r.state !== 'done') throw new AppraisalError('wrong_state');
      await tx.execute(sql`
      update appraisal_review set state = 'acknowledged', reply = ${input.reply.trim()}, acknowledged_at = now()
      where org_id = app_current_org() and id = ${input.reviewId}`);
      return {
        result: undefined,
        audit: {
          action: 'people.appraisal.acknowledge',
          entityType: 'appraisal_review',
          entityId: input.reviewId,
          dataClass: 'sensitive',
          detail: {},
        },
      };
    },
  );
}

/** Gives a review to another reviewer, until the reviewer has started. */
export async function setReviewer(
  deps: AppraisalDeps,
  actor: Actor,
  input: { institutionId: string; reviewId: string; personId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    await manageAt(deps, actor, input.institutionId),
    async (tx) => {
      const [r] = await tx.execute<{ state: State; personId: string }>(sql`
      select r.state, r.person_id::text as "personId" from appraisal_review r
      join appraisal_cycle c on c.org_id = r.org_id and c.id = r.cycle_id
      where r.org_id = app_current_org() and r.id = ${input.reviewId} and c.institution_id = ${input.institutionId}
      for update of r`);
      if (!r) throw new AppraisalError('review_not_found');
      if (r.state !== 'self' && r.state !== 'review') throw new AppraisalError('reviewer_started');
      const [started] = await tx.execute(sql`
      select 1 from appraisal_rating where org_id = app_current_org() and review_id = ${input.reviewId} and by_role = 'reviewer'`);
      if (started) throw new AppraisalError('reviewer_started');
      if (input.personId === r.personId) throw new AppraisalError('not_staff');
      const kind = await memberKind(tx, {
        institutionId: input.institutionId,
        personId: input.personId,
        onDate: await today(tx),
      });
      if (kind !== 'staff') throw new AppraisalError('not_staff');
      await tx.execute(sql`
      update appraisal_review set reviewer_person_id = ${input.personId} where org_id = app_current_org() and id = ${input.reviewId}`);
      return {
        result: undefined,
        audit: {
          action: 'people.appraisal.reviewer',
          entityType: 'appraisal_review',
          entityId: input.reviewId,
          dataClass: 'operational',
          detail: { personId: input.personId },
        },
      };
    },
  );
}

/** Counts by state for the open cycles: for the dashboard and Verse AI, never ratings. */
export async function appraisalProgress(deps: AppraisalDeps, actor: Actor, institutionId: string) {
  const list = await cycles(deps, actor, institutionId);
  return list
    .filter((c) => c.state === 'open')
    .map((c) => ({ cycle: c.name, closesOn: c.closesOn, ...c.counts }));
}
