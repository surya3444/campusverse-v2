// Each academic year has its own structure (owner's brief, 20 Nov 2026). A class runs in a year
// when it has sections in that year; its sections can be added, renamed and resized, removed while
// nobody has used them, or closed once they have history (closed sections keep their students and
// records and take no new ones). A closed year can't change. The class list is the board's standard
// list (LKG to Class 12), so admission age rules always apply.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { CBSE_CLASSES, CBSE_DEFAULT_SUBJECTS, SUBJECTS } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import { institutionResource, SetupError, STRUCTURE_APPLIED } from './common.js';
import { assertYearOpen } from './sections.js';

type Permissions = ReturnType<typeof createPermissions>;

const SECTION_NAME = /^[A-Z0-9]{1,4}$/;
/** The Postgres error code, wherever the driver put it (on the error or its cause). */
const pgCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code ?? x?.cause?.code;
};
const isUniqueViolation = (e: unknown) => pgCode(e) === '23505';
const isForeignKeyViolation = (e: unknown) => pgCode(e) === '23503';

/** Whether a section has history: a student ever placed in it, attendance, homework or a timetable. */
export async function sectionInUse(tx: Tx, sectionId: string): Promise<boolean> {
  const [r] = await tx.execute<{ used: boolean }>(sql`
    select exists (select 1 from school_enrolment where org_id = app_current_org() and section_id = ${sectionId})
      or exists (select 1 from school_attendance_session where org_id = app_current_org() and section_id = ${sectionId})
      or exists (select 1 from school_homework_section where org_id = app_current_org() and section_id = ${sectionId})
      or exists (select 1 from school_timetable_slot where org_id = app_current_org() and section_id = ${sectionId})
      as used`);
  return !!r?.used;
}

type SectionRow = {
  sectionId: string;
  yearId: string;
  classId: string;
  institutionId: string;
  name: string;
  capacity: number;
  closed: boolean;
  label: string;
};

async function loadSection(tx: Tx, sectionId: string): Promise<SectionRow> {
  const [s] = await tx.execute<SectionRow>(sql`
    select s.id::text as "sectionId", s.year_id::text as "yearId", s.class_id::text as "classId",
      y.institution_id::text as "institutionId", s.name, s.capacity, s.closed_at is not null as closed,
      c.name || '-' || s.name as label
    from school_section s
    join school_year y on y.org_id = s.org_id and y.id = s.year_id
    join school_class c on c.org_id = s.org_id and c.id = s.class_id
    where s.org_id = app_current_org() and s.id = ${sectionId} for update of s`);
  if (!s) throw new SetupError('section_not_found');
  return s;
}

/** Students in a section on the year's counting day (today, or the year's first or last day). */
async function headcount(tx: Tx, sectionId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`
    select count(distinct e.person_id)::int as n
    from school_enrolment e join school_section s on s.org_id = e.org_id and s.id = e.section_id
    join school_year y on y.org_id = s.org_id and y.id = s.year_id
    where e.org_id = app_current_org() and e.section_id = ${sectionId}
      and e.valid_during @> greatest(lower(y.valid_during), least(app_today(), upper(y.valid_during) - 1))`);
  return r?.n ?? 0;
}

/** Runs a structure change as a command on the section's (or year's) institution. */
async function change<T>(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  work: (
    tx: Tx,
  ) => Promise<{ result: T; entityId: string; detail: Record<string, string | number | boolean> }>,
): Promise<T> {
  const resource = await institutionResource(db, actor, institutionId);
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const r = await work(tx);
      return {
        result: r.result,
        audit: {
          action: 'school.setup.manage',
          entityType: 'school_section',
          entityId: r.entityId,
          dataClass: 'operational',
          detail: r.detail,
        },
        events: [{ type: STRUCTURE_APPLIED, payload: { institutionId, structure: true } }],
      };
    },
  );
}

const institutionOfSection = (db: Db, actor: Actor, sectionId: string) =>
  withTenant(db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ i: string }>(sql`
      select y.institution_id::text as i from school_section s join school_year y on y.org_id = s.org_id and y.id = s.year_id
      where s.org_id = app_current_org() and s.id = ${sectionId}`);
    if (!r) throw new SetupError('section_not_found');
    return r.i;
  });

