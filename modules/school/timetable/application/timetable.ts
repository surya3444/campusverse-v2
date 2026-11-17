// Timetable (Milestone 19 step 1): versions with a bell schedule, one slot per section, day and
// period, clash checks, publishing from a date, and the periods of a day.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, staffAt } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { holidayOn } from '@campusverse/school-attendance';
import { papersOn, type PaperOn } from '@campusverse/school-exams';
import { teachingPlan, type TeachingPlan } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  checkPeriods,
  targets,
  versionStatus,
  weekday,
  type PeriodInput,
  type ScheduleProblem,
  type Target,
  type VersionStatus,
} from '../domain/timetable.js';
import { DEFAULT_RULES, type Rules } from '../domain/generate.js';

type Permissions = ReturnType<typeof createPermissions>;

export const TIMETABLE_PUBLISHED = 'school.timetable.published.v1';

export type Clash = { teacher: string; weekday: number; period: number; school: string };

export class TimetableError extends Error {
  constructor(
    readonly code:
      | ScheduleProblem
      | 'institution_not_found'
      | 'timetable_not_found'
      | 'no_year'
      | 'not_draft'
      | 'section_not_found'
      | 'subject_not_offered'
      | 'not_a_class_period'
      | 'not_a_working_day'
      | 'teacher_busy'
      | 'room_busy'
      | 'empty'
      | 'bad_date'
      | 'date_taken'
      | 'clash_elsewhere'
      | 'lesson_not_found'
      | 'teacher_not_away'
      | 'section_busy'
      | 'group_not_found'
      | 'duplicate_subject'
      | 'changed'
      | 'generation_not_found',
    /** For a clash: the other section ("Class 5-B"), or the clashes with other schools. */
    readonly details?: { other?: string; clashes?: Clash[] },
  ) {
    super(`timetable: ${code}`);
    this.name = 'TimetableError';
  }
}

export const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

export async function placeFor(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new TimetableError('institution_not_found');
  return p;
}

export const resource = (actor: Actor, place: { campusId: string; institutionId: string }) => ({
  orgId: actor.orgId,
  place,
});

export type Version = {
  id: string;
  name: string;
  state: 'draft' | 'published';
  status: VersionStatus;
  effectiveFrom: string | null;
  days: number[];
  slots: number;
  copiedFromId: string | null;
};

async function versions(tx: Tx, institutionId: string, on: string): Promise<Version[]> {
  const rows = await tx.execute<Omit<Version, 'status'>>(sql`
    select t.id::text, t.name, t.state, t.effective_from::text as "effectiveFrom", t.days,
      t.copied_from_id::text as "copiedFromId",
      (select count(*)::int from school_timetable_slot s where s.org_id = t.org_id and s.timetable_id = t.id) as slots
    from school_timetable t
    where t.org_id = app_current_org() and t.institution_id = ${institutionId}
    order by t.effective_from desc nulls first, t.created_at desc`);
  const status = versionStatus(rows, on);
  return rows.map((r) => ({ ...r, status: status.get(r.id) ?? 'draft' }));
}

/** Every version of the school's timetable, newest first, with where each stands today. */
export async function listTimetables(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<Version[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    const place = await placeFor(tx, institutionId);
    await permissions.assertCan(tx, actor, 'school.timetable.read', resource(actor, place));
    return versions(tx, institutionId, await today(tx));
  });
}

export type Period = {
  /** The row in the bell schedule (breaks count). */
  number: number;
  /** What the school calls it: Period 1, 2… counting class periods only; null for a break. */
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  kind: 'class' | 'break';
  label: string | null;
};
export type Slot = {
  id: string;
  /** A section's lesson, or one subject of a teaching group's lesson. */
  sectionId: string | null;
  groupId: string | null;
  weekday: number;
  period: number;
  subjectId: string;
  teacherPersonId: string | null;
  room: string | null;
};
/** Sections that come together in a period and split by subject (languages, electives). */
export type Group = { id: string; name: string; sectionIds: string[] };
export type TimetableDetail = {
  version: Version;
  periods: Period[];
  slots: Slot[];
  groups: Group[];
  /** The rules for generating this version (decision 9), defaults filled in. */
  rules: Rules;
  plan: TeachingPlan;
  staff: { personId: string; name: string }[];
  /** Per section: periods placed per subject against the target. */
  targets: Record<string, Target[]>;
};

export async function loadVersion(tx: Tx, timetableId: string) {
  const [t] = await tx.execute<{
    institutionId: string;
    state: 'draft' | 'published';
    days: number[];
    yearId: string;
  }>(sql`
    select institution_id::text as "institutionId", state, days, year_id::text as "yearId"
    from school_timetable where org_id = app_current_org() and id = ${timetableId}`);
  if (!t) throw new TimetableError('timetable_not_found');
  return t;
}

