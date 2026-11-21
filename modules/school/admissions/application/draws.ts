// Enrollment › Merit & Seat Allocation for schools (rule book §13.1, §16.2; docs/specs/SEAT_DRAWS.md).
// A draw ranks the eligible applicants of one class and category from a recorded seed and frozen
// inputs; a second person publishes it (offers for the free seats, the rest waitlisted in order)
// or discards it with a reason. Every draw stays on record.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { drawOrder, reproduces, type DrawEntry, type DrawMethod } from '../domain/draw.js';
import { OFFERABLE, type State } from '../domain/pipeline.js';
import {
  AdmissionError,
  ageOf,
  hasOverride,
  load,
  makeOffer,
  placeFor,
  record,
  seatsLeft,
  type AdmissionsDeps,
  type Category,
} from './admissions.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
type LeftOut = { id: string; reason: 'age' | 'not_from_portal' };

async function resource(deps: AdmissionsDeps, actor: Actor, institutionId: string) {
  const place = await withTenant(deps.db, actor.orgId, (tx) => placeFor(tx, institutionId));
  return { orgId: actor.orgId, place };
}

export type DrawRow = {
  id: string;
  classId: string;
  className: string;
  category: Category;
  method: DrawMethod;
  siblingFirst: boolean;
  seed: string;
  seatsFree: number;
  entered: number;
  state: 'drawn' | 'published' | 'discarded';
  drawnBy: string;
  drawnAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  discardReason: string | null;
};

const ROW = sql`
  d.id::text, d.class_id::text as "classId", c.name as "className", d.category, d.method,
  d.sibling_first as "siblingFirst", d.seed, d.seats_free as "seatsFree", cardinality(d.ranked) as entered,
  d.state, d.drawn_by_person_id::text as "drawnBy", d.drawn_at::text as "drawnAt",
  d.decided_by_person_id::text as "decidedBy",
  d.decided_at::text as "decidedAt", d.discard_reason as "discardReason"`;
const FROM = sql`
  from school_admission_draw d
  join school_class c on c.org_id = d.org_id and c.id = d.class_id`;

/** Person ids to names (people/records owns names). */
async function named<T extends Pick<DrawRow, 'drawnBy' | 'decidedBy'>>(
  tx: Tx,
  rows: T[],
): Promise<T[]> {
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.drawnBy, ...(r.decidedBy ? [r.decidedBy] : [])]),
  );
  return rows.map((r) => ({
    ...r,
    drawnBy: names[r.drawnBy] ?? '',
    decidedBy: r.decidedBy ? (names[r.decidedBy] ?? '') : null,
  }));
}

/** Every draw of an admission year, newest first. */
export async function draws(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { institutionId: string; yearLabel: string },
): Promise<DrawRow[]> {
  const res = await resource(deps, actor, input.institutionId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.admission.manage', res);
    return named(
      tx,
      await tx.execute<DrawRow>(sql`
        select ${ROW} ${FROM}
        where d.org_id = app_current_org() and d.institution_id = ${input.institutionId}
          and d.year_label = ${input.yearLabel}
        order by d.drawn_at desc`),
    );
  });
}

/**
 * Draws one class and category. Eligible: applications still open for an offer; an age outside
 * the rule pack without an override, or an RTE application not from the RTE portal, is left out
 * with its reason. Seats must be set for the class and category first.
 */