const institutionOfYear = (db: Db, actor: Actor, yearId: string) =>
  withTenant(db, actor.orgId, async (tx) => {
    const [y] = await tx.execute<{ i: string }>(sql`
      select institution_id::text as i from school_year where org_id = app_current_org() and id = ${yearId}`);
    if (!y) throw new SetupError('year_not_found');
    return y.i;
  });

/** A new section of a class in a year (the class must already run in the year, or be added with it). */
export async function addSection(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { yearId: string; classId: string; name: string; capacity: number },
): Promise<{ sectionId: string }> {
  const name = input.name.trim().toUpperCase();
  if (!SECTION_NAME.test(name)) throw new SetupError('bad_section_name');
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 80)
    throw new SetupError('bad_capacity');
  const institutionId = await institutionOfYear(db, actor, input.yearId);
  return change(db, permissions, actor, institutionId, async (tx) => {
    await assertYearOpen(tx, input.yearId);
    const [c] = await tx.execute(sql`
      select 1 from school_class where org_id = app_current_org() and id = ${input.classId}
        and institution_id = ${institutionId}`);
    if (!c) throw new SetupError('class_not_found');
    try {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_section (org_id, year_id, class_id, name, capacity)
        values (app_current_org(), ${input.yearId}, ${input.classId}, ${name}, ${input.capacity})
        returning id::text`);
      if (!row) throw new Error('addSection: no row');
      return {
        result: { sectionId: row.id },
        entityId: row.id,
        detail: { step: 'add_section', name, capacity: input.capacity },
      };
    } catch (e) {
      if (isUniqueViolation(e)) throw new SetupError('section_name_taken', { name });
      throw e;
    }
  });
}

/** A section's name or capacity. Capacity can't go below the students already in it. */
export async function updateSection(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { sectionId: string; name?: string | undefined; capacity?: number | undefined },
): Promise<void> {
  const name = input.name?.trim().toUpperCase();
  if (name !== undefined && !SECTION_NAME.test(name)) throw new SetupError('bad_section_name');
  if (
    input.capacity !== undefined &&
    (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 80)
  )
    throw new SetupError('bad_capacity');
  const institutionId = await institutionOfSection(db, actor, input.sectionId);
  await change(db, permissions, actor, institutionId, async (tx) => {
    const s = await loadSection(tx, input.sectionId);
    await assertYearOpen(tx, s.yearId);
    if (input.capacity !== undefined) {
      const n = await headcount(tx, s.sectionId);
      if (input.capacity < n) throw new SetupError('below_headcount', { students: n });
    }
    try {
      await tx.execute(sql`
        update school_section set name = coalesce(${name ?? null}, name), capacity = coalesce(${input.capacity ?? null}::int, capacity)
        where org_id = app_current_org() and id = ${s.sectionId}`);
    } catch (e) {
      if (isUniqueViolation(e)) throw new SetupError('section_name_taken', { name });
      throw e;
    }
    return {
      result: undefined,
      entityId: s.sectionId,
      detail: {
        step: 'update_section',
        renamed: name !== undefined && name !== s.name,
        capacity: input.capacity ?? s.capacity,
      },
    };
  });
}

/**
 * Removes a section nobody has used (no student ever placed, no attendance, homework or timetable),
 * with its teacher allocations. A section with history is closed instead.
 */
export async function removeSection(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  sectionId: string,
): Promise<void> {
  const institutionId = await institutionOfSection(db, actor, sectionId);
  await change(db, permissions, actor, institutionId, async (tx) => {
    const s = await loadSection(tx, sectionId);
    await assertYearOpen(tx, s.yearId);
    await dropSection(tx, s);
    return {
      result: undefined,
      entityId: sectionId,
      detail: { step: 'remove_section', name: s.label },
    };
  });
}

async function dropSection(tx: Tx, s: SectionRow) {
  if (await sectionInUse(tx, s.sectionId))
    throw new SetupError('section_in_use', { label: s.label });
  await tx.execute(sql`
    delete from school_teacher_allocation where org_id = app_current_org() and section_id = ${s.sectionId}`);
  try {
    await tx.execute(
      sql`delete from school_section where org_id = app_current_org() and id = ${s.sectionId}`,
    );
  } catch (e) {
    // Anything else that points at it (a plan, a diary entry) also means it has history.
    if (isForeignKeyViolation(e)) throw new SetupError('section_in_use', { label: s.label });
    throw e;
  }
  // A class with no sections left doesn't run that year: its subjects for the year go too.
  const [left] = await tx.execute(sql`
    select 1 from school_section where org_id = app_current_org() and year_id = ${s.yearId} and class_id = ${s.classId}`);
  if (!left)
    await tx.execute(sql`
      delete from school_subject_offering where org_id = app_current_org() and year_id = ${s.yearId}
        and class_id = ${s.classId}`);
}

/** Closes a section to new students (it keeps its students and records), or opens it again. */
export async function setSectionClosed(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { sectionId: string; closed: boolean },
): Promise<void> {
  const institutionId = await institutionOfSection(db, actor, input.sectionId);
  await change(db, permissions, actor, institutionId, async (tx) => {
    const s = await loadSection(tx, input.sectionId);
    await assertYearOpen(tx, s.yearId);
    if (s.closed === input.closed)
      throw new SetupError(input.closed ? 'section_closed' : 'section_open');
    await tx.execute(sql`
      update school_section set closed_at = ${input.closed ? sql`now()` : sql`null`},
        closed_by_person_id = ${input.closed ? actor.personId : null}
      where org_id = app_current_org() and id = ${s.sectionId}`);
    return {
      result: undefined,
      entityId: s.sectionId,
      detail: { step: input.closed ? 'close_section' : 'open_section', name: s.label },
    };
  });
}

/** Ensures a standard class exists for the institution; returns its id. */
async function ensureClass(tx: Tx, institutionId: string, code: string): Promise<string> {
  const def = CBSE_CLASSES.find((c) => c.code === code);
  if (!def) throw new SetupError('unknown_class', { class: code });
  await tx.execute(sql`
    insert into school_class (org_id, institution_id, code, name, sequence)
    values (app_current_org(), ${institutionId}, ${def.code}, ${def.name}, ${def.sequence})
    on conflict (org_id, institution_id, code) do nothing`);
  const [c] = await tx.execute<{ id: string }>(sql`
    select id::text from school_class where org_id = app_current_org() and institution_id = ${institutionId}
      and code = ${def.code}`);
  if (!c) throw new Error('ensureClass: no class');
  return c.id;
}

/**
 * A class's subjects for a year: the ones it had in the latest earlier year, or the board's
 * defaults for a class the school hasn't run before.
 */
async function giveSubjects(
  tx: Tx,
  institutionId: string,
  yearId: string,
  classId: string,
  code: string,
) {
  const copied = await tx.execute(sql`
    insert into school_subject_offering (org_id, year_id, class_id, subject_id, periods_per_week)
    select o.org_id, ${yearId}, o.class_id, o.subject_id, o.periods_per_week
    from school_subject_offering o join school_year y on y.org_id = o.org_id and y.id = o.year_id
    where o.org_id = app_current_org() and o.class_id = ${classId} and y.institution_id = ${institutionId}
      and y.id = (
        select y2.id from school_year y2 join school_subject_offering o2 on o2.org_id = y2.org_id and o2.year_id = y2.id
        where y2.org_id = app_current_org() and y2.institution_id = ${institutionId} and o2.class_id = ${classId}
          and y2.id <> ${yearId}
        order by lower(y2.valid_during) desc limit 1)
    on conflict (org_id, year_id, class_id, subject_id) do nothing
    returning 1`);
  if (copied.length > 0) return;
  for (const s of CBSE_DEFAULT_SUBJECTS.byClass[code] ?? []) {
    await tx.execute(sql`
      insert into school_subject (org_id, institution_id, code, name)
      values (app_current_org(), ${institutionId}, ${s}, ${SUBJECTS[s]})
      on conflict (org_id, institution_id, code) do nothing`);
    await tx.execute(sql`
      insert into school_subject_offering (org_id, year_id, class_id, subject_id)
      select app_current_org(), ${yearId}, ${classId}, id from school_subject
      where org_id = app_current_org() and institution_id = ${institutionId} and code = ${s}
      on conflict (org_id, year_id, class_id, subject_id) do nothing`);
  }
}

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A class starts running in a year with its sections (A, B, …) and its subjects. */
export async function addClassToYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { yearId: string; code: string; sections: number; capacity: number },
): Promise<{ classId: string }> {
  if (!Number.isInteger(input.sections) || input.sections < 1 || input.sections > 26)
    throw new SetupError('bad_sections');
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 80)
    throw new SetupError('bad_capacity');
  const institutionId = await institutionOfYear(db, actor, input.yearId);
  return change(db, permissions, actor, institutionId, async (tx) => {
    await assertYearOpen(tx, input.yearId);
    const classId = await ensureClass(tx, institutionId, input.code);
    const [runs] = await tx.execute(sql`
      select 1 from school_section where org_id = app_current_org() and year_id = ${input.yearId} and class_id = ${classId}`);
    if (runs) throw new SetupError('class_runs', { class: input.code });
    for (let i = 0; i < input.sections; i++)
      await tx.execute(sql`
        insert into school_section (org_id, year_id, class_id, name, capacity)
        values (app_current_org(), ${input.yearId}, ${classId}, ${SECTION_LETTERS.charAt(i)}, ${input.capacity})`);
    await giveSubjects(tx, institutionId, input.yearId, classId, input.code);
    return {
      result: { classId },
      entityId: classId,
      detail: { step: 'add_class', class: input.code, sections: input.sections },
    };
  });
}

/** A class stops running in a year: all its sections are removed (each must be unused). */
export async function removeClassFromYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { yearId: string; classId: string },
): Promise<void> {
  const institutionId = await institutionOfYear(db, actor, input.yearId);
  await change(db, permissions, actor, institutionId, async (tx) => {
    await assertYearOpen(tx, input.yearId);
    const ids = await tx.execute<{ id: string }>(sql`
      select id::text from school_section where org_id = app_current_org() and year_id = ${input.yearId}
        and class_id = ${input.classId}`);
    if (ids.length === 0) throw new SetupError('class_not_running');
    for (const r of ids) await dropSection(tx, await loadSection(tx, r.id));
    return {
      result: undefined,
      entityId: input.classId,
      detail: { step: 'remove_class', sections: ids.length },
    };
  });
}

/** The structure for a new year: each class that runs, with its sections. */
export type YearPlan = {
  classes: { code: string; sections: { name: string; capacity: number }[] }[];
};

export function yearPlanProblems(plan: YearPlan): string[] {
  const problems: string[] = [];
  if (plan.classes.length === 0) problems.push('no_classes');
  const codes = new Set<string>();
  for (const c of plan.classes) {
    if (!CBSE_CLASSES.some((d) => d.code === c.code)) problems.push(`unknown_class:${c.code}`);
    if (codes.has(c.code)) problems.push(`duplicate_class:${c.code}`);
    codes.add(c.code);
    if (c.sections.length === 0) problems.push(`no_sections:${c.code}`);
    const names = new Set<string>();
    for (const s of c.sections) {
      const n = s.name.trim().toUpperCase();
      if (!SECTION_NAME.test(n) || names.has(n)) problems.push(`bad_section:${c.code}:${s.name}`);
      names.add(n);
      if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 80)
        problems.push(`bad_capacity:${c.code}:${s.name}`);
    }
  }
  return problems;
}

/** Writes a planned year's classes and sections. Call inside the next-year command. */
export async function applyYearPlan(tx: Tx, institutionId: string, yearId: string, plan: YearPlan) {
  let sections = 0;
  for (const c of plan.classes) {
    const classId = await ensureClass(tx, institutionId, c.code);
    for (const s of c.sections) {
      await tx.execute(sql`
        insert into school_section (org_id, year_id, class_id, name, capacity)
        values (app_current_org(), ${yearId}, ${classId}, ${s.name.trim().toUpperCase()}, ${s.capacity})`);
      sections++;
    }
    await giveSubjects(tx, institutionId, yearId, classId, c.code);
  }
  return sections;
}
