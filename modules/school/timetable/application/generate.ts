// Generating a timetable (Milestone 19 step 4, decision 9). The school's rules travel with the
// draft. "Generate" records a run; the worker searches (domain/generate.ts) and keeps the result;
// the screen shows it as a preview; "Place" writes exactly that result, refused if the draft's
// lessons changed since it was asked for. Teaching groups always stay; "fill" keeps every lesson
// already placed, "rebuild" replaces the sections' own lessons.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { Consumer } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { teachingPlan } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  DEFAULT_RULES,
  generate,
  type Demand,
  type Fixed,
  type Generated,
  type Rules,
} from '../domain/generate.js';
import { targets } from '../domain/timetable.js';
import {
  draftCommand,
  loadVersion,
  placeFor,
  resource,
  TimetableError,
  today,
} from './timetable.js';

type Permissions = ReturnType<typeof createPermissions>;

export const TIMETABLE_GENERATE = 'school.timetable.generate_requested.v1';

export type GenerationResult = Generated & {
  mode: Rules['mode'];
  /** Section lessons a rebuild replaces. */
  replaces: number;
  /** Subjects with periods to place but no subject teacher in Subjects (placed without one). */
  noTeacher: number;
};
export type Generation = {
  id: string;
  state: 'working' | 'ready' | 'placed' | 'failed';
  rules: Rules;
  result: GenerationResult | null;
  requestedAt: string;
  /** The draft changed since: placing it is refused. */
  stale: boolean;
  /**
   * Still working long after the longest search (a minute) could take: nothing picked it up,
   * usually because the background worker isn't running. The screen stops waiting and says so.
   */
  stuck: boolean;
};

/** Longer than the thorough search's minute, with room for a busy queue. */
const STUCK_AFTER = '3 minutes';

/** The saved rules over the defaults. */
export const rulesOf = (raw: unknown): Rules => ({
  ...DEFAULT_RULES,
  ...(raw && typeof raw === 'object' ? (raw as Partial<Rules>) : {}),
});

/** A fingerprint of a draft's lessons: any change to any cell changes it. */
async function stamp(tx: Tx, timetableId: string): Promise<string> {
  const [r] = await tx.execute<{ s: string }>(sql`
    select md5(coalesce(string_agg(concat_ws(':', id, section_id, group_id, weekday, period, subject_id,
      teacher_person_id, room), ',' order by id), '')) as s
    from school_timetable_slot where org_id = app_current_org() and timetable_id = ${timetableId}`);
  return r?.s ?? '';
}

/** What the draft holds: lessons that stay, periods still to place, and the bell. */
async function draftState(tx: Tx, timetableId: string, mode: Rules['mode']) {
  const t = await loadVersion(tx, timetableId);
  const plan = await teachingPlan(tx, t.institutionId, await today(tx));
  const periods = await tx.execute<{ number: number }>(sql`
    select number from school_timetable_period
    where org_id = app_current_org() and timetable_id = ${timetableId} and kind = 'class' order by number`);
  const slots = await tx.execute<Fixed & { groupId: string | null }>(sql`
    select case when s.group_id is null then array[s.section_id::text]
        else array(select gs.section_id::text from school_timetable_group_section gs
          where gs.org_id = s.org_id and gs.group_id = s.group_id) end as "sectionIds",
      s.group_id::text as "groupId", s.subject_id::text as "subjectId",
      s.teacher_person_id::text as "teacherPersonId", s.weekday, s.period, s.room
    from school_timetable_slot s where s.org_id = app_current_org() and s.timetable_id = ${timetableId}`);
  const fixed = mode === 'fill' ? [...slots] : slots.filter((s) => s.groupId);
  const demands: Demand[] = plan.sections.flatMap((sec) =>
    targets(
      fixed.filter((s) => s.sectionIds.includes(sec.sectionId)),
      plan.offerings.filter((o) => o.classId === sec.classId),
    )
      .filter((x) => x.target !== null && x.target > x.placed)
      .map((x) => ({
        sectionId: sec.sectionId,
        subjectId: x.subjectId,
        teacherPersonId:
          plan.teachers.find((a) => a.sectionId === sec.sectionId && a.subjectId === x.subjectId)
            ?.personId ?? null,
        count: (x.target ?? 0) - x.placed,
      })),
  );
  return {
    t,
    fixed,
    demands,
    classTeachers: Object.fromEntries(
      plan.sections.map((sec) => [sec.sectionId, sec.classTeacherPersonId]),
    ),
    replaces: slots.length - fixed.length,
    periods: periods.map((p) => p.number),
  };
}

/** Saves the draft's generating rules (validated by the caller's contract). */
export async function saveRules(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; rules: Rules },
): Promise<void> {
  await draftCommand(db, permissions, actor, input.timetableId, async (tx) => {
    await tx.execute(sql`
      update school_timetable set generate_rules = ${JSON.stringify(input.rules)}::jsonb
      where org_id = app_current_org() and id = ${input.timetableId}`);
    return {
      result: undefined,
      action: 'school.timetable.rules',
      detail: { mode: input.rules.mode },
    };
  });
}

/**
 * Saves the rules (when given) and asks the worker to generate. Returns the run to follow; its
 * result comes back on `generation`.
 */
