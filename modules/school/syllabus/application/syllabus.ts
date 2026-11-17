// Syllabus and lesson plans (docs/specs/SYLLABUS.md): units per class, subject and year with a
// planned month; each section ticks units done; coverage against the plan; lesson plans per
// section, subject and day; copying last year's syllabus. Years, sections, subjects and who
// teaches what come from school/setup.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions, Resource } from '@campusverse/platform-permissions';
import { PermissionDenied } from '@campusverse/platform-permissions';
import {
  classTeacherSections,
  teachingPlan,
  teaches,
  yearsOf,
  type TeachingPlan,
} from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { coverage, nextYearMonth, planEditable, type Coverage } from '../domain/syllabus.js';

type Permissions = ReturnType<typeof createPermissions>;
export type SyllabusDeps = { db: Db; permissions: Permissions };

export const UNIT_COMPLETED = 'school.syllabus.unit_completed.v1';

export class SyllabusError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'no_year'
      | 'not_offered'
      | 'unit_not_found'
      | 'unit_in_use'
      | 'section_not_found'
      | 'already_done'
      | 'not_done'
      | 'bad_date'
      | 'plan_fixed'
      | 'nothing_to_copy',
  ) {
    super(`syllabus: ${code}`);
    this.name = 'SyllabusError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new SyllabusError('institution_not_found');
  return p;
}
const res = (actor: Actor, p: Resource['place']): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
});
const where = (deps: SyllabusDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, async (tx) => res(actor, await place(tx, institutionId)));

async function plan(tx: Tx, institutionId: string, on: string) {
  const p = await teachingPlan(tx, institutionId, on);
  if (!p.yearId) throw new SyllabusError('no_year');
  return p as TeachingPlan & { yearId: string };
}

async function manages(deps: SyllabusDeps, tx: Tx, actor: Actor, r: Resource) {
  return (await deps.permissions.can(tx, actor, 'school.syllabus.manage', r)).allowed;
}

/** May write units for this class and subject: manages, or teaches it in a section of the class. */
async function mayPlan(
  deps: SyllabusDeps,
  tx: Tx,
  actor: Actor,
  r: Resource,
  p: TeachingPlan,
  classId: string,
  subjectId: string,
  on: string,
) {
  if (await manages(deps, tx, actor, r)) return true;
  for (const s of p.sections.filter((x) => x.classId === classId))
    if (
      await teaches(tx, { personId: actor.personId, sectionId: s.sectionId, subjectId, onDate: on })
    )
      return true;
  return false;
}

/** May tick units or write lesson plans for this section and subject. */
async function mayTeach(
  deps: SyllabusDeps,
  tx: Tx,
  actor: Actor,
  r: Resource,
  sectionId: string,
  subjectId: string,
  on: string,
) {
  return (
    (await manages(deps, tx, actor, r)) ||
    (await teaches(tx, { personId: actor.personId, sectionId, subjectId, onDate: on }))
  );
}

function reading<T>(
  deps: SyllabusDeps,
  actor: Actor,
  institutionId: string,
  work: (tx: Tx, r: Resource) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = res(actor, await place(tx, institutionId));
    await deps.permissions.assertCan(tx, actor, 'school.syllabus.read', r);
    return work(tx, r);
  });
}

// ---------------------------------------------------------------------------------------------
// The plan for a class and subject
// ---------------------------------------------------------------------------------------------

export type ClassSubjects = {
  classId: string;
  className: string;
  subjects: { subjectId: string; name: string; mine: boolean }[];
};

/** This year's classes and their subjects; "mine" where the person teaches it. */
export async function classSubjects(
  deps: SyllabusDeps,
  actor: Actor,
  institutionId: string,
): Promise<ClassSubjects[]> {
  return reading(deps, actor, institutionId, async (tx) => {
    const on = await today(tx);
    const p = await teachingPlan(tx, institutionId, on);
    if (!p.yearId) return [];
    const classes = new Map<string, string>();
    for (const s of p.sections)
      if (!classes.has(s.classId)) classes.set(s.classId, s.label.replace(/-[^-]+$/, ''));
    const mine = new Set(
      p.teachers
        .filter((t) => t.personId === actor.personId)
        .map((t) => `${t.sectionId}:${t.subjectId}`),
    );
    // A class teacher teaches every subject of their section here.
    const ownSections = new Set(await classTeacherSections(tx, actor.personId, on));
    return [...classes].map(([classId, className]) => ({
      classId,
      className,
      subjects: p.offerings
        .filter((o) => o.classId === classId)
        .map((o) => ({
          subjectId: o.subjectId,
          name: o.name,
          mine: p.sections.some(
            (s) =>
              s.classId === classId &&
              (ownSections.has(s.sectionId) || mine.has(`${s.sectionId}:${o.subjectId}`)),
          ),
        })),
    }));
  });
}

