// The people module's tables, written only through these functions. Other modules call them
// inside their own command(), which has already checked the permission and writes the audit.
import type { Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

type Batch = { importBatchId?: string | null };
const batch = (b: Batch) => b.importBatchId ?? null;

async function one(tx: Tx, q: ReturnType<typeof sql>): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(q);
  if (!row) throw new Error('people: expected a row');
  return row.id;
}

/** A new person, with the first entry of their name history. */
export async function createPerson(
  tx: Tx,
  input: Batch & {
    legalName: string;
    dateOfBirth?: string | null;
    source: 'admission' | 'import' | 'signup';
  },
): Promise<string> {
  const id = await one(
    tx,
    sql`
    insert into person (org_id, legal_name, date_of_birth, import_batch_id)
    values (app_current_org(), ${input.legalName}, ${input.dateOfBirth ?? null}::date, ${batch(input)})
    returning id::text`,
  );
  await tx.execute(sql`
    insert into person_name (org_id, person_id, legal_name, source, import_batch_id)
    values (app_current_org(), ${id}, ${input.legalName}, ${input.source}, ${batch(input)})`);
  return id;
}

/**
 * The person with this phone and this name, if any. Same phone and name is the same person
 * (siblings' mother, a teacher who is also a parent); a different name is someone else on a
 * shared family phone.
 */
export async function findByPhoneAndName(
  tx: Tx,
  phone: string,
  name: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select p.id::text from person p join person_contact c on c.org_id = p.org_id and c.person_id = p.id
    where p.org_id = app_current_org() and c.channel = 'sms' and c.address = ${phone}
      and c.disabled_at is null and lower(p.legal_name) = lower(${name})
    limit 1`);
  return row?.id ?? null;
}

/** Guardians of current students who have this mobile number: a new applicant may be a sibling. */
export async function guardiansByPhone(
  tx: Tx,
  phone: string,
): Promise<{ guardianId: string; guardianName: string; studentId: string; studentName: string }[]> {
  return [
    ...(await tx.execute<{
      guardianId: string;
      guardianName: string;
      studentId: string;
      studentName: string;
    }>(sql`
      select distinct g.guardian_person_id::text as "guardianId", gp.legal_name as "guardianName",
        g.student_person_id::text as "studentId", sp.legal_name as "studentName"
      from person_contact c
      join guardian_link g on g.org_id = c.org_id and g.guardian_person_id = c.person_id and g.valid_during @> app_today()
      join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
      join person sp on sp.org_id = g.org_id and sp.id = g.student_person_id
      where c.org_id = app_current_org() and c.channel = 'sms' and c.address = ${phone} and c.disabled_at is null`)),
  ];
}

export type StudentFacts = {
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  apaarStatus: string;
  /** UDISE+ PEN, printed on the transfer certificate (rule book §13.5). */
  pen: string | null;
  guardians: { name: string; relationship: string }[];
  documentsPending: number;
};

export type PickupGuardian = {
  personId: string;
  name: string;
  relationship: string;
  /** Mobile numbers on record (+91…). */
  phones: string[];
  /** A restricted link (a court order, the family's word): never hand the child over. */
  restricted: boolean;
  /** On the school's pickup list (guardian link's can_pickup). */
  canPickup: boolean;
};

/**
 * A student's current guardians with their mobile numbers, restricted ones included and marked,
 * for the gate to check who may collect the child. Call inside the tenant, after a permission check.
 */
export async function pickupGuardians(tx: Tx, studentId: string): Promise<PickupGuardian[]> {
  return [
    ...(await tx.execute<PickupGuardian>(sql`
      select g.guardian_person_id::text as "personId", gp.legal_name as name, g.relationship,
        coalesce(array_agg(c.address order by c.address) filter (where c.address is not null), '{}') as phones,
        bool_or(g.restricted_at is not null) as restricted, bool_or(g.can_pickup) as "canPickup"
      from guardian_link g
      join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
      left join person_contact c on c.org_id = g.org_id and c.person_id = g.guardian_person_id
        and c.channel = 'sms' and c.disabled_at is null
      where g.org_id = app_current_org() and g.student_person_id = ${studentId} and g.valid_during @> app_today()
      group by g.guardian_person_id, gp.legal_name, g.relationship, g.is_primary_contact
      order by g.is_primary_contact desc, gp.legal_name`)),
  ];
}

export type ReturnFacts = {
  personId: string;
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  apaarStatus: string;
  pen: string | null;
  guardians: { name: string; relationship: string }[];
};

/**
 * Facts for government returns (UDISE+), for many students in one query; no sealed identifier.
 * Call inside the tenant, after a permission check.
 */
export async function studentFactsFor(tx: Tx, personIds: string[]): Promise<ReturnFacts[]> {
  if (personIds.length === 0) return [];
  return [
    ...(await tx.execute<ReturnFacts>(sql`
      select p.id::text as "personId", p.legal_name as name, s.gender, p.date_of_birth::text as "dateOfBirth",
        coalesce(s.apaar_status, 'not_generated') as "apaarStatus", s.pen,
        coalesce((
          select json_agg(json_build_object('name', gp.legal_name, 'relationship', g.relationship)
            order by g.is_primary_contact desc, g.relationship)
          from guardian_link g join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
          where g.org_id = p.org_id and g.student_person_id = p.id and g.restricted_at is null
            and g.valid_during @> app_today()
        ), '[]'::json) as guardians
      from person p left join student_profile s on s.org_id = p.org_id and s.person_id = p.id
      where p.org_id = app_current_org() and p.id = any(${`{${personIds.join(',')}}`}::uuid[])
      order by p.legal_name`)),
  ];
}

/** What a certificate prints about a student, without any sealed identifier. */
export async function studentFacts(tx: Tx, personId: string): Promise<StudentFacts | null> {
  const [p] = await tx.execute<{
    name: string;
    dateOfBirth: string | null;
    apaarStatus: string | null;
    gender: string | null;
    pen: string | null;
  }>(sql`
    select p.legal_name as name, p.date_of_birth::text as "dateOfBirth", s.apaar_status as "apaarStatus", s.gender,
      s.pen
    from person p left join student_profile s on s.org_id = p.org_id and s.person_id = p.id
    where p.org_id = app_current_org() and p.id = ${personId}`);
  if (!p) return null;
  const guardians = await tx.execute<{ name: string; relationship: string }>(sql`
    select gp.legal_name as name, g.relationship from guardian_link g
    join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
    where g.org_id = app_current_org() and g.student_person_id = ${personId} and g.restricted_at is null
    order by g.is_primary_contact desc, g.relationship`);
  const [docs] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from person_document
    where org_id = app_current_org() and person_id = ${personId} and requirement = 'required' and status <> 'verified'`);
  return {
    ...p,
    apaarStatus: p.apaarStatus ?? 'not_generated',
    guardians: [...guardians],
    documentsPending: docs?.n ?? 0,
  };
}