export async function startDraw(
  deps: AdmissionsDeps,
  actor: Actor,
  input: {
    institutionId: string;
    yearLabel: string;
    classId: string;
    category: Category;
    method: DrawMethod;
    siblingFirst: boolean;
    seed: string | null;
  },
): Promise<{ id: string }> {
  const res = await resource(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.manage', resource: res },
    async (tx) => {
      const free = await seatsLeft(tx, input);
      if (free === null) throw new AdmissionError('no_seats_set');
      const open = await tx.execute<{
        id: string;
        sibling: boolean;
        appliedAt: string;
        source: string;
      }>(sql`
        select id::text, sibling_of_person_id is not null as sibling, created_at::text as "appliedAt", source
        from school_application
        where org_id = app_current_org() and institution_id = ${input.institutionId}
          and year_label = ${input.yearLabel} and class_id = ${input.classId} and category = ${input.category}
          and state = any(${`{${[...OFFERABLE].join(',')}}`}::text[])
        order by id
        for update`);
      const pool: DrawEntry[] = [];
      const leftOut: LeftOut[] = [];
      for (const o of open) {
        if (input.category === 'rte' && o.source !== 'rte_portal') {
          leftOut.push({ id: o.id, reason: 'not_from_portal' });
          continue;
        }
        const age = await ageOf(tx, await load(tx, o.id));
        if (
          (age.status === 'too_young' || age.status === 'too_old') &&
          !(await hasOverride(tx, o.id))
        ) {
          leftOut.push({ id: o.id, reason: 'age' });
          continue;
        }
        pool.push({ id: o.id, sibling: o.sibling, appliedAt: o.appliedAt });
      }
      if (pool.length === 0) throw new AdmissionError('nobody_to_draw');
      const seed = input.seed?.trim() || randomBytes(16).toString('hex');
      const ranked = drawOrder(pool, { ...input, seed }, sha256);
      const rows = await tx.execute<{ id: string }>(sql`
          insert into school_admission_draw (org_id, institution_id, year_label, class_id, category, method,
            sibling_first, seed, pool, left_out, ranked, seats_free, drawn_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${input.yearLabel}, ${input.classId}, ${input.category},
            ${input.method}, ${input.siblingFirst}, ${seed}, ${JSON.stringify(pool)}::jsonb,
            ${JSON.stringify(leftOut)}::jsonb, ${`{${ranked.join(',')}}`}::uuid[], ${Math.max(0, free)},
            ${actor.personId})
          on conflict do nothing
          returning id::text`);
      const row = rows[0];
      if (!row) throw new AdmissionError('draw_pending');
      return {
        result: row,
        audit: {
          action: 'school.admission.draw',
          entityType: 'school_admission_draw',
          entityId: row.id,
          dataClass: 'operational',
          detail: {
            classId: input.classId,
            category: input.category,
            method: input.method,
            seed,
            entered: pool.length,
            leftOut: leftOut.length,
            seatsFree: Math.max(0, free),
          },
        },
      };
    },
  );
}

export type DrawDetail = DrawRow & {
  yearLabel: string;
  /** The viewer drew it, so they can't publish it. */
  mine: boolean;
  /** Running the draw again from its recorded inputs gives the recorded order. */
  reproduces: boolean;
  ranked: { rank: number; id: string; childName: string; sibling: boolean; state: State }[];
  leftOut: { id: string; childName: string; reason: LeftOut['reason'] }[];
};

export async function drawDetail(
  deps: AdmissionsDeps,
  actor: Actor,
  drawId: string,
): Promise<DrawDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await drawAt(tx, drawId);
    await deps.permissions.assertCan(tx, actor, 'school.admission.manage', {
      orgId: actor.orgId,
      place: await placeFor(tx, d.institutionId),
    });
    const ids = [...d.rankedIds, ...d.leftOut.map((l) => l.id)];
    const apps = await tx.execute<{ id: string; childName: string; state: State }>(sql`
      select id::text, child_name as "childName", state from school_application
      where org_id = app_current_org() and id = any(${`{${ids.join(',')}}`}::uuid[])`);
    const byId = new Map(apps.map((a) => [a.id, a]));
    const sibling = new Map(d.pool.map((p) => [p.id, p.sibling]));
    const { pool, rankedIds, leftOut } = d;
    const [row] = await named(tx, [d]);
    // Only what the screen needs: no frozen inputs or internal ids.
    const view: Partial<typeof d> = { ...(row ?? d) };
    delete view.pool;
    delete view.rankedIds;
    delete view.leftOut;
    delete view.institutionId;
    delete view.drawnById;
    return {
      ...(view as DrawRow & { yearLabel: string }),
      mine: d.drawnById === actor.personId,
      reproduces: reproduces(rankedIds, pool, d, sha256),
      ranked: rankedIds.map((id, i) => ({
        rank: i + 1,
        id,
        childName: byId.get(id)?.childName ?? '',
        sibling: sibling.get(id) ?? false,
        state: byId.get(id)?.state ?? 'withdrawn',
      })),
      leftOut: leftOut.map((l) => ({ ...l, childName: byId.get(l.id)?.childName ?? '' })),
    };
  });
}