async function groupsOf(tx: Tx, timetableId: string): Promise<Group[]> {
  return [
    ...(await tx.execute<Group>(sql`
      select g.id::text, g.name,
        array(select gs.section_id::text from school_timetable_group_section gs
          where gs.org_id = g.org_id and gs.group_id = g.id order by gs.section_id) as "sectionIds"
      from school_timetable_group g
      where g.org_id = app_current_org() and g.timetable_id = ${timetableId} order by lower(g.name)`)),
  ];
}

/** One version with everything its editor needs: bell schedule, slots, sections, subjects, staff. */
export async function timetableDetail(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  timetableId: string,
): Promise<TimetableDetail> {
  return withTenant(db, actor.orgId, async (tx) => {
    const t = await loadVersion(tx, timetableId);
    const place = await placeFor(tx, t.institutionId);
    await permissions.assertCan(tx, actor, 'school.timetable.read', resource(actor, place));
    const on = await today(tx);
    const version = (await versions(tx, t.institutionId, on)).find((v) => v.id === timetableId);
    const periods = await tx.execute<Period>(sql`
      select number, to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt",
        kind, label,
        case when kind = 'class' then count(*) filter (where kind = 'class') over (order by number) end::int
          as ordinal
      from school_timetable_period where org_id = app_current_org() and timetable_id = ${timetableId}
      order by number`);
    const slots = await tx.execute<Slot>(sql`
      select id::text, section_id::text as "sectionId", group_id::text as "groupId", weekday, period,
        subject_id::text as "subjectId", teacher_person_id::text as "teacherPersonId", room
      from school_timetable_slot where org_id = app_current_org() and timetable_id = ${timetableId}`);
    const groups = await groupsOf(tx, timetableId);
    const [raw] = await tx.execute<{ rules: Partial<Rules> }>(sql`
      select generate_rules as rules from school_timetable
      where org_id = app_current_org() and id = ${timetableId}`);
    const plan = await teachingPlan(tx, t.institutionId, on);
    const staff = (await staffAt(tx, t.institutionId, on)).map((s) => ({
      personId: s.personId,
      name: s.name,
    }));
    // Teachers placed but no longer on the staff list still need a name on the grid.
    const missing = slots
      .map((s) => s.teacherPersonId)
      .filter((id): id is string => !!id && !staff.some((s) => s.personId === id));
    const names = await displayNames(tx, [...new Set(missing)]);
    return {
      version: version as Version,
      periods: [...periods],
      slots: [...slots],
      groups,
      rules: { ...DEFAULT_RULES, ...raw?.rules },
      plan,
      staff: [...staff, ...Object.entries(names).map(([personId, name]) => ({ personId, name }))],
      targets: Object.fromEntries(
        plan.sections.map((s) => [
          s.sectionId,
          targets(
            // A group's lesson counts for each of its sections, by subject.
            slots
              .filter(
                (x) =>
                  x.sectionId === s.sectionId ||
                  groups.some((g) => g.id === x.groupId && g.sectionIds.includes(s.sectionId)),
              )
              .map((x) => ({ ...x, sectionId: s.sectionId })),
            plan.offerings.filter((o) => o.classId === s.classId),
          ),
        ]),
      ),
    };
  });
}

async function writePeriods(tx: Tx, timetableId: string, periods: PeriodInput[]) {
  await tx.execute(sql`
    delete from school_timetable_period where org_id = app_current_org() and timetable_id = ${timetableId}
      and number > ${periods.length}`);
  for (const [i, p] of periods.entries())
    await tx.execute(sql`
      insert into school_timetable_period (org_id, timetable_id, number, starts_at, ends_at, kind, label)
      values (app_current_org(), ${timetableId}, ${i + 1}, ${p.startsAt}::time, ${p.endsAt}::time, ${p.kind},
        ${p.label?.trim() || null})
      on conflict (org_id, timetable_id, number) do update
      set starts_at = excluded.starts_at, ends_at = excluded.ends_at, kind = excluded.kind, label = excluded.label`);
  // A period that became a break holds no lessons.
  await tx.execute(sql`
    delete from school_timetable_slot s using school_timetable_period p
    where s.org_id = app_current_org() and s.timetable_id = ${timetableId}
      and p.org_id = s.org_id and p.timetable_id = s.timetable_id and p.number = s.period and p.kind = 'break'`);
}

export type ScheduleInput = { name: string; days: number[]; periods: PeriodInput[] };