export type UnitRow = {
  unitId: string;
  position: number;
  title: string;
  plannedMonth: string | null;
  periods: number | null;
  notes: string;
  inUse: boolean;
  done: { sectionId: string; completedOn: string; by: string | null }[];
};
export type SectionCoverage = Coverage & { sectionId: string; label: string; canTick: boolean };

/** One class and subject's units in order, with each section's ticks and coverage. */
export async function syllabusPlan(
  deps: SyllabusDeps,
  actor: Actor,
  input: { institutionId: string; classId: string; subjectId: string },
): Promise<{ units: UnitRow[]; sections: SectionCoverage[]; canEdit: boolean; today: string }> {
  return reading(deps, actor, input.institutionId, async (tx, r) => {
    const on = await today(tx);
    const p = await plan(tx, input.institutionId, on);
    if (!p.offerings.some((o) => o.classId === input.classId && o.subjectId === input.subjectId))
      throw new SyllabusError('not_offered');
    const units = await tx.execute<Omit<UnitRow, 'done'>>(sql`
      select u.id::text as "unitId", u.position, u.title, u.planned_month::text as "plannedMonth", u.periods, u.notes,
        (exists (select 1 from school_syllabus_progress g where g.org_id = u.org_id and g.unit_id = u.id)
          or exists (select 1 from school_lesson_plan l where l.org_id = u.org_id and l.unit_id = u.id)) as "inUse"
      from school_syllabus_unit u
      where u.org_id = app_current_org() and u.year_id = ${p.yearId} and u.class_id = ${input.classId}
        and u.subject_id = ${input.subjectId}
      order by u.position, u.id`);
    const ids = units.map((u) => u.unitId);
    const ticks = ids.length
      ? await tx.execute<{
          unitId: string;
          sectionId: string;
          completedOn: string;
          byId: string;
        }>(sql`
          select unit_id::text as "unitId", section_id::text as "sectionId", completed_on::text as "completedOn",
            completed_by_person_id::text as "byId"
          from school_syllabus_progress where org_id = app_current_org()
            and unit_id = any(${`{${ids.join(',')}}`}::uuid[])`)
      : [];
    const names = await displayNames(
      tx,
      ticks.map((t) => t.byId),
    );
    const sections = p.sections.filter((s) => s.classId === input.classId);
    const plans = units.map((u) => ({ id: u.unitId, plannedMonth: u.plannedMonth }));
    const out: SectionCoverage[] = [];
    for (const s of sections)
      out.push({
        sectionId: s.sectionId,
        label: s.label,
        canTick: await mayTeach(deps, tx, actor, r, s.sectionId, input.subjectId, on),
        ...coverage(
          plans,
          new Set(ticks.filter((t) => t.sectionId === s.sectionId).map((t) => t.unitId)),
          on,
        ),
      });
    return {
      today: on,
      canEdit: await mayPlan(deps, tx, actor, r, p, input.classId, input.subjectId, on),
      sections: out,
      units: units.map((u) => ({
        ...u,
        done: ticks
          .filter((t) => t.unitId === u.unitId)
          .map((t) => ({
            sectionId: t.sectionId,
            completedOn: t.completedOn,
            by: names[t.byId] ?? null,
          })),
      })),
    };
  });
}

export type UnitInput = {
  institutionId: string;
  classId: string;
  subjectId: string;
  id: string | null;
  title: string;
  plannedMonth: string | null;
  periods: number | null;
  notes: string;
};