export async function requestGeneration(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; rules?: Rules | undefined },
): Promise<{ id: string }> {
  return draftCommand(db, permissions, actor, input.timetableId, async (tx) => {
    if (input.rules)
      await tx.execute(sql`
        update school_timetable set generate_rules = ${JSON.stringify(input.rules)}::jsonb
        where org_id = app_current_org() and id = ${input.timetableId}`);
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into school_timetable_generation (org_id, timetable_id, rules, draft_stamp, requested_by_person_id)
      select org_id, id, generate_rules, ${await stamp(tx, input.timetableId)}, ${actor.personId}
      from school_timetable where org_id = app_current_org() and id = ${input.timetableId}
      returning id::text`);
    const id = r?.id ?? '';
    return {
      result: { id },
      action: 'school.timetable.generate_request',
      detail: { generationId: id },
      events: [
        { type: TIMETABLE_GENERATE, payload: { generationId: id, timetableId: input.timetableId } },
      ],
    };
  });
}

/** Runs a requested generation (worker). Once per event; a failure is recorded, not retried. */
export function generationJobs(opts: { timeMs?: number } = {}): Consumer[] {
  return [
    {
      name: 'school.timetable.generate',
      queue: 'imports',
      events: [TIMETABLE_GENERATE],
      handle: async (tx, e) => {
        const { generationId } = e.payload as { generationId: string };
        const [g] = await tx.execute<{ timetableId: string; rules: unknown; state: string }>(sql`
          select timetable_id::text as "timetableId", rules, state from school_timetable_generation
          where org_id = app_current_org() and id = ${generationId} for update`);
        if (g?.state !== 'working') return;
        try {
          const rules = rulesOf(g.rules);
          const s = await draftState(tx, g.timetableId, rules.mode);
          if (s.t.state !== 'draft') throw new TimetableError('not_draft');
          // ponytail: the search runs on the worker's thread (seconds for a large school); a
          // worker thread if other jobs start waiting behind it.
          const out = generate({
            demands: s.demands,
            days: s.t.days,
            periods: s.periods,
            fixed: s.fixed,
            rules,
            classTeachers: s.classTeachers,
            ...(opts.timeMs ? { timeMs: opts.timeMs } : {}),
          });
          const result: GenerationResult = {
            ...out,
            mode: rules.mode,
            replaces: s.replaces,
            noTeacher: s.demands.filter((d) => !d.teacherPersonId).length,
          };
          await tx.execute(sql`
            update school_timetable_generation set state = 'ready', result = ${JSON.stringify(result)}::jsonb,
              finished_at = now()
            where org_id = app_current_org() and id = ${generationId}`);
        } catch (err) {
          console.error('timetable generation failed', generationId, (err as Error).message);
          await tx.execute(sql`
            update school_timetable_generation set state = 'failed', finished_at = now()
            where org_id = app_current_org() and id = ${generationId}`);
        }
      },
    },
  ];
}

/** A run: still working, ready to preview, placed, or failed. */
export async function generation(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; generationId: string },
): Promise<Generation> {
  return withTenant(db, actor.orgId, async (tx) => {
    const t = await loadVersion(tx, input.timetableId);
    await permissions.assertCan(
      tx,
      actor,
      'school.timetable.manage',
      resource(actor, await placeFor(tx, t.institutionId)),
    );
    const [g] = await tx.execute<{
      id: string;
      state: Generation['state'];
      rules: unknown;
      result: GenerationResult | null;
      requestedAt: string;
      draftStamp: string;
      stuck: boolean;
    }>(sql`
      select id::text, state, rules, result, requested_at::text as "requestedAt", draft_stamp as "draftStamp",
        (state = 'working' and requested_at < now() - ${STUCK_AFTER}::interval) as stuck
      from school_timetable_generation
      where org_id = app_current_org() and id = ${input.generationId} and timetable_id = ${input.timetableId}`);
    if (!g) throw new TimetableError('generation_not_found');
    const { draftStamp, ...rest } = g;
    return {
      ...rest,
      rules: rulesOf(g.rules),
      stale: g.state === 'ready' && draftStamp !== (await stamp(tx, input.timetableId)),
    };
  });
}

/** Writes a ready run into the draft, exactly as previewed. */
export async function placeGeneration(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; generationId: string },
): Promise<{ placed: number }> {
  return draftCommand(db, permissions, actor, input.timetableId, async (tx) => {
    const [g] = await tx.execute<{
      state: string;
      result: GenerationResult;
      draftStamp: string;
    }>(sql`
      select state, result, draft_stamp as "draftStamp" from school_timetable_generation
      where org_id = app_current_org() and id = ${input.generationId} and timetable_id = ${input.timetableId}
      for update`);
    if (!g) throw new TimetableError('generation_not_found');
    if (g.state !== 'ready' || g.draftStamp !== (await stamp(tx, input.timetableId)))
      throw new TimetableError('changed');
    if (g.result.mode === 'rebuild')
      await tx.execute(sql`
        delete from school_timetable_slot
        where org_id = app_current_org() and timetable_id = ${input.timetableId} and section_id is not null`);
    for (const p of g.result.placed)
      await tx.execute(sql`
        insert into school_timetable_slot (org_id, timetable_id, section_id, weekday, period, subject_id,
          teacher_person_id, room)
        values (app_current_org(), ${input.timetableId}, ${p.sectionId}, ${p.weekday}, ${p.period},
          ${p.subjectId}, ${p.teacherPersonId}, ${p.room ?? null})`);
    await tx.execute(sql`
      update school_timetable_generation set state = 'placed', placed_at = now(),
        placed_by_person_id = ${actor.personId}
      where org_id = app_current_org() and id = ${input.generationId}`);
    return {
      result: { placed: g.result.placed.length },
      action: 'school.timetable.generate_place',
      detail: {
        generationId: input.generationId,
        placed: g.result.placed.length,
        mode: g.result.mode,
      },
    };
  });
}
