// Cover (Milestone 19 step 2): each lesson of a teacher who is away (as the staff register says),
// with free teachers ranked to take it, and the office's choice recorded and sent to the teacher.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { staffAt } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { holidayOn } from '@campusverse/school-attendance';
import { teachingPlan } from '@campusverse/school-setup';
import { awayOn } from '@campusverse/shared-staff-attendance';
import { sql } from 'drizzle-orm';
import { rankCover, type Candidate } from '../domain/cover.js';
import { weekday } from '../domain/timetable.js';
import {
  examDay,
  slotLabel,
  slotsOn,
  TimetableError,
  versionOn,
  type DaySlot,
} from './timetable.js';
import type { PaperOn } from '@campusverse/school-exams';

type Permissions = ReturnType<typeof createPermissions>;

export const COVER_ASSIGNED = 'school.cover.assigned.v1';

export type CoverKind = 'teacher' | 'combined' | 'supervised';

export type CoverLesson = {
  slotId: string;
  period: number;
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  section: string;
  subject: string;
  cover: { id: string; kind: CoverKind; personId: string | null; name: string | null } | null;
  /** Free teachers, best first (top five). */
  suggestions: Candidate[];
};
export type CoverDay = {
  date: string;
  holiday: string | null;
  timetableId: string | null;
  away: {
    personId: string;
    name: string;
    status: 'absent' | 'on_leave' | 'on_duty';
    reason: string | null;
    lessons: CoverLesson[];
  }[];
  /** Everyone teaching that day who isn't away: for "mark someone away". */
  teaching: { personId: string; name: string; lessons: number }[];
  /** Lessons of away teachers not yet covered. */
  open: number;
};

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

async function placeFor(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new TimetableError('institution_not_found');
  return p;
}

/** Invigilating a paper that overlaps the period (a paper with no time takes the day). */
const invigilating = (papers: PaperOn[], p: { startsAt: string; endsAt: string } | undefined) =>
  papers
    .filter(
      (x) =>
        x.invigilatorPersonId &&
        (!x.startsAt || !x.endsAt || !p || (x.startsAt < p.endsAt && p.startsAt < x.endsAt)),
    )
    .map((x) => x.invigilatorPersonId);

async function load(tx: Tx, institutionId: string, date: string) {
  const v = await versionOn(tx, institutionId, date);
  const day = weekday(date);
  if (!v || !v.days.includes(day)) return null;
  const periods = await tx.execute<{
    number: number;
    ordinal: number | null;
    startsAt: string;
    endsAt: string;
  }>(sql`
    select number, to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt",
      case when kind = 'class' then count(*) filter (where kind = 'class') over (order by number) end::int
        as ordinal
    from school_timetable_period where org_id = app_current_org() and timetable_id = ${v.id}`);
  // On an exam day, a sitting class's lessons give way (they need no cover) and invigilators are busy.
  const plan = await teachingPlan(tx, institutionId, date);
  const exam = await examDay(tx, institutionId, date, plan);
  const slots: DaySlot[] = (await slotsOn(tx, v.id, day)).filter(
    (x) => !x.sectionIds.some((id) => exam.sitting.has(id)),
  );
  // The whole week's slots: who teaches which subject, and to which sections.
  const week = await tx.execute<{
    sectionId: string;
    subjectId: string;
    teacherPersonId: string;
  }>(sql`
    select distinct section_id::text as "sectionId", subject_id::text as "subjectId",
      teacher_person_id::text as "teacherPersonId"
    from school_timetable_slot where org_id = app_current_org() and timetable_id = ${v.id}
      and teacher_person_id is not null and section_id is not null`);
  const covers = await tx.execute<{
    id: string;
    slotId: string;
    period: number;
    kind: CoverKind;
    personId: string | null;
  }>(sql`
    select id::text, slot_id::text as "slotId", period, kind, covering_person_id::text as "personId"
    from school_cover where org_id = app_current_org() and institution_id = ${institutionId}
      and cover_date = ${date}::date and cancelled_at is null`);
  // Covers taken this week (Monday to the day), for sharing the load fairly.
  const load = await tx.execute<{ personId: string; n: number }>(sql`
    select covering_person_id::text as "personId", count(*)::int as n from school_cover
    where org_id = app_current_org() and institution_id = ${institutionId} and cancelled_at is null
      and covering_person_id is not null
      and cover_date between ${date}::date - (extract(isodow from ${date}::date)::int - 1) and ${date}::date
    group by covering_person_id`);
  return { version: v, periods, slots, week, covers, load, plan, papers: exam.papers };
}