/** Adds a unit at the end, or edits one. */
export async function saveUnit(
  deps: SyllabusDeps,
  actor: Actor,
  input: UnitInput,
): Promise<{ unitId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.syllabus.teach',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const on = await today(tx);
      const p = await plan(tx, input.institutionId, on);
      if (!p.offerings.some((o) => o.classId === input.classId && o.subjectId === input.subjectId))
        throw new SyllabusError('not_offered');
      const r = res(actor, await place(tx, input.institutionId));
      if (!(await mayPlan(deps, tx, actor, r, p, input.classId, input.subjectId, on)))
        throw new PermissionDenied('school.syllabus.teach', 'no_relationship');
      let unitId = input.id;
      if (unitId) {
        const done = await tx.execute(sql`
          update school_syllabus_unit set title = ${input.title.trim()}, planned_month = ${input.plannedMonth}::date,
            periods = ${input.periods}, notes = ${input.notes.trim()}
          where org_id = app_current_org() and id = ${unitId} and year_id = ${p.yearId}
            and class_id = ${input.classId} and subject_id = ${input.subjectId}
          returning id`);
        if (done.length === 0) throw new SyllabusError('unit_not_found');
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into school_syllabus_unit (org_id, year_id, class_id, subject_id, position, title, planned_month,
            periods, notes)
          select app_current_org(), ${p.yearId}, ${input.classId}, ${input.subjectId},
            coalesce(max(position), 0) + 1, ${input.title.trim()}, ${input.plannedMonth}::date, ${input.periods},
            ${input.notes.trim()}
          from school_syllabus_unit where org_id = app_current_org() and year_id = ${p.yearId}
            and class_id = ${input.classId} and subject_id = ${input.subjectId}
          returning id::text`);
        unitId = row?.id ?? '';
      }
      return {
        result: { unitId },
        audit: {
          action: 'school.syllabus.unit_save',
          entityType: 'school_syllabus_unit',
          entityId: unitId,
          dataClass: 'operational',
          detail: { title: input.title.trim(), plannedMonth: input.plannedMonth },
        },
      };
    },
  );
}

/** The unit's year, class and subject, with the check that the person may plan it. */
async function ownUnit(
  deps: SyllabusDeps,
  tx: Tx,
  actor: Actor,
  institutionId: string,
  unitId: string,
) {
  const on = await today(tx);
  const p = await plan(tx, institutionId, on);
  const [u] = await tx.execute<{
    classId: string;
    subjectId: string;
    position: number;
    inUse: boolean;
  }>(sql`
    select class_id::text as "classId", subject_id::text as "subjectId", position,
      (exists (select 1 from school_syllabus_progress g where g.org_id = u.org_id and g.unit_id = u.id)
        or exists (select 1 from school_lesson_plan l where l.org_id = u.org_id and l.unit_id = u.id)) as "inUse"
    from school_syllabus_unit u where u.org_id = app_current_org() and u.id = ${unitId} and u.year_id = ${p.yearId}
    for update`);
  if (!u) throw new SyllabusError('unit_not_found');
  const r = res(actor, await place(tx, institutionId));
  if (!(await mayPlan(deps, tx, actor, r, p, u.classId, u.subjectId, on)))
    throw new PermissionDenied('school.syllabus.teach', 'no_relationship');
  return { ...u, yearId: p.yearId };
}

/** Moves a unit one place up or down. */
export async function moveUnit(
  deps: SyllabusDeps,
  actor: Actor,
  input: { institutionId: string; unitId: string; direction: 'up' | 'down' },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.syllabus.teach',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const u = await ownUnit(deps, tx, actor, input.institutionId, input.unitId);
      const [n] = await tx.execute<{ id: string; position: number }>(sql`
        select id::text, position from school_syllabus_unit
        where org_id = app_current_org() and year_id = ${u.yearId} and class_id = ${u.classId}
          and subject_id = ${u.subjectId} and id <> ${input.unitId}
          and position ${input.direction === 'up' ? sql`<=` : sql`>=`} ${u.position}
        order by position ${input.direction === 'up' ? sql`desc` : sql`asc`}, id limit 1`);
      if (n) {
        const swap =
          n.position === u.position ? u.position + (input.direction === 'up' ? -1 : 1) : n.position;
        await tx.execute(sql`
          update school_syllabus_unit set position = ${u.position} where org_id = app_current_org() and id = ${n.id}`);
        await tx.execute(sql`
          update school_syllabus_unit set position = ${Math.max(1, swap)}
          where org_id = app_current_org() and id = ${input.unitId}`);
      }
      return {
        result: undefined,
        audit: {
          action: 'school.syllabus.unit_move',
          entityType: 'school_syllabus_unit',
          entityId: input.unitId,
          dataClass: 'operational',
          detail: { direction: input.direction },
        },
      };
    },
  );
}

/** Removes a unit nobody has ticked or planned a lesson for. */
export async function deleteUnit(
  deps: SyllabusDeps,
  actor: Actor,
  input: { institutionId: string; unitId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.syllabus.teach',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const u = await ownUnit(deps, tx, actor, input.institutionId, input.unitId);
      if (u.inUse) throw new SyllabusError('unit_in_use');
      await tx.execute(sql`
        delete from school_syllabus_unit where org_id = app_current_org() and id = ${input.unitId}`);
      return {
        result: undefined,
        audit: {
          action: 'school.syllabus.unit_delete',
          entityType: 'school_syllabus_unit',
          entityId: input.unitId,
          dataClass: 'operational',
          detail: {},
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Ticking units done
// ---------------------------------------------------------------------------------------------

/** Ticks (or unticks) a unit done for a section the person teaches. */
export async function tickUnit(
  deps: SyllabusDeps,
  actor: Actor,
  input: {
    institutionId: string;
    unitId: string;
    sectionId: string;
    done: boolean;
    onDate?: string | null | undefined;
    note?: string | undefined;
  },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.syllabus.teach',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const on = await today(tx);
      const p = await plan(tx, input.institutionId, on);
      const [u] = await tx.execute<{ classId: string; subjectId: string; title: string }>(sql`
        select class_id::text as "classId", subject_id::text as "subjectId", title from school_syllabus_unit
        where org_id = app_current_org() and id = ${input.unitId} and year_id = ${p.yearId}`);
      if (!u) throw new SyllabusError('unit_not_found');
      const s = p.sections.find((x) => x.sectionId === input.sectionId && x.classId === u.classId);
      if (!s) throw new SyllabusError('section_not_found');
      const r = res(actor, await place(tx, input.institutionId));
      if (!(await mayTeach(deps, tx, actor, r, s.sectionId, u.subjectId, on)))
        throw new PermissionDenied('school.syllabus.teach', 'no_relationship');
      const date = input.onDate ?? on;
      const year = (await yearsOf(tx, input.institutionId)).find((y) => y.yearId === p.yearId);
      if (date > on || (year && date < year.starts)) throw new SyllabusError('bad_date');
      if (input.done) {
        const done = await tx.execute(sql`
          insert into school_syllabus_progress (org_id, unit_id, section_id, completed_on, completed_by_person_id, note)
          values (app_current_org(), ${input.unitId}, ${input.sectionId}, ${date}::date, ${actor.personId},
            ${(input.note ?? '').trim()})
          on conflict do nothing returning unit_id`);
        if (done.length === 0) throw new SyllabusError('already_done');
      } else {
        const done = await tx.execute(sql`
          delete from school_syllabus_progress where org_id = app_current_org() and unit_id = ${input.unitId}
            and section_id = ${input.sectionId} returning unit_id`);
        if (done.length === 0) throw new SyllabusError('not_done');
      }
      return {
        result: undefined,
        audit: {
          action: input.done ? 'school.syllabus.unit_done' : 'school.syllabus.unit_undone',
          entityType: 'school_syllabus_unit',
          entityId: input.unitId,
          dataClass: 'operational',
          detail: { sectionId: input.sectionId, onDate: date },
        },
        events: input.done
          ? [
              {
                type: UNIT_COMPLETED,
                payload: { unitId: input.unitId, sectionId: input.sectionId, onDate: date },
              },
            ]
          : [],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Coverage across the school
// ---------------------------------------------------------------------------------------------

export type CoverageRow = {
  classId: string;
  className: string;
  subjectId: string;
  subject: string;
  units: number;
  expected: number;
  sections: { sectionId: string; label: string; done: number; percent: number; behind: boolean }[];
};

export async function schoolCoverage(
  deps: SyllabusDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ today: string; rows: CoverageRow[] }> {
  return reading(deps, actor, institutionId, async (tx) => {
    const on = await today(tx);
    const p = await teachingPlan(tx, institutionId, on);
    if (!p.yearId) return { today: on, rows: [] };
    const units = await tx.execute<{
      id: string;
      classId: string;
      subjectId: string;
      plannedMonth: string | null;
    }>(sql`
      select id::text, class_id::text as "classId", subject_id::text as "subjectId", planned_month::text as "plannedMonth"
      from school_syllabus_unit where org_id = app_current_org() and year_id = ${p.yearId}`);
    const ticks = await tx.execute<{ unitId: string; sectionId: string }>(sql`
      select g.unit_id::text as "unitId", g.section_id::text as "sectionId" from school_syllabus_progress g
      join school_syllabus_unit u on u.org_id = g.org_id and u.id = g.unit_id
      where g.org_id = app_current_org() and u.year_id = ${p.yearId}`);
    const rows: CoverageRow[] = [];
    for (const o of p.offerings) {
      const us = units.filter((u) => u.classId === o.classId && u.subjectId === o.subjectId);
      if (us.length === 0) continue;
      const plans = us.map((u) => ({ id: u.id, plannedMonth: u.plannedMonth }));
      const secs = p.sections.filter((s) => s.classId === o.classId);
      const covered = secs.map((s) => {
        const c = coverage(
          plans,
          new Set(ticks.filter((t) => t.sectionId === s.sectionId).map((t) => t.unitId)),
          on,
        );
        return {
          sectionId: s.sectionId,
          label: s.label,
          done: c.done,
          percent: c.percent,
          behind: c.behind,
        };
      });
      rows.push({
        classId: o.classId,
        className: secs[0]?.label.replace(/-[^-]+$/, '') ?? '',
        subjectId: o.subjectId,
        subject: o.name,
        units: us.length,
        expected: coverage(plans, new Set(), on).expected,
        sections: covered,
      });
    }
    return { today: on, rows };
  });
}

export async function syllabusFigures(deps: SyllabusDeps, actor: Actor, institutionId: string) {
  const c = await schoolCoverage(deps, actor, institutionId);
  const all = c.rows.flatMap((r) => r.sections);
  return {
    subjectsPlanned: c.rows.length,
    units: c.rows.reduce((n, r) => n + r.units, 0),
    averagePercent: all.length
      ? Math.floor(all.reduce((n, s) => n + s.percent, 0) / all.length)
      : 0,
    sectionsBehind: all.filter((s) => s.behind).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------------------------

export type LessonPlan = {
  planId: string;
  onDate: string;
  unitId: string | null;
  unit: string | null;
  plan: string;
  writtenBy: string | null;
  editable: boolean;
};

export async function lessonPlans(
  deps: SyllabusDeps,
  actor: Actor,
  input: { institutionId: string; sectionId: string; subjectId: string; from: string; to: string },
): Promise<LessonPlan[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const on = await today(tx);
    const rows = await tx.execute<
      Omit<LessonPlan, 'writtenBy' | 'editable'> & { byId: string }
    >(sql`
      select l.id::text as "planId", l.on_date::text as "onDate", l.unit_id::text as "unitId", u.title as unit,
        l.plan, l.written_by_person_id::text as "byId"
      from school_lesson_plan l left join school_syllabus_unit u on u.org_id = l.org_id and u.id = l.unit_id
      where l.org_id = app_current_org() and l.section_id = ${input.sectionId} and l.subject_id = ${input.subjectId}
        and l.on_date between ${input.from}::date and ${input.to}::date
      order by l.on_date`);
    const names = await displayNames(
      tx,
      rows.map((r) => r.byId),
    );
    return rows.map(({ byId, ...r }) => ({
      ...r,
      writtenBy: names[byId] ?? null,
      editable: planEditable(r.onDate, on),
    }));
  });
}

/** Writes or edits the lesson plan for a section, subject and day the person teaches. */
export async function saveLessonPlan(
  deps: SyllabusDeps,
  actor: Actor,
  input: {
    institutionId: string;
    sectionId: string;
    subjectId: string;
    onDate: string;
    unitId: string | null;
    plan: string;
  },
): Promise<{ planId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.syllabus.teach',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const on = await today(tx);
      const p = await plan(tx, input.institutionId, on);
      const s = p.sections.find((x) => x.sectionId === input.sectionId);
      if (!s) throw new SyllabusError('section_not_found');
      if (!p.offerings.some((o) => o.classId === s.classId && o.subjectId === input.subjectId))
        throw new SyllabusError('not_offered');
      const r = res(actor, await place(tx, input.institutionId));
      if (!(await mayTeach(deps, tx, actor, r, s.sectionId, input.subjectId, on)))
        throw new PermissionDenied('school.syllabus.teach', 'no_relationship');
      if (!planEditable(input.onDate, on)) throw new SyllabusError('plan_fixed');
      if (input.unitId) {
        const [u] = await tx.execute(sql`
          select 1 from school_syllabus_unit where org_id = app_current_org() and id = ${input.unitId}
            and year_id = ${p.yearId} and class_id = ${s.classId} and subject_id = ${input.subjectId}`);
        if (!u) throw new SyllabusError('unit_not_found');
      }
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_lesson_plan (org_id, section_id, subject_id, unit_id, on_date, plan, written_by_person_id)
        values (app_current_org(), ${input.sectionId}, ${input.subjectId}, ${input.unitId}, ${input.onDate}::date,
          ${input.plan.trim()}, ${actor.personId})
        on conflict (org_id, section_id, subject_id, on_date) do update set unit_id = excluded.unit_id,
          plan = excluded.plan, written_by_person_id = excluded.written_by_person_id, updated_at = now()
        returning id::text`);
      const planId = row?.id ?? '';
      return {
        result: { planId },
        audit: {
          action: 'school.syllabus.lesson_plan',
          entityType: 'school_lesson_plan',
          entityId: planId,
          dataClass: 'operational',
          detail: { sectionId: input.sectionId, onDate: input.onDate },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Copy from last year (preview, then commit)
// ---------------------------------------------------------------------------------------------

async function copyPlan(tx: Tx, institutionId: string, on: string) {
  const years = await yearsOf(tx, institutionId);
  const current = years.find((y) => y.starts <= on && on < y.ends);
  if (!current) throw new SyllabusError('no_year');
  const previous = years.filter((y) => y.ends <= current.starts).at(-1);
  if (!previous) return { current, previous: null, pairs: [] };
  const pairs = await tx.execute<{ classId: string; subjectId: string; units: number }>(sql`
    select o.class_id::text as "classId", o.subject_id::text as "subjectId", count(*)::int as units
    from school_syllabus_unit o
    where o.org_id = app_current_org() and o.year_id = ${previous.yearId}
      and not exists (select 1 from school_syllabus_unit n where n.org_id = o.org_id and n.year_id = ${current.yearId}
        and n.class_id = o.class_id and n.subject_id = o.subject_id)
    group by o.class_id, o.subject_id`);
  return { current, previous, pairs: [...pairs] };
}

export async function previewCopy(deps: SyllabusDeps, actor: Actor, institutionId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = res(actor, await place(tx, institutionId));
    await deps.permissions.assertCan(tx, actor, 'school.syllabus.manage', r);
    const c = await copyPlan(tx, institutionId, await today(tx));
    return {
      from: c.previous?.label ?? null,
      to: c.current.label,
      subjects: c.pairs.length,
      units: c.pairs.reduce((n, x) => n + x.units, 0),
    };
  });
}

export async function commitCopy(
  deps: SyllabusDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ subjects: number; units: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.syllabus.manage', resource: await where(deps, actor, institutionId) },
    async (tx) => {
      const c = await copyPlan(tx, institutionId, await today(tx));
      if (!c.previous || c.pairs.length === 0) throw new SyllabusError('nothing_to_copy');
      let units = 0;
      for (const pair of c.pairs) {
        const rows = await tx.execute<{
          position: number;
          title: string;
          plannedMonth: string | null;
          periods: number | null;
          notes: string;
        }>(sql`
          select position, title, planned_month::text as "plannedMonth", periods, notes from school_syllabus_unit
          where org_id = app_current_org() and year_id = ${c.previous.yearId} and class_id = ${pair.classId}
            and subject_id = ${pair.subjectId} order by position, id`);
        for (const u of rows) {
          await tx.execute(sql`
            insert into school_syllabus_unit (org_id, year_id, class_id, subject_id, position, title, planned_month,
              periods, notes)
            values (app_current_org(), ${c.current.yearId}, ${pair.classId}, ${pair.subjectId}, ${u.position},
              ${u.title}, ${nextYearMonth(u.plannedMonth)}::date, ${u.periods}, ${u.notes})`);
          units++;
        }
      }
      return {
        result: { subjects: c.pairs.length, units },
        audit: {
          action: 'school.syllabus.copy',
          entityType: 'institution',
          entityId: institutionId,
          dataClass: 'operational',
          detail: { from: c.previous.label, to: c.current.label, subjects: c.pairs.length, units },
        },
      };
    },
  );
}