/** SMS and WhatsApp contacts for a mobile number. */
export async function addPhone(
  tx: Tx,
  personId: string,
  phone: string,
  b: Batch = {},
): Promise<void> {
  await tx.execute(sql`
    insert into person_contact (org_id, person_id, channel, address, import_batch_id)
    values (app_current_org(), ${personId}, 'sms', ${phone}, ${batch(b)}),
           (app_current_org(), ${personId}, 'whatsapp', ${phone}, ${batch(b)})
    on conflict (org_id, person_id, channel, address) do nothing`);
}

export async function linkGuardian(
  tx: Tx,
  input: Batch & {
    guardianId: string;
    studentId: string;
    relationship: string;
    primary: boolean;
  },
): Promise<void> {
  // The primary guardian pays fees and gets fee messages unless the school changes it.
  await tx.execute(sql`
    insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship,
      is_primary_contact, is_fee_payer, fee_messages, import_batch_id)
    values (app_current_org(), ${input.guardianId}, ${input.studentId}, ${input.relationship},
      ${input.primary}, ${input.primary}, ${input.primary}, ${batch(input)})`);
}

export async function ensureStudentProfile(tx: Tx, personId: string, b: Batch = {}): Promise<void> {
  await tx.execute(sql`
    insert into student_profile (org_id, person_id, import_batch_id)
    values (app_current_org(), ${personId}, ${batch(b)})
    on conflict (org_id, person_id) do nothing`);
}

export async function ensureStaffProfile(
  tx: Tx,
  personId: string,
  input: Batch & { employeeCode: string; workEmail: string | null },
): Promise<void> {
  await tx.execute(sql`
    insert into staff_profile (org_id, person_id, employee_code, work_email, import_batch_id)
    values (app_current_org(), ${personId}, ${input.employeeCode}, ${input.workEmail}, ${batch(input)})
    on conflict (org_id, person_id) do nothing`);
}