/** A new draft for the current year, with its bell schedule. */
export async function createTimetable(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: ScheduleInput & { institutionId: string },
): Promise<{ id: string }> {
  const problem = checkPeriods(input.periods);
  if (problem) throw new TimetableError(problem);
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.timetable.manage', resource: resource(actor, place) },
    async (tx) => {
      const plan = await teachingPlan(tx, input.institutionId, await today(tx));
      if (!plan.yearId) throw new TimetableError('no_year');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_timetable (org_id, institution_id, year_id, name, days, created_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${plan.yearId}, ${input.name.trim()},
          ${`{${[...new Set(input.days)].sort().join(',')}}`}::smallint[], ${actor.personId})
        returning id::text`);
      const id = row?.id ?? '';
      await writePeriods(tx, id, input.periods);
      return {
        result: { id },
        audit: {
          action: 'school.timetable.create',
          entityType: 'school_timetable',
          entityId: id,
          dataClass: 'operational',
          detail: { periods: input.periods.length, days: input.days.join(',') },
        },
        events: [],
      };
    },
  );
}

export async function draftCommand<T>(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  timetableId: string,
  work: (
    tx: Tx,
    t: Awaited<ReturnType<typeof loadVersion>>,
  ) => Promise<{
    result: T;
    action: string;
    detail: Record<string, string | number | boolean | null>;
    events?: { type: string; payload: Record<string, unknown> }[];
  }>,
): Promise<T> {
  const t = await withTenant(db, actor.orgId, (tx) => loadVersion(tx, timetableId));
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, t.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.timetable.manage', resource: resource(actor, place) },
    async (tx) => {
      const [locked] = await tx.execute<{ state: string }>(sql`
        select state from school_timetable where org_id = app_current_org() and id = ${timetableId} for update`);
      if (locked?.state !== 'draft') throw new TimetableError('not_draft');
      const out = await work(tx, t);
      return {
        result: out.result,
        audit: {
          action: out.action,
          entityType: 'school_timetable',
          entityId: timetableId,
          dataClass: 'operational',
          detail: out.detail,
        },
        events: out.events ?? [],
      };
    },
  );
}

/** Renames a draft and changes its days and bell schedule. Lessons on dropped days or periods go. */
export async function updateSchedule(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: ScheduleInput & { timetableId: string },
): Promise<void> {
  const problem = checkPeriods(input.periods);
  if (problem) throw new TimetableError(problem);
  await draftCommand(db, permissions, actor, input.timetableId, async (tx) => {
    const days = [...new Set(input.days)].sort();
    await tx.execute(sql`
      update school_timetable set name = ${input.name.trim()}, days = ${`{${days.join(',')}}`}::smallint[]
      where org_id = app_current_org() and id = ${input.timetableId}`);
    await tx.execute(sql`
      delete from school_timetable_slot where org_id = app_current_org() and timetable_id = ${input.timetableId}
        and not (weekday = any(${`{${days.join(',')}}`}::smallint[]))`);
    await writePeriods(tx, input.timetableId, input.periods);
    return {
      result: undefined,
      action: 'school.timetable.schedule',
      detail: { periods: input.periods.length, days: days.join(',') },
    };
  });
}

/** A new draft with the same bell schedule and lessons: how a published timetable changes. */
export async function copyTimetable(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; name: string },
): Promise<{ id: string }> {
  const t = await withTenant(db, actor.orgId, (tx) => loadVersion(tx, input.timetableId));
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, t.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.timetable.manage', resource: resource(actor, place) },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_timetable (org_id, institution_id, year_id, name, days, copied_from_id, created_by_person_id,
          generate_rules)
        select org_id, institution_id, year_id, ${input.name.trim()}, days, id, ${actor.personId}, generate_rules
        from school_timetable where org_id = app_current_org() and id = ${input.timetableId}
        returning id::text`);
      const id = row?.id ?? '';
      await tx.execute(sql`
        insert into school_timetable_period (org_id, timetable_id, number, starts_at, ends_at, kind, label)
        select org_id, ${id}, number, starts_at, ends_at, kind, label from school_timetable_period
        where org_id = app_current_org() and timetable_id = ${input.timetableId}`);
      await tx.execute(sql`
        insert into school_timetable_slot (org_id, timetable_id, section_id, weekday, period, subject_id,
          teacher_person_id, room)
        select org_id, ${id}, section_id, weekday, period, subject_id, teacher_person_id, room
        from school_timetable_slot where org_id = app_current_org() and timetable_id = ${input.timetableId}
          and section_id is not null`);
      // Teaching groups, their sections and their lessons, under new ids.
      for (const g of await groupsOf(tx, input.timetableId)) {
        const [ng] = await tx.execute<{ id: string }>(sql`
          insert into school_timetable_group (org_id, timetable_id, name)
          values (app_current_org(), ${id}, ${g.name}) returning id::text`);
        await tx.execute(sql`
          insert into school_timetable_group_section (org_id, group_id, section_id)
          select org_id, ${ng?.id}, section_id from school_timetable_group_section
          where org_id = app_current_org() and group_id = ${g.id}`);
        await tx.execute(sql`
          insert into school_timetable_slot (org_id, timetable_id, group_id, weekday, period, subject_id,
            teacher_person_id, room)
          select org_id, ${id}, ${ng?.id}, weekday, period, subject_id, teacher_person_id, room
          from school_timetable_slot where org_id = app_current_org() and group_id = ${g.id}`);
      }
      return {
        result: { id },
        audit: {
          action: 'school.timetable.copy',
          entityType: 'school_timetable',
          entityId: id,
          dataClass: 'operational',
          detail: { from: input.timetableId },
        },
        events: [],
      };
    },
  );
}

