import type { Tx } from '@campusverse/db';
import { sectionRoster } from '@campusverse/school-enrolment';
import type { AudiencePort } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { SetupError } from './common.js';

export type SectionInfo = {
  sectionId: string;
  classId: string;
  className: string;
  label: string;
  /** The section's own name ("A"). */
  name: string;
  capacity: number;
  campusId: string;
  institutionId: string;
  yearId: string;
  yearStarts: string;
  /** Exclusive. */
  yearEnds: string;
  board: string;
  classTeacherPersonId: string | null;
  classTeacherName: string | null;
  /** Closed to new students; keeps its students and records. */
  closed: boolean;
};

const select = (onDate: string) => sql`
  select s.id::text as "sectionId", c.id::text as "classId", c.name as "className",
    c.name || '-' || s.name as label, s.name, s.capacity, i.campus_id::text as "campusId",
    i.id::text as "institutionId", y.id::text as "yearId", lower(y.valid_during)::text as "yearStarts",
    upper(y.valid_during)::text as "yearEnds", i.authority_code as board,
    ct.teacher_person_id::text as "classTeacherPersonId", p.legal_name as "classTeacherName",
    s.closed_at is not null as closed
  from school_section s
  join school_class c on c.org_id = s.org_id and c.id = s.class_id
  join school_year y on y.org_id = s.org_id and y.id = s.year_id
  join institution i on i.org_id = y.org_id and i.id = y.institution_id
  left join school_teacher_allocation ct on ct.org_id = s.org_id and ct.section_id = s.id
    and ct.kind = 'class_teacher' and ct.valid_during @> ${onDate}::date
  left join person p on p.org_id = ct.org_id and p.id = ct.teacher_person_id`;

/** A section and where it sits, with its class teacher on a date. Null if there is no such section. */
export async function sectionInfo(
  tx: Tx,
  sectionId: string,
  onDate: string,
): Promise<SectionInfo | null> {
  const [row] = await tx.execute<SectionInfo>(sql`
    ${select(onDate)} where s.org_id = app_current_org() and s.id = ${sectionId}`);
  return row ?? null;
}

/** Sections of an institution's year that covers the date, in class order. */
export async function sectionsOn(
  tx: Tx,
  institutionId: string,
  onDate: string,
): Promise<SectionInfo[]> {
  return [
    ...(await tx.execute<SectionInfo>(sql`
      ${select(onDate)}
      where s.org_id = app_current_org() and i.id = ${institutionId} and y.valid_during @> ${onDate}::date
      order by c.sequence, s.name`)),
  ];
}

/** Sections of one academic year, in class order (closed ones too; callers placing students skip them). */
export async function sectionsOfYear(
  tx: Tx,
  yearId: string,
  onDate: string,
): Promise<SectionInfo[]> {
  return [
    ...(await tx.execute<SectionInfo>(sql`
      ${select(onDate)}
      where s.org_id = app_current_org() and s.year_id = ${yearId}
      order by c.sequence, s.name`)),
  ];
}

/** An institution's academic year by its label ("2027-28"), or null if the school hasn't set it up. */
export async function yearByLabel(
  tx: Tx,
  institutionId: string,
  label: string,
): Promise<YearInfo | null> {
  const [y] = await tx.execute<YearInfo>(sql`
    select id::text as "yearId", label, lower(valid_during)::text as starts, upper(valid_during)::text as ends,
      ${YEAR_STATUS} as status
    from school_year where org_id = app_current_org() and institution_id = ${institutionId} and label = ${label}`);
  return y ?? null;
}

/**
 * Classes that run in a year (they have sections in it), in order, with their open seats: the
 * classes admissions offers for that year.
 */
export async function classesIn(
  tx: Tx,
  yearId: string,
): Promise<{ classId: string; code: string; name: string; sequence: number; capacity: number }[]> {
  return [
    ...(await tx.execute<{
      classId: string;
      code: string;
      name: string;
      sequence: number;
      capacity: number;
    }>(sql`
      select c.id::text as "classId", c.code, c.name, c.sequence,
        coalesce(sum(s.capacity) filter (where s.closed_at is null), 0)::int as capacity
      from school_section s join school_class c on c.org_id = s.org_id and c.id = s.class_id
      where s.org_id = app_current_org() and s.year_id = ${yearId}
      group by c.id, c.code, c.name, c.sequence
      having count(*) filter (where s.closed_at is null) > 0
      order by c.sequence`)),
  ];
}

