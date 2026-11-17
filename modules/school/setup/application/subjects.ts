// Milestone 21: subjects on screen. Add, rename and retire subjects (marks keep pointing at a
// retired one), offer them to classes with periods per week, and choose who teaches each in each
// section. Teacher changes are dated: the old allocation ends yesterday, the new one starts today.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { staffAt } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { institutionResource, SetupError } from './common.js';
import { sectionHeadcounts } from '@campusverse/school-enrolment';
import { classesOf, sectionsOn, YEAR_STATUS, type YearStatus } from './sections.js';

type Permissions = ReturnType<typeof createPermissions>;
export type SubjectKind = 'scholastic' | 'co_scholastic' | 'language' | 'elective';

export type SubjectsOverview = {
  yearId: string | null;
  yearLabel: string | null;
  subjects: {
    subjectId: string;
    code: string;
    name: string;
    kind: SubjectKind;
    retired: boolean;
    classes: number;
  }[];
  classes: {
    classId: string;
    name: string;
    offerings: { subjectId: string; periodsPerWeek: number | null }[];
    sections: {
      sectionId: string;
      label: string;
      classTeacher: string | null;
      teachers: { subjectId: string; personId: string }[];
    }[];
  }[];
  staff: { personId: string; name: string; designation: string | null }[];
};

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

async function currentYear(tx: Tx, institutionId: string, on: string) {
  const [y] = await tx.execute<{ id: string; label: string }>(sql`
    select id::text, label from school_year
    where org_id = app_current_org() and institution_id = ${institutionId} and valid_during @> ${on}::date`);
  return y ?? null;
}

export async function subjectsOverview(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<SubjectsOverview> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const on = await today(tx);
    const year = await currentYear(tx, institutionId, on);
    const subjects = await tx.execute<SubjectsOverview['subjects'][number]>(sql`
      select s.id::text as "subjectId", s.code, s.name, s.kind, s.retired_at is not null as retired,
        (select count(*)::int from school_subject_offering o
          where o.org_id = s.org_id and o.subject_id = s.id and o.year_id = ${year?.id ?? null}::uuid) as classes
      from school_subject s where s.org_id = app_current_org() and s.institution_id = ${institutionId}
      order by s.retired_at nulls first, s.code`);
    const offerings = year
      ? await tx.execute<{ classId: string; subjectId: string; periodsPerWeek: number | null }>(sql`
          select class_id::text as "classId", subject_id::text as "subjectId", periods_per_week as "periodsPerWeek"
          from school_subject_offering where org_id = app_current_org() and year_id = ${year.id}`)
      : [];
    const sections = year ? await sectionsOn(tx, institutionId, on) : [];
    const allocations = await tx.execute<{
      sectionId: string;
      subjectId: string;
      personId: string;
    }>(sql`
      select section_id::text as "sectionId", subject_id::text as "subjectId", teacher_person_id::text as "personId"
      from school_teacher_allocation
      where org_id = app_current_org() and kind = 'subject_teacher' and valid_during @> ${on}::date`);
    return {
      yearId: year?.id ?? null,
      yearLabel: year?.label ?? null,
      subjects: [...subjects],
      classes: (await classesOf(tx, institutionId)).map((c) => ({
        classId: c.classId,
        name: c.name,
        offerings: offerings
          .filter((o) => o.classId === c.classId)
          .map((o) => ({ subjectId: o.subjectId, periodsPerWeek: o.periodsPerWeek })),
        sections: sections
          .filter((s) => s.classId === c.classId)
          .map((s) => ({
            sectionId: s.sectionId,
            label: s.label,
            classTeacher: s.classTeacherPersonId,
            teachers: allocations.filter((a) => a.sectionId === s.sectionId),
          })),
      })),
      staff: (await staffAt(tx, institutionId, on)).map((s) => ({
        personId: s.personId,
        name: s.name,
        designation: s.designation,
      })),
    };
  });
}

export type ClassesOverview = {
  years: {
    yearId: string;
    label: string;
    status: YearStatus;
    starts: string;
    /** Exclusive. */
    ends: string;
    /** Who is counted: today in the running year, the last day of a past one, the first of a future one. */
    countedOn: string;
    classes: {
      classId: string;
      name: string;
      sections: {
        sectionId: string;
        label: string;
        name: string;
        capacity: number;
        classTeacher: string | null;
        students: number;
      }[];
    }[];
  }[];
};