export type SlotInput = {
  timetableId: string;
  sectionId: string;
  weekday: number;
  period: number;
  /** Null clears the slot. */
  subjectId: string | null;
  teacherPersonId?: string | null | undefined;
  room?: string | null | undefined;
};

/**
 * Puts a lesson in one cell of a draft (or clears it). A teacher or room already used that day
 * and period is refused, naming the other section.
 */
export async function setSlot(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: SlotInput,
): Promise<void> {
  await draftCommand(db, permissions, actor, input.timetableId, async (tx, t) => {
    const where = sql`org_id = app_current_org() and timetable_id = ${input.timetableId}
      and section_id = ${input.sectionId} and weekday = ${input.weekday} and period = ${input.period}`;
    if (!input.subjectId) {
      await tx.execute(sql`delete from school_timetable_slot where ${where}`);
      return {
        result: undefined,
        action: 'school.timetable.slot_clear',
        detail: slotDetail(input),
      };
    }
    const plan = await teachingPlan(tx, t.institutionId, await today(tx));
    const section = plan.sections.find((s) => s.sectionId === input.sectionId);
    if (!section || plan.yearId !== t.yearId) throw new TimetableError('section_not_found');
    if (
      !plan.offerings.some((o) => o.classId === section.classId && o.subjectId === input.subjectId)
    )
      throw new TimetableError('subject_not_offered');
    if (!t.days.includes(input.weekday)) throw new TimetableError('not_a_working_day');
    const [p] = await tx.execute<{ kind: string }>(sql`
      select kind from school_timetable_period
      where org_id = app_current_org() and timetable_id = ${input.timetableId} and number = ${input.period}`);
    if (p?.kind !== 'class') throw new TimetableError('not_a_class_period');
    const room = input.room?.trim() || null;
    const teacher = input.teacherPersonId ?? null;
    const [group] = await tx.execute<{ name: string }>(sql`
      select g.name from school_timetable_slot s
      join school_timetable_group g on g.org_id = s.org_id and g.id = s.group_id
      join school_timetable_group_section gs on gs.org_id = g.org_id and gs.group_id = g.id
      where s.org_id = app_current_org() and s.timetable_id = ${input.timetableId}
        and s.weekday = ${input.weekday} and s.period = ${input.period} and gs.section_id = ${input.sectionId}
      limit 1`);
    if (group) throw new TimetableError('section_busy', { other: group.name });
    const busy = await busyWith(tx, plan, input, [{ teacher, room }], {
      sectionId: input.sectionId,
    });
    if (busy) throw busy;
    await tx.execute(sql`
      insert into school_timetable_slot (org_id, timetable_id, section_id, weekday, period, subject_id,
        teacher_person_id, room)
      values (app_current_org(), ${input.timetableId}, ${input.sectionId}, ${input.weekday}, ${input.period},
        ${input.subjectId}, ${teacher}, ${room})
      on conflict (org_id, timetable_id, section_id, weekday, period) do update
      set subject_id = excluded.subject_id, teacher_person_id = excluded.teacher_person_id, room = excluded.room`);
    return { result: undefined, action: 'school.timetable.slot_set', detail: slotDetail(input) };
  });
}

/**
 * A teacher or room already used in that day and period by another lesson (not `self`), as the
 * error naming it ("Class 5-B" or the group's name).
 */
async function busyWith(
  tx: Tx,
  plan: TeachingPlan,
  at: { timetableId: string; weekday: number; period: number },
  uses: { teacher: string | null; room: string | null }[],
  self: { sectionId?: string; groupId?: string },
): Promise<TimetableError | null> {
  const teachers = uses.map((u) => u.teacher).filter((x): x is string => !!x);
  const rooms = uses.map((u) => u.room?.toLowerCase()).filter((x): x is string => !!x);
  if (!teachers.length && !rooms.length) return null;
  const [busy] = await tx.execute<{
    sectionId: string | null;
    groupName: string | null;
    why: string;
  }>(sql`
    select s.section_id::text as "sectionId", g.name as "groupName",
      case when s.teacher_person_id::text = any(${`{${teachers.join(',')}}`}::text[]) then 'teacher'
        else 'room' end as why
    from school_timetable_slot s
    left join school_timetable_group g on g.org_id = s.org_id and g.id = s.group_id
    where s.org_id = app_current_org() and s.timetable_id = ${at.timetableId}
      and s.weekday = ${at.weekday} and s.period = ${at.period}
      and ${
        self.groupId
          ? sql`s.group_id is distinct from ${self.groupId}::uuid`
          : sql`s.section_id is distinct from ${self.sectionId ?? null}::uuid`
      }
      and (s.teacher_person_id::text = any(${`{${teachers.join(',')}}`}::text[])
        or lower(s.room) = any(${pgArray(rooms)}::text[]))
    limit 1`);
  if (!busy) return null;
  const other =
    busy.groupName ?? plan.sections.find((x) => x.sectionId === busy.sectionId)?.label ?? '';
  return new TimetableError(busy.why === 'teacher' ? 'teacher_busy' : 'room_busy', { other });
}