/** Sections a person is class teacher of on a date. */
export async function classTeacherSections(
  tx: Tx,
  personId: string,
  onDate: string,
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select section_id::text as id from school_teacher_allocation
    where org_id = app_current_org() and teacher_person_id = ${personId}
      and kind = 'class_teacher' and valid_during @> ${onDate}::date`);
  return rows.map((r) => r.id);
}

/** Notice audiences for a school: whole classes and single sections of the current year. */
export const schoolAudience: AudiencePort = {
  /** Fee plans bill for one academic year; a closed year takes no new charges. */
  async periods(tx, institutionId) {
    return (await yearsOf(tx, institutionId)).map((y) => ({
      id: y.yearId,
      label: y.label,
      starts: y.starts,
      ends: y.ends,
      closed: y.status === 'closed',
    }));
  },
  async groups(tx, institutionId, onDate) {
    const sections = await sectionsOn(tx, institutionId, onDate);
    const classes = new Map(sections.map((s) => [s.classId, s.className]));
    return [
      ...[...classes].map(([id, label]) => ({ id, label })),
      ...sections.map((s) => ({ id: s.sectionId, label: s.label })),
    ];
  },
  async students(tx, institutionId, groupIds, onDate) {
    const chosen = groupIds && new Set(groupIds);
    const ids = new Set<string>();
    for (const s of await sectionsOn(tx, institutionId, onDate)) {
      if (chosen && !chosen.has(s.sectionId) && !chosen.has(s.classId)) continue;
      for (const r of await sectionRoster(tx, s.sectionId, onDate)) ids.add(r.personId);
    }
    return [...ids];
  },
};

export type ClassInfo = {
  classId: string;
  code: string;
  name: string;
  /** Order in the school: LKG 0, UKG 1, Class 1 is 2 … */
  sequence: number;
  institutionId: string;
  board: string;
  stateCode: string | null;
};

/** A class with its institution's board and state, for admission rules. */
export async function classInfo(tx: Tx, classId: string): Promise<ClassInfo | null> {
  const [row] = await tx.execute<ClassInfo>(sql`
    select c.id::text as "classId", c.code, c.name, c.sequence, c.institution_id::text as "institutionId",
      i.authority_code as board, i.state_code as "stateCode"
    from school_class c join institution i on i.org_id = c.org_id and i.id = c.institution_id
    where c.org_id = app_current_org() and c.id = ${classId}`);
  return row ?? null;
}

/** Classes of an institution in order, for admission forms and seats. */
export async function classesOf(
  tx: Tx,
  institutionId: string,
): Promise<{ classId: string; code: string; name: string; sequence: number }[]> {
  return [
    ...(await tx.execute<{ classId: string; code: string; name: string; sequence: number }>(sql`
      select id::text as "classId", code, name, sequence from school_class
      where org_id = app_current_org() and institution_id = ${institutionId} order by sequence`)),
  ];
}

/** Subjects offered to a class in a year, by code. */
export async function subjectsOf(
  tx: Tx,
  yearId: string,
  classId: string,
): Promise<{ subjectId: string; code: string; name: string }[]> {
  return [
    ...(await tx.execute<{ subjectId: string; code: string; name: string }>(sql`
      select s.id::text as "subjectId", s.code, s.name
      from school_subject_offering o join school_subject s on s.org_id = o.org_id and s.id = o.subject_id
      where o.org_id = app_current_org() and o.year_id = ${yearId} and o.class_id = ${classId}
      order by s.code`)),
  ];
}

/** Whether a person teaches a subject in a section on a date (subject teacher), or is its class teacher. */
export async function teaches(
  tx: Tx,
  input: { personId: string; sectionId: string; subjectId: string; onDate: string },
): Promise<boolean> {
  const [row] = await tx.execute(sql`
    select 1 from school_teacher_allocation
    where org_id = app_current_org() and section_id = ${input.sectionId} and teacher_person_id = ${input.personId}
      and valid_during @> ${input.onDate}::date and (kind = 'class_teacher' or subject_id = ${input.subjectId})
    limit 1`);
  return !!row;
}

export type YearInfo = {
  yearId: string;
  label: string;
  starts: string;
  ends: string;
  status: YearStatus;
};

/**
 * Where a year stands today: next (not started), active (running), ended (over, still open for
 * late corrections) or closed (locked: no attendance, marks or class changes).
 */
export type YearStatus = 'planned' | 'active' | 'ended' | 'closed';
export const YEAR_STATUS = sql`case when status = 'closed' then 'closed'
  when lower(valid_during) > app_today() then 'planned'
  when upper(valid_during) <= app_today() then 'ended' else 'active' end`;

/** Refuses a change to a closed year's data. Call inside the writing use case's transaction. */
export async function assertYearOpen(tx: Tx, yearId: string): Promise<void> {
  const [y] = await tx.execute<{ closed: boolean }>(sql`
    select status = 'closed' as closed from school_year where org_id = app_current_org() and id = ${yearId}`);
  if (y?.closed) throw new SetupError('year_closed');
}

/** An institution's academic years, oldest first. `ends` is exclusive. */
export async function yearsOf(tx: Tx, institutionId: string): Promise<YearInfo[]> {
  return [
    ...(await tx.execute<YearInfo>(sql`
      select id::text as "yearId", label, lower(valid_during)::text as starts, upper(valid_during)::text as ends,
        ${YEAR_STATUS} as status
      from school_year where org_id = app_current_org() and institution_id = ${institutionId}
      order by lower(valid_during)`)),
  ];
}