/**
 * Records that a person studies or works at an institution over a period. Overlapping periods
 * for the same institution and kind are merged by not adding a second one.
 */
export async function addMembership(
  tx: Tx,
  input: Batch & {
    personId: string;
    institutionId: string;
    kind: 'student' | 'staff';
    from: string;
    /** Exclusive end; null for open-ended. */
    until: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into institution_membership (org_id, person_id, institution_id, kind, valid_during, import_batch_id)
    select app_current_org(), ${input.personId}, ${input.institutionId}, ${input.kind},
      daterange(${input.from}::date, ${input.until}::date), ${batch(input)}
    where not exists (
      select 1 from institution_membership where org_id = app_current_org()
        and person_id = ${input.personId} and institution_id = ${input.institutionId} and kind = ${input.kind}
        and valid_during && daterange(${input.from}::date, ${input.until}::date))`);
}

/**
 * A student leaves an institution: the membership ends after the last day (a range starting later
 * becomes empty), and the profile shows them as left.
 */
export async function studentLeaves(
  tx: Tx,
  input: {
    personId: string;
    institutionId: string;
    lastDay: string;
    status?: 'left' | 'passed_out';
  },
): Promise<void> {
  await tx.execute(sql`
    update institution_membership
    set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${input.lastDay}::date + 1))
    where org_id = app_current_org() and person_id = ${input.personId} and institution_id = ${input.institutionId}
      and kind = 'student' and valid_during @> ${input.lastDay}::date`);
  await tx.execute(sql`
    update student_profile set status = ${input.status ?? 'left'}, updated_at = now()
    where org_id = app_current_org() and person_id = ${input.personId}`);
}

/**
 * Import undo for the people module's tables, in foreign-key order. Rows from other modules that
 * point at these people must be removed first by their own modules.
 */
export async function removeImportedPeople(tx: Tx, importBatchId: string): Promise<void> {
  for (const table of [
    'guardian_link',
    'person_contact',
    'staff_profile',
    'student_profile',
    'institution_membership',
    'person_name',
    'person',
  ]) {
    await tx.execute(
      sql`delete from ${sql.identifier(table)} where org_id = app_current_org() and import_batch_id = ${importBatchId}`,
    );
  }
}

/** Undo of a year-end exit: the membership runs again and the profile is active. */
export async function studentReturns(
  tx: Tx,
  input: { personId: string; institutionId: string; until: string },
): Promise<void> {
  await tx.execute(sql`
    update institution_membership set valid_during = daterange(lower(valid_during), ${input.until}::date)
    where org_id = app_current_org() and person_id = ${input.personId} and institution_id = ${input.institutionId}
      and kind = 'student' and id = (
        select id from institution_membership where org_id = app_current_org() and person_id = ${input.personId}
          and institution_id = ${input.institutionId} and kind = 'student' order by lower(valid_during) desc limit 1)`);
  await tx.execute(sql`
    update student_profile set status = 'active', updated_at = now()
    where org_id = app_current_org() and person_id = ${input.personId}`);
}

/** Year end: a student's membership runs on into the next year. */
export async function continueMembership(
  tx: Tx,
  input: { personId: string; institutionId: string; onDate: string; until: string },
): Promise<void> {
  await tx.execute(sql`
    update institution_membership set valid_during = daterange(lower(valid_during), ${input.until}::date)
    where org_id = app_current_org() and person_id = ${input.personId} and institution_id = ${input.institutionId}
      and kind = 'student' and valid_during @> ${input.onDate}::date and upper(valid_during) < ${input.until}::date`);
}

/** Active students in the current tenant (a count only, for the super admin). */
export async function activeStudentCount(tx: Tx): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from student_profile where org_id = app_current_org() and status = 'active'`);
  return r?.n ?? 0;
}

/** Ids of the students who belong to an institution today. Call inside the tenant, after a permission check. */
export async function studentIdsAt(tx: Tx, institutionId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select person_id::text as id from institution_membership
    where org_id = app_current_org() and institution_id = ${institutionId} and kind = 'student'
      and valid_during @> app_today()`);
  return rows.map((r) => r.id);
}

/** Names to show beside "who did this" and in access lists, by person id. Call inside the tenant. */
export async function displayNames(tx: Tx, personIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return {};
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select id::text, legal_name as name from person
    where org_id = app_current_org() and id = any(${`{${ids.join(',')}}`}::uuid[])`);
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export type StaffMember = {
  personId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  photoFileId: string | null;
};