/** A Postgres text[] literal, quoting each value. */
const pgArray = (xs: string[]) =>
  `{${xs.map((x) => `"${x.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;

const slotDetail = (i: SlotInput) => ({
  sectionId: i.sectionId,
  weekday: i.weekday,
  period: i.period,
  subjectId: i.subjectId,
});

export type GroupInput = {
  timetableId: string;
  /** Absent for a new group. */
  groupId?: string | undefined;
  name: string;
  sectionIds: string[];
};

/**
 * Creates or changes a teaching group of a draft. A section joining a group must be free
 * wherever the group is already placed.
 */
export async function saveGroup(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: GroupInput,
): Promise<{ id: string }> {
  return draftCommand(db, permissions, actor, input.timetableId, async (tx, t) => {
    const plan = await teachingPlan(tx, t.institutionId, await today(tx));
    const sectionIds = [...new Set(input.sectionIds)];
    if (
      plan.yearId !== t.yearId ||
      sectionIds.length === 0 ||
      !sectionIds.every((id) => plan.sections.some((x) => x.sectionId === id))
    )
      throw new TimetableError('section_not_found');
    let id = input.groupId ?? '';
    if (id) {
      const [g] = await tx.execute(sql`
        update school_timetable_group set name = ${input.name.trim()}
        where org_id = app_current_org() and timetable_id = ${input.timetableId} and id = ${id}
        returning id`);
      if (!g) throw new TimetableError('group_not_found');
    } else {
      const [g] = await tx.execute<{ id: string }>(sql`
        insert into school_timetable_group (org_id, timetable_id, name)
        values (app_current_org(), ${input.timetableId}, ${input.name.trim()}) returning id::text`);
      id = g?.id ?? '';
    }
    // A joining section's own lesson, or another group of it, where this group is placed.
    const [clash] = await tx.execute<{ sectionId: string }>(sql`
      select coalesce(o.section_id, ogs.section_id)::text as "sectionId"
      from school_timetable_slot me
      join school_timetable_slot o on o.org_id = me.org_id and o.timetable_id = me.timetable_id
        and o.weekday = me.weekday and o.period = me.period and o.group_id is distinct from me.group_id
      left join school_timetable_group_section ogs on ogs.org_id = o.org_id and ogs.group_id = o.group_id
      where me.org_id = app_current_org() and me.group_id = ${id}
        and coalesce(o.section_id, ogs.section_id)::text = any(${`{${sectionIds.join(',')}}`}::text[])
      limit 1`);
    if (clash)
      throw new TimetableError('section_busy', {
        other: plan.sections.find((x) => x.sectionId === clash.sectionId)?.label ?? '',
      });
    await tx.execute(sql`
      delete from school_timetable_group_section where org_id = app_current_org() and group_id = ${id}
        and not (section_id::text = any(${`{${sectionIds.join(',')}}`}::text[]))`);
    for (const sectionId of sectionIds)
      await tx.execute(sql`
        insert into school_timetable_group_section (org_id, group_id, section_id)
        values (app_current_org(), ${id}, ${sectionId}) on conflict do nothing`);
    return {
      result: { id },
      action: input.groupId ? 'school.timetable.group_update' : 'school.timetable.group_create',
      detail: { groupId: id, sections: sectionIds.length },
    };
  });
}

/** Removes a teaching group from a draft, with its lessons. */
export async function deleteGroup(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; groupId: string },
): Promise<void> {
  await draftCommand(db, permissions, actor, input.timetableId, async (tx) => {
    const [g] = await tx.execute(sql`
      delete from school_timetable_group
      where org_id = app_current_org() and timetable_id = ${input.timetableId} and id = ${input.groupId}
      returning id`);
    if (!g) throw new TimetableError('group_not_found');
    return {
      result: undefined,
      action: 'school.timetable.group_delete',
      detail: { groupId: input.groupId },
    };
  });
}

export type GroupSlotInput = {
  timetableId: string;
  groupId: string;
  weekday: number;
  period: number;
  /** Each subject the group splits into, with its teacher and room. Empty clears the cell. */
  lessons: {
    subjectId: string;
    teacherPersonId?: string | null | undefined;
    room?: string | null | undefined;
  }[];
};

/**
 * Places a teaching group in one day and period of a draft (or clears it). Its sections must be
 * free then; each teacher and room must be free and used once.
 */