/** Every year of a school, newest first: its classes, sections, class teachers and headcounts. */
export async function classesOverview(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<ClassesOverview> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const years = await tx.execute<Omit<ClassesOverview['years'][number], 'classes'>>(sql`
      select id::text as "yearId", label, ${YEAR_STATUS} as status, lower(valid_during)::text as starts,
        upper(valid_during)::text as ends,
        greatest(lower(valid_during), least(app_today(), upper(valid_during) - 1))::text as "countedOn"
      from school_year where org_id = app_current_org() and institution_id = ${institutionId}
      order by lower(valid_during) desc`);
    const classes = await classesOf(tx, institutionId);
    const out: ClassesOverview['years'] = [];
    for (const y of years) {
      const sections = await sectionsOn(tx, institutionId, y.countedOn);
      const heads = await sectionHeadcounts(
        tx,
        sections.map((s) => s.sectionId),
        y.countedOn,
      );
      out.push({
        ...y,
        classes: classes
          .map((c) => ({
            classId: c.classId,
            name: c.name,
            sections: sections
              .filter((s) => s.classId === c.classId)
              .map((s) => ({
                sectionId: s.sectionId,
                label: s.label,
                name: s.name,
                capacity: s.capacity,
                classTeacher: s.classTeacherName,
                students: heads.get(s.sectionId) ?? 0,
              })),
          }))
          .filter((c) => c.sections.length > 0),
      });
    }
    return { years: out };
  });
}

const manage = async (db: Db, actor: Actor, institutionId: string) => ({
  permission: 'school.setup.manage',
  resource: await institutionResource(db, actor, institutionId),
});