export type Member = {
  personId: string;
  name: string;
  kind: 'student' | 'staff';
  /** Staff only. */
  employeeCode: string | null;
};

/**
 * Students and staff of an institution on a day whose name contains the text, or whose employee
 * code is the text, or who are among `ids` (such as admission-number matches from the academic
 * module). At most 20. Call inside the tenant, after a permission check.
 */
export async function searchMembers(
  tx: Tx,
  input: { institutionId: string; text: string; onDate: string; ids?: string[] },
): Promise<Member[]> {
  const q = `%${input.text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return [
    ...(await tx.execute<Member>(sql`
      select distinct on (p.legal_name, p.id) p.id::text as "personId", p.legal_name as name, m.kind,
        s.employee_code as "employeeCode"
      from institution_membership m
      join person p on p.org_id = m.org_id and p.id = m.person_id
      left join staff_profile s on s.org_id = m.org_id and s.person_id = m.person_id and m.kind = 'staff'
      where m.org_id = app_current_org() and m.institution_id = ${input.institutionId}
        and m.valid_during @> ${input.onDate}::date
        and (p.legal_name ilike ${q} or lower(s.employee_code) = lower(${input.text.trim()})
          or p.id = any(${`{${(input.ids ?? []).join(',')}}`}::uuid[]))
      order by p.legal_name, p.id
      limit 20`)),
  ];
}

/** Whether a person is a student or staff member of an institution on a day; null if neither. */
export async function memberKind(
  tx: Tx,
  input: { institutionId: string; personId: string; onDate: string },
): Promise<'student' | 'staff' | null> {
  const rows = await tx.execute<{ kind: 'student' | 'staff' }>(sql`
    select kind from institution_membership
    where org_id = app_current_org() and institution_id = ${input.institutionId} and person_id = ${input.personId}
      and valid_during @> ${input.onDate}::date`);
  // Someone with both memberships counts as staff (the longer loans and higher limit).
  return rows.some((r) => r.kind === 'staff') ? 'staff' : (rows[0]?.kind ?? null);
}

/** Staff who belong to an institution on a day (not left). Call inside the tenant, after a permission check. */
export async function staffAt(
  tx: Tx,
  institutionId: string,
  onDate: string,
): Promise<StaffMember[]> {
  return [
    ...(await tx.execute<StaffMember>(sql`
      select distinct on (p.legal_name, p.id) p.id::text as "personId", p.legal_name as name,
        s.employee_code as "employeeCode", s.designation, p.photo_file_id::text as "photoFileId"
      from institution_membership m
      join person p on p.org_id = m.org_id and p.id = m.person_id
      join staff_profile s on s.org_id = m.org_id and s.person_id = m.person_id
      where m.org_id = app_current_org() and m.institution_id = ${institutionId} and m.kind = 'staff'
        and m.valid_during @> ${onDate}::date and s.status <> 'left'
      order by p.legal_name, p.id`)),
  ];
}

export type Leaver = {
  personId: string;
  name: string;
  employeeCode: string;
  joinedOn: string | null;
  leftOn: string;
  /** 'contract' is fixed-term staff (Labour Codes: gratuity after one year). */
  employmentType: string | null;
};

/** Staff who left an institution on or after a date, for final settlement. Call inside the tenant. */
export async function staffLeftSince(
  tx: Tx,
  institutionId: string,
  since: string,
): Promise<Leaver[]> {
  return [
    ...(await tx.execute<Leaver>(sql`
      select sp.person_id::text as "personId", p.legal_name as name, sp.employee_code as "employeeCode",
        sp.joined_on::text as "joinedOn", sp.left_on::text as "leftOn", sp.employment_type as "employmentType"
      from staff_profile sp join person p on p.org_id = sp.org_id and p.id = sp.person_id
      where sp.org_id = app_current_org() and sp.status = 'left' and sp.left_on >= ${since}::date
        and exists (select 1 from institution_membership m where m.org_id = sp.org_id and m.person_id = sp.person_id
          and m.institution_id = ${institutionId} and m.kind = 'staff')
      order by sp.left_on desc`)),
  ];
}

/** Photo files of many people (null when none), for printing ID cards. Call inside the tenant. */
export async function photoFilesOf(tx: Tx, personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; f: string }>(sql`
    select id::text, photo_file_id::text as f from person
    where org_id = app_current_org() and photo_file_id is not null
      and id = any(${`{${personIds.join(',')}}`}::uuid[])`);
  return new Map(rows.map((r) => [r.id, r.f]));
}
