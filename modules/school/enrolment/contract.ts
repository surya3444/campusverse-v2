// Public API of school enrolment: who is in which section, when. Owns school_enrolment.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import type { AcademicPlacementPort } from '@campusverse/people-records';
import { sql } from 'drizzle-orm';

type Permissions = ReturnType<typeof createPermissions>;

export const SECTION_CHANGED = 'school.enrolment.section_changed.v1';

export class EnrolmentError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(`Enrolment: ${code}`);
    this.name = 'EnrolmentError';
  }
}

/**
 * What a section change asks the attendance module (wired by the API, so enrolment never reads
 * attendance's tables): the days on or after a date either section already took attendance.
 */
export type AttendanceTaken = (tx: Tx, sectionIds: string[], from: string) => Promise<string[]>;

/** The school's answer to "where is this person?": "Class 5-A" on a given day, or null. */
export const schoolPlacement: AcademicPlacementPort = {
  async getCurrentPlacement(tx, { personId, onDate }) {
    const [row] = await tx.execute<{
      institutionId: string;
      label: string;
      status: string;
      reference: string;
    }>(sql`
      select e.institution_id::text as "institutionId", c.name || '-' || s.name as label, e.status,
        e.admission_number as reference
      from school_enrolment e
      join school_section s on s.org_id = e.org_id and s.id = e.section_id
      join school_class c on c.org_id = s.org_id and c.id = s.class_id
      where e.org_id = app_current_org() and e.person_id = ${personId} and e.valid_during @> ${onDate}::date
      limit 1`);
    return row
      ? {
          institutionId: row.institutionId,
          institutionType: 'school',
          displayLabel: row.label,
          active: row.status === 'active',
          reference: row.reference,
        }
      : null;
  },
  async getPlacements(tx, { personIds, onDate }) {
    if (personIds.length === 0) return new Map();
    const rows = await tx.execute<{
      personId: string;
      institutionId: string;
      label: string;
      status: string;
      reference: string;
    }>(sql`
      select e.person_id::text as "personId", e.institution_id::text as "institutionId",
        c.name || '-' || s.name as label, e.status, e.admission_number as reference
      from school_enrolment e
      join school_section s on s.org_id = e.org_id and s.id = e.section_id
      join school_class c on c.org_id = s.org_id and c.id = s.class_id
      where e.org_id = app_current_org() and e.person_id = any(${`{${personIds.join(',')}}`}::uuid[])
        and e.valid_during @> ${onDate}::date`);
    return new Map(
      rows.map((r) => [
        r.personId,
        {
          institutionId: r.institutionId,
          institutionType: 'school' as const,
          displayLabel: r.label,
          active: r.status === 'active',
          reference: r.reference,
        },
      ]),
    );
  },
  async findByReference(tx, { institutionId, text }) {
    const prefix = `${text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await tx.execute<{ personId: string }>(sql`
      select distinct person_id::text as "personId" from school_enrolment
      where org_id = app_current_org() and institution_id = ${institutionId}
        and admission_number ilike ${prefix}
      limit 20`);
    return rows.map((r) => r.personId);
  },
};

/** A dated enrolment in a section. Call inside the calling use case's command(). */
export async function enrol(
  tx: Tx,
  input: {
    personId: string;
    institutionId: string;
    sectionId: string;
    admissionNumber: string;
    rollNumber: number | null;
    from: string;
    /** Exclusive end, normally the day after the year ends. */
    until: string;
    importBatchId?: string | null;
  },
): Promise<void> {
  // A closed section keeps its students and takes no new ones.
  const [s] = await tx.execute<{ closed: boolean }>(sql`
    select closed_at is not null as closed from school_section where org_id = app_current_org() and id = ${input.sectionId}`);
  if (s?.closed) throw new EnrolmentError('section_closed');
  await tx.execute(sql`
    insert into school_enrolment (org_id, person_id, institution_id, section_id, admission_number, roll_number,
      valid_during, import_batch_id)
    values (app_current_org(), ${input.personId}, ${input.institutionId}, ${input.sectionId}, ${input.admissionNumber},
      ${input.rollNumber}, daterange(${input.from}::date, ${input.until}::date), ${input.importBatchId ?? null})`);
}

/** Import undo for enrolments. */
export async function removeImportedEnrolments(tx: Tx, importBatchId: string): Promise<void> {
  await tx.execute(sql`
    delete from school_enrolment where org_id = app_current_org() and import_batch_id = ${importBatchId}`);
}

/**
 * Moves a student to another section of the same class year from a date. The old enrolment ends
 * the day before, so its attendance stays with it; the new one runs to the old one's end. The
 * admission number stays; the roll number is the new section's.
 */
export async function changeSection(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    personId: string;
    sectionId: string;
    from: string;
    rollNumber?: number | null;
    reason: string;
  },
  ports: { attendanceTaken?: AttendanceTaken } = {},
): Promise<{ rollNumber: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from)) throw new EnrolmentError('bad_date');
  if (input.reason.trim().length < 3) throw new EnrolmentError('reason_required');
  const place = await withTenant(db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ campusId: string; institutionId: string }>(sql`
      select i.campus_id::text as "campusId", i.id::text as "institutionId"
      from school_enrolment e join institution i on i.org_id = e.org_id and i.id = e.institution_id
      where e.org_id = app_current_org() and e.person_id = ${input.personId} and e.valid_during @> ${input.from}::date`);
    return row ?? null;
  });
  if (!place) throw new EnrolmentError('not_enrolled_then');

  return command(
    db,
    permissions,
    actor,
    {
      permission: 'school.enrolment.change',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.personId },
    },
    async (tx) => {
      const [current] = await tx.execute<{
        id: string;
        sectionId: string;
        yearId: string;
        classId: string;
        starts: string;
        ends: string;
        admissionNumber: string;
      }>(sql`
        select e.id::text, e.section_id::text as "sectionId", s.year_id::text as "yearId", s.class_id::text as "classId",
          lower(e.valid_during)::text as starts, upper(e.valid_during)::text as ends, e.admission_number as "admissionNumber"
        from school_enrolment e join school_section s on s.org_id = e.org_id and s.id = e.section_id
        where e.org_id = app_current_org() and e.person_id = ${input.personId} and e.valid_during @> ${input.from}::date
        for update of e`);
      if (!current) throw new EnrolmentError('not_enrolled_then');
      if (current.sectionId === input.sectionId) throw new EnrolmentError('same_section');
      if (input.from <= current.starts) throw new EnrolmentError('before_enrolment_start');
      const [target] = await tx.execute<{ yearId: string; classId: string }>(sql`
        select year_id::text as "yearId", class_id::text as "classId" from school_section
        where org_id = app_current_org() and id = ${input.sectionId}`);
      if (!target || target.yearId !== current.yearId || target.classId !== current.classId) {
        throw new EnrolmentError('different_class_or_year');
      }
      // Attendance taken from that day in either section would be split between them: refused,
      // with the days, so a move is always from a day neither register has been taken.
      const taken = ports.attendanceTaken
        ? await ports.attendanceTaken(tx, [current.sectionId, input.sectionId], input.from)
        : [];
      if (taken.length > 0) throw new EnrolmentError('attendance_taken', { days: taken });
      const rollNumber =
        input.rollNumber ?? (await nextRollNumber(tx, input.sectionId, input.from));
      await tx.execute(sql`
        update school_enrolment set valid_during = daterange(lower(valid_during), ${input.from}::date)
        where org_id = app_current_org() and id = ${current.id}`);
      await enrol(tx, {
        personId: input.personId,
        institutionId: place.institutionId,
        sectionId: input.sectionId,
        admissionNumber: current.admissionNumber,
        rollNumber,
        from: input.from,
        until: current.ends,
      });
      return {
        result: { rollNumber },
        audit: {
          action: 'school.enrolment.change',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: {
            from: input.from,
            fromSection: current.sectionId,
            toSection: input.sectionId,
            rollNumber,
          },
        },
        events: [
          {
            type: SECTION_CHANGED,
            payload: { personId: input.personId, from: input.from, sectionId: input.sectionId },
          },
        ],
      };
    },
  );
}

/** What an import checks against: admission numbers in use, and name + date of birth of students. */
export async function enrolledKeys(tx: Tx, institutionId: string) {
  const admissions = await tx.execute<{ a: string }>(sql`
    select distinct admission_number as a from school_enrolment
    where org_id = app_current_org() and institution_id = ${institutionId}`);
  const people = await tx.execute<{ k: string }>(sql`
    select distinct lower(p.legal_name) || '|' || coalesce(p.date_of_birth::text, '') as k
    from school_enrolment e join person p on p.org_id = e.org_id and p.id = e.person_id
    where e.org_id = app_current_org() and e.institution_id = ${institutionId}`);
  return {
    admissions: new Set(admissions.map((r) => r.a)),
    people: new Set(people.map((r) => r.k)),
  };
}

export type RosterEntry = { personId: string; name: string; rollNumber: number | null };

/**
 * Students enrolled in a section on a date (or at any time up to `through`, inclusive), by roll
 * number then name.
 */
export async function sectionRoster(
  tx: Tx,
  sectionId: string,
  onDate: string,
  through: string = onDate,
): Promise<RosterEntry[]> {
  return [
    ...(await tx.execute<RosterEntry>(sql`
      select distinct on (e.roll_number, p.legal_name, e.person_id)
        e.person_id::text as "personId", p.legal_name as name, e.roll_number as "rollNumber"
      from school_enrolment e join person p on p.org_id = e.org_id and p.id = e.person_id
      where e.org_id = app_current_org() and e.section_id = ${sectionId}
        and e.valid_during && daterange(${onDate}::date, ${through}::date, '[]')
      order by e.roll_number nulls last, p.legal_name, e.person_id`)),
  ];
}

/** How many students each section has on a date (sections with nobody are left out). */
export async function sectionHeadcounts(
  tx: Tx,
  sectionIds: string[],
  onDate: string,
): Promise<Map<string, number>> {
  if (sectionIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; n: number }>(sql`
    select section_id::text as id, count(distinct person_id)::int as n from school_enrolment
    where org_id = app_current_org() and valid_during @> ${onDate}::date
      and section_id in (${sql.join(
        sectionIds.map((s) => sql`${s}::uuid`),
        sql`, `,
      )})
    group by section_id`);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** The next free roll number in a section for anyone enrolled on or after a date. */
export async function nextRollNumber(tx: Tx, sectionId: string, from: string): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(sql`
    select coalesce(max(roll_number), 0)::int + 1 as n from school_enrolment
    where org_id = app_current_org() and section_id = ${sectionId}
      and (upper_inf(valid_during) or upper(valid_during) > ${from}::date)`);
  return row?.n ?? 1;
}

/** The section a student is in on a date, or null. */
export async function sectionOf(tx: Tx, personId: string, onDate: string): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select section_id::text as id from school_enrolment
    where org_id = app_current_org() and person_id = ${personId} and valid_during @> ${onDate}::date`);
  return row?.id ?? null;
}