export async function setGroupSlot(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: GroupSlotInput,
): Promise<void> {
  await draftCommand(db, permissions, actor, input.timetableId, async (tx, t) => {
    const group = (await groupsOf(tx, input.timetableId)).find((g) => g.id === input.groupId);
    if (!group) throw new TimetableError('group_not_found');
    await tx.execute(sql`
      delete from school_timetable_slot where org_id = app_current_org()
        and timetable_id = ${input.timetableId} and group_id = ${input.groupId}
        and weekday = ${input.weekday} and period = ${input.period}`);
    const detail = {
      groupId: input.groupId,
      weekday: input.weekday,
      period: input.period,
      subjects: input.lessons.length,
    };
    if (input.lessons.length === 0)
      return { result: undefined, action: 'school.timetable.group_slot_clear', detail };

    if (!t.days.includes(input.weekday)) throw new TimetableError('not_a_working_day');
    const [p] = await tx.execute<{ kind: string }>(sql`
      select kind from school_timetable_period
      where org_id = app_current_org() and timetable_id = ${input.timetableId} and number = ${input.period}`);
    if (p?.kind !== 'class') throw new TimetableError('not_a_class_period');
    const plan = await teachingPlan(tx, t.institutionId, await today(tx));
    const classes = new Set(
      plan.sections.filter((x) => group.sectionIds.includes(x.sectionId)).map((x) => x.classId),
    );
    const lessons = input.lessons.map((l) => ({
      subjectId: l.subjectId,
      teacher: l.teacherPersonId ?? null,
      room: l.room?.trim() || null,
    }));
    if (new Set(lessons.map((l) => l.subjectId)).size < lessons.length)
      throw new TimetableError('duplicate_subject');
    for (const l of lessons)
      if (!plan.offerings.some((o) => classes.has(o.classId) && o.subjectId === l.subjectId))
        throw new TimetableError('subject_not_offered');
    const twice = (xs: (string | null)[]) => {
      const seen = xs.filter((x): x is string => !!x).map((x) => x.toLowerCase());
      return new Set(seen).size < seen.length;
    };
    if (twice(lessons.map((l) => l.teacher)))
      throw new TimetableError('teacher_busy', { other: group.name });
    if (twice(lessons.map((l) => l.room)))
      throw new TimetableError('room_busy', { other: group.name });

    // The group's sections must be free: no lesson of their own, no other group of theirs.
    const [taken] = await tx.execute<{ sectionId: string }>(sql`
      select coalesce(o.section_id, ogs.section_id)::text as "sectionId"
      from school_timetable_slot o
      left join school_timetable_group_section ogs on ogs.org_id = o.org_id and ogs.group_id = o.group_id
      where o.org_id = app_current_org() and o.timetable_id = ${input.timetableId}
        and o.weekday = ${input.weekday} and o.period = ${input.period}
        and coalesce(o.section_id, ogs.section_id)::text = any(${`{${group.sectionIds.join(',')}}`}::text[])
      limit 1`);
    if (taken)
      throw new TimetableError('section_busy', {
        other: plan.sections.find((x) => x.sectionId === taken.sectionId)?.label ?? '',
      });
    const busy = await busyWith(tx, plan, input, lessons, { groupId: input.groupId });
    if (busy) throw busy;
    for (const l of lessons)
      await tx.execute(sql`
        insert into school_timetable_slot (org_id, timetable_id, group_id, weekday, period, subject_id,
          teacher_person_id, room)
        values (app_current_org(), ${input.timetableId}, ${input.groupId}, ${input.weekday}, ${input.period},
          ${l.subjectId}, ${l.teacher}, ${l.room})`);
    return { result: undefined, action: 'school.timetable.group_slot_set', detail };
  });
}

/**
 * Publishes a draft from a date (today or later, inside its year). Refused while a teacher it
 * places also teaches at an overlapping time in another school's timetable for those dates.
 */