/** Who is away on a date, each of their lessons, how it's covered, and who could take it. */
export async function coverDay(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; date?: string | undefined },
): Promise<CoverDay> {
  return withTenant(db, actor.orgId, async (tx) => {
    const place = await placeFor(tx, input.institutionId);
    await permissions.assertCan(tx, actor, 'school.cover.manage', { orgId: actor.orgId, place });
    const date = input.date ?? (await today(tx));
    const empty = { date, holiday: null, timetableId: null, away: [], teaching: [], open: 0 };
    const holiday = await holidayOn(tx, input.institutionId, date);
    if (holiday) return { ...empty, holiday };
    const d = await load(tx, input.institutionId, date);
    if (!d) return empty;
    const plan = d.plan;
    const staff = await staffAt(tx, input.institutionId, date);
    const name = new Map(staff.map((s) => [s.personId, s.name]));
    const away = await awayOn(tx, input.institutionId, date);
    const awayIds = new Set(away.map((a) => a.personId));
    const subject = new Map(plan.offerings.map((o) => [o.subjectId, o.name]));
    const weekLoad = new Map(d.load.map((l) => [l.personId, l.n]));
    const lessonsToday = (id: string) => d.slots.filter((s) => s.teacherPersonId === id).length;

    const lessonsOf = (personId: string): CoverLesson[] =>
      d.slots
        .filter((s) => s.teacherPersonId === personId)
        .sort((a, b) => a.period - b.period)
        .map((s) => {
          const p = d.periods.find((x) => x.number === s.period);
          const c = d.covers.find((x) => x.slotId === s.slotId);
          // Free that period: not away, no lesson of their own, not covering another one.
          const busy = new Set([
            ...invigilating(d.papers, p),
            ...d.slots.filter((x) => x.period === s.period).map((x) => x.teacherPersonId),
            ...d.covers
              .filter((x) => x.period === s.period && x.slotId !== s.slotId)
              .map((x) => x.personId),
          ]);
          const free = staff.filter((m) => !awayIds.has(m.personId) && !busy.has(m.personId));
          return {
            slotId: s.slotId,
            period: s.period,
            ordinal: p?.ordinal ?? null,
            startsAt: p?.startsAt ?? '',
            endsAt: p?.endsAt ?? '',
            section: slotLabel(s, plan),
            subject: subject.get(s.subjectId) ?? '',
            cover: c
              ? {
                  id: c.id,
                  kind: c.kind,
                  personId: c.personId,
                  name: c.personId ? (name.get(c.personId) ?? null) : null,
                }
              : null,
            suggestions: rankCover(
              free.map((m) => ({
                personId: m.personId,
                name: m.name,
                teachesSubject: d.week.some(
                  (w) => w.teacherPersonId === m.personId && w.subjectId === s.subjectId,
                ),
                teachesSection: d.week.some(
                  (w) => w.teacherPersonId === m.personId && s.sectionIds.includes(w.sectionId),
                ),
                coversThisWeek: weekLoad.get(m.personId) ?? 0,
                lessonsToday: lessonsToday(m.personId),
              })),
            ).slice(0, 5),
          };
        });

    const awayList = away
      .map((a) => ({ ...a, name: name.get(a.personId) ?? '', lessons: lessonsOf(a.personId) }))
      .filter((a) => a.lessons.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    const teaching = staff
      .filter((m) => !awayIds.has(m.personId) && lessonsToday(m.personId) > 0)
      .map((m) => ({ personId: m.personId, name: m.name, lessons: lessonsToday(m.personId) }));
    return {
      date,
      holiday: null,
      timetableId: d.version.id,
      away: awayList,
      teaching,
      open: awayList.reduce((n, a) => n + a.lessons.filter((l) => !l.cover).length, 0),
    };
  });
}

/**
 * Covers one lesson of an away teacher: by a free teacher, combined with another class, or
 * supervised. A change replaces the earlier cover (kept, cancelled). The teacher is told.
 */
export async function assignCover(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    date: string;
    slotId: string;
    kind: CoverKind;
    coveringPersonId?: string | null | undefined;
    note?: string | null | undefined;
  },
): Promise<{ id: string }> {
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.cover.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [ok] = await tx.execute<{ fine: boolean }>(sql`
        select ${input.date}::date between app_today() and app_today() + 30 as fine`);
      if (!ok?.fine) throw new TimetableError('bad_date');
      const d = await load(tx, input.institutionId, input.date);
      const slot = d?.slots.find((s) => s.slotId === input.slotId);
      if (!d || !slot || !slot.teacherPersonId) throw new TimetableError('lesson_not_found');
      const away = await awayOn(tx, input.institutionId, input.date);
      if (!away.some((a) => a.personId === slot.teacherPersonId))
        throw new TimetableError('teacher_not_away');
      const by = input.kind === 'teacher' ? (input.coveringPersonId ?? null) : null;
      if (input.kind === 'teacher') {
        if (!by) throw new TimetableError('teacher_busy');
        const staff = await staffAt(tx, input.institutionId, input.date);
        if (!staff.some((m) => m.personId === by) || away.some((a) => a.personId === by))
          throw new TimetableError('teacher_busy');
        const p = d.periods.find((x) => x.number === slot.period);
        const busy =
          invigilating(d.papers, p).includes(by) ||
          d.slots.some((s) => s.period === slot.period && s.teacherPersonId === by) ||
          d.covers.some(
            (c) => c.period === slot.period && c.personId === by && c.slotId !== slot.slotId,
          );
        if (busy) throw new TimetableError('teacher_busy');
      }
      await tx.execute(sql`
        update school_cover set cancelled_at = now(), cancelled_by_person_id = ${actor.personId}
        where org_id = app_current_org() and slot_id = ${input.slotId} and cover_date = ${input.date}::date
          and cancelled_at is null`);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_cover (org_id, institution_id, cover_date, slot_id, period, absent_person_id, kind,
          covering_person_id, note, assigned_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.date}::date, ${input.slotId}, ${slot.period},
          ${slot.teacherPersonId}, ${input.kind}, ${by}, ${input.note?.trim() || null}, ${actor.personId})
        returning id::text`);
      const id = row?.id ?? '';
      return {
        result: { id },
        audit: {
          action: 'school.cover.assign',
          entityType: 'school_cover',
          entityId: id,
          dataClass: 'operational',
          detail: { date: input.date, kind: input.kind, coveringPersonId: by },
        },
        events: [
          {
            type: COVER_ASSIGNED,
            payload: { coverId: id, institutionId: input.institutionId, date: input.date },
          },
        ],
      };
    },
  );
}

/** Takes a cover back (the lesson is uncovered again). */
export async function cancelCover(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; coverId: string },
): Promise<void> {
  const place = await withTenant(db, actor.orgId, (tx) => placeFor(tx, input.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'school.cover.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [c] = await tx.execute(sql`
        update school_cover set cancelled_at = now(), cancelled_by_person_id = ${actor.personId}
        where org_id = app_current_org() and id = ${input.coverId} and institution_id = ${input.institutionId}
          and cancelled_at is null
        returning id`);
      if (!c) throw new TimetableError('lesson_not_found');
      return {
        result: undefined,
        audit: {
          action: 'school.cover.cancel',
          entityType: 'school_cover',
          entityId: input.coverId,
          dataClass: 'operational',
          detail: {},
        },
        events: [],
      };
    },
  );
}

export type FreeTeachers = {
  date: string;
  period: { ordinal: number; startsAt: string; endsAt: string } | null;
  /** Free that period (on the staff, not away, no lesson, not covering), fewest covers first. */
  free: { personId: string; name: string; coversThisWeek: number; lessonsToday: number }[];
};

/** Who is free in a period ("Period 3" counts class periods only) on a date. */
export async function freeTeachers(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; date?: string | undefined; ordinal: number },
): Promise<FreeTeachers> {
  return withTenant(db, actor.orgId, async (tx) => {
    const place = await placeFor(tx, input.institutionId);
    await permissions.assertCan(tx, actor, 'school.cover.manage', { orgId: actor.orgId, place });
    const date = input.date ?? (await today(tx));
    const d = (await holidayOn(tx, input.institutionId, date))
      ? null
      : await load(tx, input.institutionId, date);
    const p = d?.periods.find((x) => x.ordinal === input.ordinal);
    if (!d || !p) return { date, period: null, free: [] };
    const staff = await staffAt(tx, input.institutionId, date);
    const away = new Set((await awayOn(tx, input.institutionId, date)).map((a) => a.personId));
    const busy = new Set([
      ...invigilating(d.papers, p),
      ...d.slots.filter((x) => x.period === p.number).map((x) => x.teacherPersonId),
      ...d.covers.filter((x) => x.period === p.number).map((x) => x.personId),
    ]);
    const weekLoad = new Map(d.load.map((l) => [l.personId, l.n]));
    const free = rankCover(
      staff
        .filter((m) => !away.has(m.personId) && !busy.has(m.personId))
        .map((m) => ({
          personId: m.personId,
          name: m.name,
          teachesSubject: false,
          teachesSection: false,
          coversThisWeek: weekLoad.get(m.personId) ?? 0,
          lessonsToday: d.slots.filter((x) => x.teacherPersonId === m.personId).length,
        })),
    ).map(({ personId, name, coversThisWeek, lessonsToday }) => ({
      personId,
      name,
      coversThisWeek,
      lessonsToday,
    }));
    return {
      date,
      period: { ordinal: input.ordinal, startsAt: p.startsAt, endsAt: p.endsAt },
      free,
    };
  });
}