/**
 * Ends a student's enrolment after the last day, for a transfer (TC). The enrolment keeps its
 * history; attendance and records stay with it. Call inside the calling use case's command().
 */
export async function endEnrolment(
  tx: Tx,
  input: { personId: string; lastDay: string; status: 'transferred' | 'withdrawn' },
): Promise<{ institutionId: string; sectionId: string } | null> {
  const [row] = await tx.execute<{ institutionId: string; sectionId: string }>(sql`
    update school_enrolment
    set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${input.lastDay}::date + 1)),
      status = ${input.status}
    where org_id = app_current_org() and person_id = ${input.personId} and valid_during @> ${input.lastDay}::date
    returning institution_id::text as "institutionId", section_id::text as "sectionId"`);
  return row ?? null;
}

export type EnrolmentFacts = {
  admissionNumber: string;
  admittedOn: string;
  sectionId: string;
  institutionId: string;
  rollNumber: number | null;
};

/** The facts a TC prints: admission number, first day at the school, and the current section. */
export async function enrolmentFacts(
  tx: Tx,
  personId: string,
  onDate: string,
): Promise<EnrolmentFacts | null> {
  const [row] = await tx.execute<EnrolmentFacts>(sql`
    select e.admission_number as "admissionNumber",
      (select min(lower(valid_during))::text from school_enrolment
        where org_id = e.org_id and person_id = e.person_id and institution_id = e.institution_id) as "admittedOn",
      e.section_id::text as "sectionId", e.institution_id::text as "institutionId", e.roll_number as "rollNumber"
    from school_enrolment e
    where e.org_id = app_current_org() and e.person_id = ${personId} and e.valid_during @> ${onDate}::date`);
  return row ?? null;
}