async function drawAt(tx: Tx, drawId: string, lock = false) {
  const [d] = await tx.execute<
    DrawRow & {
      institutionId: string;
      yearLabel: string;
      pool: DrawEntry[];
      leftOut: LeftOut[];
      rankedIds: string[];
      drawnById: string;
    }
  >(sql`
    select ${ROW}, d.institution_id::text as "institutionId", d.year_label as "yearLabel", d.pool,
      d.left_out as "leftOut", d.ranked::text[] as "rankedIds", d.drawn_by_person_id::text as "drawnById"
    ${FROM}
    where d.org_id = app_current_org() and d.id = ${drawId}
    ${lock ? sql`for update of d` : sql``}`);
  if (!d) throw new AdmissionError('draw_not_found');
  return d;
}

/**
 * Publishes a draw (someone other than who drew it): in rank order, applicants still open for an
 * offer get one while seats last; the rest are waitlisted with their rank. Anyone whose
 * application moved on since the draw is passed over.
 */
export async function publishDraw(
  deps: AdmissionsDeps,
  actor: Actor,
  drawId: string,
): Promise<{ offered: number; waitlisted: number }> {
  const res = await withTenant(deps.db, actor.orgId, async (tx) => ({
    orgId: actor.orgId,
    place: await placeFor(tx, (await drawAt(tx, drawId)).institutionId),
  }));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.offer', resource: res },
    async (tx) => {
      const d = await drawAt(tx, drawId, true);
      if (d.state !== 'drawn') throw new AdmissionError('draw_decided');
      if (d.drawnById === actor.personId) throw new AdmissionError('same_person');
      let offered = 0;
      let waitlisted = 0;
      for (const id of d.rankedIds) {
        const a = await load(tx, id, true);
        if (!OFFERABLE.has(a.state)) continue;
        const left = await seatsLeft(tx, a);
        if (left !== null && left > 0) {
          await makeOffer(tx, a, actor.personId, 'Seat draw');
          offered += 1;
          continue;
        }
        waitlisted += 1;
        if (a.state !== 'waitlisted')
          await record(tx, a.id, a.state, 'waitlisted', actor.personId, 'Seat draw');
        await tx.execute(sql`
          update school_application set waitlist_position = ${waitlisted}
          where org_id = app_current_org() and id = ${a.id}`);
      }
      await tx.execute(sql`
        update school_admission_draw set state = 'published', decided_by_person_id = ${actor.personId},
          decided_at = now()
        where org_id = app_current_org() and id = ${drawId}`);
      return {
        result: { offered, waitlisted },
        audit: {
          action: 'school.admission.draw_publish',
          entityType: 'school_admission_draw',
          entityId: drawId,
          dataClass: 'operational',
          detail: { offered, waitlisted },
        },
      };
    },
  );
}

/** Sets a draw aside with a reason. It stays on record. */
export async function discardDraw(
  deps: AdmissionsDeps,
  actor: Actor,
  input: { drawId: string; reason: string },
): Promise<void> {
  const res = await withTenant(deps.db, actor.orgId, async (tx) => ({
    orgId: actor.orgId,
    place: await placeFor(tx, (await drawAt(tx, input.drawId)).institutionId),
  }));
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.admission.offer', resource: res },
    async (tx) => {
      const d = await drawAt(tx, input.drawId, true);
      if (d.state !== 'drawn') throw new AdmissionError('draw_decided');
      await tx.execute(sql`
        update school_admission_draw set state = 'discarded', decided_by_person_id = ${actor.personId},
          decided_at = now(), discard_reason = btrim(${input.reason})
        where org_id = app_current_org() and id = ${input.drawId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.admission.draw_discard',
          entityType: 'school_admission_draw',
          entityId: input.drawId,
          dataClass: 'operational',
          reason: input.reason,
        },
      };
    },
  );
}