export async function publishTimetable(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { timetableId: string; effectiveFrom: string },
): Promise<void> {
  const t = await withTenant(db, actor.orgId, (tx) => loadVersion(tx, input.timetableId));
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, t.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'school.timetable.manage', resource: resource(actor, place) },
    async (tx) => {
      const [v] = await tx.execute<{
        state: string;
        inYear: boolean;
        slots: number;
        taken: boolean;
      }>(sql`
        select t.state,
          ${input.effectiveFrom}::date >= app_today() and y.valid_during @> ${input.effectiveFrom}::date as "inYear",
          (select count(*)::int from school_timetable_slot s where s.org_id = t.org_id and s.timetable_id = t.id) as slots,
          exists (select 1 from school_timetable o where o.org_id = t.org_id and o.institution_id = t.institution_id
            and o.state = 'published' and o.effective_from = ${input.effectiveFrom}::date) as taken
        from school_timetable t join school_year y on y.org_id = t.org_id and y.id = t.year_id
        where t.org_id = app_current_org() and t.id = ${input.timetableId}
        for update of t`);
      if (v?.state !== 'draft') throw new TimetableError('not_draft');
      if (!v.inYear) throw new TimetableError('bad_date');
      if (v.slots === 0) throw new TimetableError('empty');
      if (v.taken) throw new TimetableError('date_taken');
      const clashes = await tx.execute<Clash>(sql`
        with others as (
          select o.id, i.name as school,
            lead(o.effective_from) over (partition by o.institution_id order by o.effective_from) as until
          from school_timetable o join institution i on i.org_id = o.org_id and i.id = o.institution_id
          where o.org_id = app_current_org() and o.state = 'published' and o.institution_id <> ${t.institutionId}
        )
        select distinct p.legal_name as teacher, s.weekday,
          (select count(*)::int from school_timetable_period c where c.org_id = s.org_id
            and c.timetable_id = s.timetable_id and c.kind = 'class' and c.number <= s.period) as period,
          x.school
        from school_timetable_slot s
        join school_timetable_period sp on sp.org_id = s.org_id and sp.timetable_id = s.timetable_id
          and sp.number = s.period
        join school_timetable_slot os on os.org_id = s.org_id and os.teacher_person_id = s.teacher_person_id
          and os.weekday = s.weekday
        join others x on x.id = os.timetable_id and (x.until is null or x.until > ${input.effectiveFrom}::date)
        join school_timetable_period op on op.org_id = os.org_id and op.timetable_id = os.timetable_id
          and op.number = os.period
        join person p on p.org_id = s.org_id and p.id = s.teacher_person_id
        where s.org_id = app_current_org() and s.timetable_id = ${input.timetableId}
          and sp.starts_at < op.ends_at and op.starts_at < sp.ends_at
        order by s.weekday, period`);
      if (clashes.length > 0)
        throw new TimetableError('clash_elsewhere', { clashes: [...clashes] });
      await tx.execute(sql`
        update school_timetable set state = 'published', effective_from = ${input.effectiveFrom}::date,
          published_at = now(), published_by_person_id = ${actor.personId}
        where org_id = app_current_org() and id = ${input.timetableId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.timetable.publish',
          entityType: 'school_timetable',
          entityId: input.timetableId,
          dataClass: 'operational',
          detail: { effectiveFrom: input.effectiveFrom, slots: v.slots },
        },
        events: [
          {
            type: TIMETABLE_PUBLISHED,
            payload: {
              timetableId: input.timetableId,
              institutionId: t.institutionId,
              effectiveFrom: input.effectiveFrom,
            },
          },
        ],
      };
    },
  );
}

/** The published version in effect on a date, if any. */
export async function versionOn(tx: Tx, institutionId: string, date: string) {
  const [v] = await tx.execute<{ id: string; days: number[] }>(sql`
    select id::text, days from school_timetable
    where org_id = app_current_org() and institution_id = ${institutionId} and state = 'published'
      and effective_from <= ${date}::date
    order by effective_from desc limit 1`);
  return v ?? null;
}

export type DayLesson = {
  slotId: string;
  period: number;
  /** "Period 3", counting class periods only. */
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  /** Null for a teaching group's lesson; sectionIds holds every section it brings together. */
  sectionId: string | null;
  sectionIds: string[];
  groupId: string | null;
  /** "Class 5-A", or for a group "Languages (Class 6-A, Class 6-B)". */
  section: string;
  subject: string;
  teacherPersonId: string | null;
  teacher: string | null;
  room: string | null;
  /** When the teacher is away and the lesson is covered (step 2). */
  cover: {
    kind: 'teacher' | 'combined' | 'supervised';
    personId: string | null;
    name: string | null;
  } | null;
};
export type DayExam = PaperOn & { invigilator: string | null };
export type DayPlan = {
  date: string;
  holiday: string | null;
  timetableId: string | null;
  periods: Period[];
  lessons: DayLesson[];
  /** Papers sat that day. A class sitting one has no lessons that day (decision 8). */
  exams: DayExam[];
};

export type DaySlot = {
  slotId: string;
  period: number;
  sectionId: string | null;
  groupId: string | null;
  groupName: string | null;
  sectionIds: string[];
  subjectId: string;
  teacherPersonId: string | null;
  room: string | null;
};

/** A version's slots on a weekday, each with the sections it brings together. */
export async function slotsOn(tx: Tx, timetableId: string, weekday: number): Promise<DaySlot[]> {
  return [
    ...(await tx.execute<DaySlot>(sql`
      select s.id::text as "slotId", s.period, s.section_id::text as "sectionId",
        s.group_id::text as "groupId", g.name as "groupName",
        case when s.group_id is null then array[s.section_id::text]
          else array(select gs.section_id::text from school_timetable_group_section gs
            where gs.org_id = s.org_id and gs.group_id = s.group_id) end as "sectionIds",
        s.subject_id::text as "subjectId", s.teacher_person_id::text as "teacherPersonId", s.room
      from school_timetable_slot s
      left join school_timetable_group g on g.org_id = s.org_id and g.id = s.group_id
      where s.org_id = app_current_org() and s.timetable_id = ${timetableId} and s.weekday = ${weekday}
      order by s.period, g.name nulls first`)),
  ];
}

/** The day's papers and the sections sitting one (whose lessons that day give way). */
export async function examDay(
  tx: Tx,
  institutionId: string,
  date: string,
  plan: TeachingPlan,
): Promise<{ papers: PaperOn[]; sitting: Set<string> }> {
  const papers = await papersOn(tx, institutionId, date);
  const classes = new Set(papers.map((p) => p.classId));
  return {
    papers,
    sitting: new Set(plan.sections.filter((x) => classes.has(x.classId)).map((x) => x.sectionId)),
  };
}

/** "Class 5-A", or "Languages (Class 6-A, Class 6-B)". */
export function slotLabel(slot: DaySlot, plan: TeachingPlan): string {
  const label = (id: string) => plan.sections.find((x) => x.sectionId === id)?.label ?? '';
  return slot.groupName
    ? `${slot.groupName} (${slot.sectionIds.map(label).filter(Boolean).sort().join(', ')})`
    : label(slot.sectionId ?? '');
}

/** Every lesson of a day from the version in effect; nothing on a holiday or a day off. */
export async function dayPlan(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; date?: string | undefined },
): Promise<DayPlan> {
  return withTenant(db, actor.orgId, async (tx) => {
    const place = await placeFor(tx, input.institutionId);
    await permissions.assertCan(tx, actor, 'school.timetable.read', resource(actor, place));
    return planIn(tx, input.institutionId, input.date ?? (await today(tx)));
  });
}

/** A day's periods and lessons at an institution. No permission check: callers check. */
export async function planIn(tx: Tx, institutionId: string, date: string): Promise<DayPlan> {
  const empty = { date, holiday: null, timetableId: null, periods: [], lessons: [], exams: [] };
  const holiday = await holidayOn(tx, institutionId, date);
  if (holiday) return { ...empty, holiday };
  const plan = await teachingPlan(tx, institutionId, date);
  const exam = await examDay(tx, institutionId, date, plan);
  const v = await versionOn(tx, institutionId, date);
  const day = weekday(date);
  const invigilators = await displayNames(tx, [
    ...new Set(exam.papers.map((p) => p.invigilatorPersonId).filter((x): x is string => !!x)),
  ]);
  const exams = exam.papers.map((p) => ({
    ...p,
    invigilator: p.invigilatorPersonId ? (invigilators[p.invigilatorPersonId] ?? null) : null,
  }));
  if (!v || !v.days.includes(day)) return { ...empty, timetableId: v?.id ?? null, exams };
  const periods = await tx.execute<Period>(sql`
    select number, to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt",
      kind, label,
      case when kind = 'class' then count(*) filter (where kind = 'class') over (order by number) end::int
        as ordinal
    from school_timetable_period where org_id = app_current_org() and timetable_id = ${v.id} order by number`);
  const slots = (await slotsOn(tx, v.id, day)).filter(
    (x) => !x.sectionIds.some((id) => exam.sitting.has(id)),
  );
  const covers = await tx.execute<{
    slotId: string;
    kind: 'teacher' | 'combined' | 'supervised';
    personId: string | null;
  }>(sql`
    select slot_id::text as "slotId", kind, covering_person_id::text as "personId" from school_cover
    where org_id = app_current_org() and institution_id = ${institutionId} and cover_date = ${date}::date
      and cancelled_at is null`);
  const names = await displayNames(tx, [
    ...new Set(
      [...slots.map((r) => r.teacherPersonId), ...covers.map((c) => c.personId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ]);
  const subject = new Map(plan.offerings.map((o) => [o.subjectId, o.name]));
  return {
    date,
    holiday: null,
    timetableId: v.id,
    periods: [...periods],
    exams,
    lessons: slots.map((r) => {
      const p = periods.find((x) => x.number === r.period);
      const c = covers.find((x) => x.slotId === r.slotId);
      return {
        slotId: r.slotId,
        period: r.period,
        ordinal: p?.ordinal ?? null,
        startsAt: p?.startsAt ?? '',
        endsAt: p?.endsAt ?? '',
        sectionId: r.sectionId,
        sectionIds: r.sectionIds,
        groupId: r.groupId,
        section: slotLabel(r, plan),
        subject: subject.get(r.subjectId) ?? '',
        teacherPersonId: r.teacherPersonId,
        teacher: r.teacherPersonId ? (names[r.teacherPersonId] ?? null) : null,
        room: r.room,
        cover: c
          ? {
              kind: c.kind,
              personId: c.personId,
              name: c.personId ? (names[c.personId] ?? null) : null,
            }
          : null,
      };
    }),
  };
}