/** Rollover: the old enrolment's outcome (promoted, detained, passed out as 'promoted' with no successor). */
export async function setOutcome(
  tx: Tx,
  input: { personId: string; onDate: string; status: 'active' | 'promoted' | 'detained' },
): Promise<void> {
  await tx.execute(sql`
    update school_enrolment set status = ${input.status}
    where org_id = app_current_org() and person_id = ${input.personId} and valid_during @> ${input.onDate}::date`);
}

/** Rollover: a new enrolment for the next year, tagged with the rollover so it can be undone. */
export async function enrolForRollover(
  tx: Tx,
  input: {
    rolloverId: string;
    personId: string;
    institutionId: string;
    sectionId: string;
    admissionNumber: string;
    rollNumber: number | null;
    from: string;
    until: string;
  },
): Promise<void> {
  // A closed section keeps its students and takes no new ones.
  const [s] = await tx.execute<{ closed: boolean }>(sql`
    select closed_at is not null as closed from school_section where org_id = app_current_org() and id = ${input.sectionId}`);
  if (s?.closed) throw new EnrolmentError('section_closed');
  await tx.execute(sql`
    insert into school_enrolment (org_id, person_id, institution_id, section_id, admission_number, roll_number,
      valid_during, rollover_id)
    values (app_current_org(), ${input.personId}, ${input.institutionId}, ${input.sectionId}, ${input.admissionNumber},
      ${input.rollNumber}, daterange(${input.from}::date, ${input.until}::date), ${input.rolloverId})`);
}