export async function addSubject(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  input: { code: string; name: string; kind: SubjectKind },
): Promise<string> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(code)) throw new SetupError('bad_subject_code');
  return command(db, permissions, actor, await manage(db, actor, institutionId), async (tx) => {
    const [taken] = await tx.execute(sql`
      select 1 from school_subject where org_id = app_current_org() and institution_id = ${institutionId} and code = ${code}`);
    if (taken) throw new SetupError('subject_code_taken');
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into school_subject (org_id, institution_id, code, name, kind)
      values (app_current_org(), ${institutionId}, ${code}, ${input.name.trim()}, ${input.kind})
      returning id::text`);
    if (!row) throw new Error('addSubject: no row');
    return {
      result: row.id,
      audit: {
        action: 'school.setup.add_subject',
        entityType: 'school_subject',
        entityId: row.id,
        dataClass: 'operational',
        detail: { code, kind: input.kind },
      },
    };
  });
}

/** Name and type change; the code never does. Retiring hides a subject from new offerings. */
export async function updateSubject(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  subjectId: string,
  input: {
    name?: string | undefined;
    kind?: SubjectKind | undefined;
    retired?: boolean | undefined;
  },
): Promise<void> {
  await command(db, permissions, actor, await manage(db, actor, institutionId), async (tx) => {
    const r = await tx.execute(sql`
      update school_subject set
        name = coalesce(${input.name?.trim() || null}, name),
        kind = coalesce(${input.kind ?? null}, kind),
        retired_at = case when ${input.retired === undefined} then retired_at
          when ${input.retired ?? false} then coalesce(retired_at, now()) else null end
      where org_id = app_current_org() and institution_id = ${institutionId} and id = ${subjectId}`);
    if (r.count === 0) throw new SetupError('subject_not_found');
    return {
      result: undefined,
      audit: {
        action:
          input.retired === true
            ? 'school.setup.retire_subject'
            : input.retired === false
              ? 'school.setup.restore_subject'
              : 'school.setup.update_subject',
        entityType: 'school_subject',
        entityId: subjectId,
        dataClass: 'operational',
        detail: { name: input.name ? 'changed' : null, kind: input.kind ?? null },
      },
    };
  });
}

/** Offers a subject to a class this year with its periods per week, or takes it off (null). */
export async function setOffering(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  input: {
    classId: string;
    subjectId: string;
    offered: boolean;
    periodsPerWeek?: number | null | undefined;
  },
): Promise<void> {
  await command(db, permissions, actor, await manage(db, actor, institutionId), async (tx) => {
    const year = await currentYear(tx, institutionId, await today(tx));
    if (!year) throw new SetupError('no_current_year');
    const [s] = await tx.execute<{ retired: boolean }>(sql`
      select retired_at is not null as retired from school_subject
      where org_id = app_current_org() and institution_id = ${institutionId} and id = ${input.subjectId}`);
    if (!s) throw new SetupError('subject_not_found');
    if (input.offered && s.retired) throw new SetupError('subject_retired');
    if (input.offered)
      await tx.execute(sql`
        insert into school_subject_offering (org_id, year_id, class_id, subject_id, periods_per_week)
        values (app_current_org(), ${year.id}, ${input.classId}, ${input.subjectId}, ${input.periodsPerWeek ?? null})
        on conflict (org_id, year_id, class_id, subject_id) do update set periods_per_week = excluded.periods_per_week`);
    else
      await tx.execute(sql`
        delete from school_subject_offering where org_id = app_current_org() and year_id = ${year.id}
          and class_id = ${input.classId} and subject_id = ${input.subjectId}`);
    return {
      result: undefined,
      audit: {
        action: 'school.setup.set_offering',
        entityType: 'school_subject',
        entityId: input.subjectId,
        dataClass: 'operational',
        detail: {
          classId: input.classId,
          yearId: year.id,
          offered: input.offered,
          periodsPerWeek: input.periodsPerWeek ?? null,
        },
      },
    };
  });
}

/**
 * Who teaches a subject in a section from today (or the class teacher, with no subject). The
 * previous teacher's allocation ends yesterday; null leaves nobody assigned.
 */
export async function assignTeacher(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  input: { sectionId: string; subjectId: string | null; personId: string | null },
): Promise<void> {
  await command(db, permissions, actor, await manage(db, actor, institutionId), async (tx) => {
    const on = await today(tx);
    const section = (await sectionsOn(tx, institutionId, on)).find(
      (s) => s.sectionId === input.sectionId,
    );
    if (!section) throw new SetupError('section_not_found');
    if (
      input.personId &&
      !(await staffAt(tx, institutionId, on)).some((s) => s.personId === input.personId)
    )
      throw new SetupError('not_on_staff');
    const kind = input.subjectId ? 'subject_teacher' : 'class_teacher';
    const ended = await tx.execute(sql`
      update school_teacher_allocation
      set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${on}::date))
      where org_id = app_current_org() and section_id = ${input.sectionId} and kind = ${kind}
        and subject_id is not distinct from ${input.subjectId}::uuid and valid_during @> ${on}::date`);
    if (input.personId)
      await tx.execute(sql`
        insert into school_teacher_allocation (org_id, section_id, subject_id, teacher_person_id, kind, valid_during)
        values (app_current_org(), ${input.sectionId}, ${input.subjectId}, ${input.personId}, ${kind},
          daterange(${on}::date, ${section.yearEnds}::date))`);
    return {
      result: undefined,
      audit: {
        action: 'school.setup.assign_teacher',
        entityType: 'school_section',
        entityId: input.sectionId,
        dataClass: 'operational',
        detail: { subjectId: input.subjectId, teacher: input.personId, replaced: ended.count },
      },
    };
  });
}

export type TeachingPlan = {
  yearId: string | null;
  sections: { sectionId: string; classId: string; label: string }[];
  offerings: {
    classId: string;
    subjectId: string;
    code: string;
    name: string;
    periodsPerWeek: number | null;
  }[];
  /** Subject teachers on the date, per section. */
  teachers: { sectionId: string; subjectId: string; personId: string }[];
};

/**
 * What a timetable is built from: the year's sections, each class's subjects with periods per
 * week, and who teaches each subject in each section. The caller checks its own permission.
 */
export async function teachingPlan(
  tx: Tx,
  institutionId: string,
  on: string,
): Promise<TeachingPlan> {
  const year = await currentYear(tx, institutionId, on);
  if (!year) return { yearId: null, sections: [], offerings: [], teachers: [] };
  const sections = await sectionsOn(tx, institutionId, on);
  const offerings = await tx.execute<TeachingPlan['offerings'][number]>(sql`
    select o.class_id::text as "classId", s.id::text as "subjectId", s.code, s.name,
      o.periods_per_week as "periodsPerWeek"
    from school_subject_offering o join school_subject s on s.org_id = o.org_id and s.id = o.subject_id
    where o.org_id = app_current_org() and o.year_id = ${year.id} and s.retired_at is null
    order by s.code`);
  const teachers = await tx.execute<TeachingPlan['teachers'][number]>(sql`
    select a.section_id::text as "sectionId", a.subject_id::text as "subjectId",
      a.teacher_person_id::text as "personId"
    from school_teacher_allocation a join school_section s on s.org_id = a.org_id and s.id = a.section_id
    where a.org_id = app_current_org() and a.kind = 'subject_teacher' and s.year_id = ${year.id}
      and a.valid_during @> ${on}::date`);
  return {
    yearId: year.id,
    sections: sections.map((s) => ({ sectionId: s.sectionId, classId: s.classId, label: s.label })),
    offerings: [...offerings],
    teachers: [...teachers],
  };
}