/**
 * Undoes a rollover's enrolments: each becomes an empty range (history kept, never matched by a
 * date), and returns the students so the caller can restore their old outcomes.
 */
export async function undoRolloverEnrolments(tx: Tx, rolloverId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update school_enrolment set valid_during = 'empty'::daterange, status = 'withdrawn'
    where org_id = app_current_org() and rollover_id = ${rolloverId} and not isempty(valid_during)
    returning person_id::text as id`);
  return rows.map((r) => r.id);
}

export type SectionOptions = {
  today: string;
  current: {
    sectionId: string;
    label: string;
    rollNumber: number | null;
    yearLabel: string;
    /** Exclusive. */
    yearEnds: string;
  };
  options: {
    sectionId: string;
    label: string;
    students: number;
    capacity: number;
    closed: boolean;
    classTeacher: string | null;
    /** The roll number the student would get. */
    nextRoll: number;
    /** The first day the move can start: today, unless either register is already taken today. */
    earliest: string;
  }[];
};

/** Where a student could move within their class this year, for the Change section screen. */
export async function sectionOptions(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  personId: string,
  ports: { attendanceTaken?: AttendanceTaken } = {},
): Promise<SectionOptions> {
  return withTenant(db, actor.orgId, async (tx) => {
    const [d] = await tx.execute<{ today: string; tomorrow: string }>(sql`
      select app_today()::text as today, (app_today() + 1)::text as tomorrow`);
    const today = d?.today ?? '';
    const [cur] = await tx.execute<{
      sectionId: string;
      label: string;
      rollNumber: number | null;
      yearId: string;
      yearLabel: string;
      yearEnds: string;
      classId: string;
      campusId: string;
      institutionId: string;
    }>(sql`
      select e.section_id::text as "sectionId", c.name || '-' || s.name as label, e.roll_number as "rollNumber",
        y.id::text as "yearId", y.label as "yearLabel", upper(y.valid_during)::text as "yearEnds",
        s.class_id::text as "classId", i.campus_id::text as "campusId", i.id::text as "institutionId"
      from school_enrolment e
      join school_section s on s.org_id = e.org_id and s.id = e.section_id
      join school_class c on c.org_id = s.org_id and c.id = s.class_id
      join school_year y on y.org_id = s.org_id and y.id = s.year_id
      join institution i on i.org_id = e.org_id and i.id = e.institution_id
      where e.org_id = app_current_org() and e.person_id = ${personId}
        and e.valid_during @> greatest(${today}::date, lower(e.valid_during))
        and upper(e.valid_during) > ${today}::date
      order by lower(e.valid_during) limit 1`);
    if (!cur) throw new EnrolmentError('not_enrolled_then');
    await permissions.assertCan(tx, actor, 'school.enrolment.change', {
      orgId: actor.orgId,
      place: { campusId: cur.campusId, institutionId: cur.institutionId },
      subjectPersonId: personId,
    });
    const sections = await tx.execute<{
      sectionId: string;
      label: string;
      capacity: number;
      closed: boolean;
      classTeacher: string | null;
      students: number;
    }>(sql`
      select s.id::text as "sectionId", c.name || '-' || s.name as label, s.capacity, s.closed_at is not null as closed,
        (select p.legal_name from school_teacher_allocation a join person p on p.org_id = a.org_id and p.id = a.teacher_person_id
          where a.org_id = s.org_id and a.section_id = s.id and a.kind = 'class_teacher' and a.valid_during @> ${today}::date
          limit 1) as "classTeacher",
        (select count(distinct x.person_id)::int from school_enrolment x where x.org_id = s.org_id and x.section_id = s.id
          and x.valid_during @> greatest(${today}::date, lower(x.valid_during)) and upper(x.valid_during) > ${today}::date) as students
      from school_section s join school_class c on c.org_id = s.org_id and c.id = s.class_id
      where s.org_id = app_current_org() and s.year_id = ${cur.yearId} and s.class_id = ${cur.classId}
        and s.id <> ${cur.sectionId}
      order by s.name`);
    const options: SectionOptions['options'] = [];
    for (const s of sections) {
      const taken = ports.attendanceTaken
        ? await ports.attendanceTaken(tx, [cur.sectionId, s.sectionId], today)
        : [];
      const earliest = taken.length > 0 ? (d?.tomorrow ?? today) : today;
      options.push({ ...s, nextRoll: await nextRollNumber(tx, s.sectionId, earliest), earliest });
    }
    return {
      today,
      current: {
        sectionId: cur.sectionId,
        label: cur.label,
        rollNumber: cur.rollNumber,
        yearLabel: cur.yearLabel,
        yearEnds: cur.yearEnds,
      },
      options,
    };
  });
}
