import { open, seal, type FieldKeys } from '@campusverse/crypto';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { auditTrail, type TrailEntry } from '@campusverse/platform-audit';
import { saveValues, valuesOf, type FieldValue } from '@campusverse/platform-fields';
import { command } from '@campusverse/platform-events';
import {
  currentRoleKeys,
  endAllRoles,
  heldPermissions,
  rolesOf,
  type Actor,
  type createPermissions,
  type HeldRole,
  type Resource,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { checksDueOf } from './check-queries.js';
import {
  last4,
  masked,
  readAadhaar,
  readAbc,
  readApaar,
  readPan,
  readPen,
} from '../domain/identifiers.js';

type Permissions = ReturnType<typeof createPermissions>;

/**
 * Where a person sits academically, answered by each academic type (school, later college).
 * The people module never reads academic tables; it asks these.
 */
export type Placement = {
  institutionId: string;
  institutionType: 'school' | 'college' | 'university';
  displayLabel: string; // "Class 5-A", "BTech CSE, Semester 3"
  active: boolean;
  /** The institution's own number for the person: admission no in schools. */
  reference?: string | null;
};
export interface AcademicPlacementPort {
  getCurrentPlacement(
    tx: Tx,
    input: { personId: string; onDate: string },
  ): Promise<Placement | null>;
  /** Many people at once (lists). `reference` is the institution's own number: admission no in schools. */
  getPlacements(
    tx: Tx,
    input: { personIds: string[]; onDate: string },
  ): Promise<Map<string, Placement & { reference: string | null }>>;
  /** People whose reference (admission no) starts with the text, in one institution. At most 20. */
  findByReference(tx: Tx, input: { institutionId: string; text: string }): Promise<string[]>;
}

export type PeopleDeps = {
  db: Db;
  permissions: Permissions;
  keys: FieldKeys;
  placements: AcademicPlacementPort[];
};

export class PeopleError extends Error {
  constructor(readonly code: string) {
    super(`People: ${code}`);
    this.name = 'PeopleError';
  }
}

export const STUDENT_UPDATED = 'people.student.updated.v1';
export const GUARDIAN_CHANGED = 'people.guardian.changed.v1';
export const STAFF_EXITED = 'people.staff.exited.v1';

const ctx = (kind: string, actor: Actor, personId: string) => `${kind}:${actor.orgId}:${personId}`;
const today = (tx: Tx) =>
  tx.execute<{ d: string }>(sql`select app_today()::text as d`).then((r) => r[0]?.d ?? '');

/** Every place a person currently belongs, as permission resources. */
async function placesOf(tx: Tx, personId: string, kind: 'student' | 'staff') {
  return [
    ...(await tx.execute<{ campusId: string; institutionId: string }>(sql`
      select i.campus_id::text as "campusId", i.id::text as "institutionId"
      from institution_membership m join institution i on i.org_id = m.org_id and i.id = m.institution_id
      where m.org_id = app_current_org() and m.person_id = ${personId} and m.kind = ${kind}
        and (upper_inf(m.valid_during) or upper(m.valid_during) > app_today())`)),
  ];
}

/**
 * The resource for acting on a person: allowed if the actor holds the permission at any place
 * the person currently belongs (or organisation-wide). Denied otherwise, with the reason.
 */
export async function personResource(
  deps: PeopleDeps,
  actor: Actor,
  permission: string,
  personId: string,
  kind: 'student' | 'staff',
): Promise<Resource> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [exists] = await tx.execute(
      sql`select 1 from person where org_id = app_current_org() and id = ${personId}`,
    );
    if (!exists) throw new PeopleError('person_not_found');
    const candidates: Resource[] = [
      ...(await placesOf(tx, personId, kind)).map((place) => ({
        orgId: actor.orgId,
        place,
        subjectPersonId: personId,
      })),
      { orgId: actor.orgId, subjectPersonId: personId },
    ];
    for (const r of candidates)
      if ((await deps.permissions.can(tx, actor, permission, r)).allowed) return r;
    return candidates[0] as Resource; // command() will deny with the precise reason
  });
}

async function canDo(deps: PeopleDeps, tx: Tx, actor: Actor, permission: string, r: Resource) {
  return (await deps.permissions.can(tx, actor, permission, r)).allowed;
}

export type StudentListItem = {
  personId: string;
  name: string;
  status: string;
  placement: string | null;
  /** Admission number in schools. */
  reference: string | null;
  photoFileId: string | null;
  gender: 'female' | 'male' | 'other' | 'not_stated' | null;
  /** The primary guardian, for people who can update students (contact data stays with them). */
  guardian: { name: string; relationship: string; phone: string | null } | null;
};

/** Students of an institution, searchable by name or admission number. The whole school by default (a few thousand at most). */
export async function listStudents(
  deps: PeopleDeps,
  actor: Actor,
  input: {
    institutionId: string;
    search?: string;
    limit?: number;
    everyone?: boolean;
    /** Students on the rolls that day, placed where they were then (a past year's list). */
    onDate?: string | null;
  },
): Promise<StudentListItem[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [inst] = await tx.execute<{ campusId: string }>(sql`
      select campus_id::text as "campusId" from institution where org_id = app_current_org() and id = ${input.institutionId}`);
    if (!inst) throw new PeopleError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'people.student.read', {
      orgId: actor.orgId,
      place: { campusId: inst.campusId, institutionId: input.institutionId },
    });
    const search = input.search?.trim()
      ? `%${input.search.trim().replace(/[%_\\]/g, '\\$&')}%`
      : null;
    // Admission numbers belong to the academic module: it says whose number starts with the text.
    const byReference = input.search?.trim()
      ? (
          await Promise.all(
            deps.placements.map((port) =>
              port.findByReference(tx, {
                institutionId: input.institutionId,
                text: input.search ?? '',
              }),
            ),
          )
        ).flat()
      : [];
    const refs = `{${byReference.join(',')}}`;
    const contacts = await canDo(deps, tx, actor, 'people.student.update', {
      orgId: actor.orgId,
      place: { campusId: inst.campusId, institutionId: input.institutionId },
    });
    const rows = await tx.execute<{
      personId: string;
      name: string;
      status: string;
      photoFileId: string | null;
      gender: StudentListItem['gender'];
      guardian: StudentListItem['guardian'];
    }>(sql`
      select distinct on (p.legal_name, p.id)
        p.id::text as "personId", p.legal_name as name, coalesce(sp.status, 'active') as status,
        p.photo_file_id::text as "photoFileId", sp.gender,
        case when ${contacts}::boolean then (
          select json_build_object('name', gp.legal_name, 'relationship', g.relationship,
            'phone', (select address from person_contact c where c.org_id = g.org_id
              and c.person_id = g.guardian_person_id and c.channel = 'sms' and c.disabled_at is null limit 1))
          from guardian_link g join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
          where g.org_id = p.org_id and g.student_person_id = p.id
            and (upper_inf(g.valid_during) or upper(g.valid_during) > app_today())
          order by g.is_primary_contact desc, gp.legal_name limit 1) end as guardian
      from institution_membership m
      join person p on p.org_id = m.org_id and p.id = m.person_id
      left join student_profile sp on sp.org_id = p.org_id and sp.person_id = p.id
      where m.org_id = app_current_org() and m.institution_id = ${input.institutionId} and m.kind = 'student'
        and (case when ${input.onDate ?? null}::date is not null then m.valid_during @> ${input.onDate ?? null}::date
          else ${input.everyone === true}::boolean or upper_inf(m.valid_during) or upper(m.valid_during) > app_today() end)
        and (${search}::text is null or p.legal_name ilike ${search} or p.id = any(${refs}::uuid[]))
      order by p.legal_name, p.id limit ${Math.min(input.limit ?? 5000, 5000)}`);
    const input2 = {
      personIds: rows.map((r) => r.personId),
      onDate: input.onDate ?? (await today(tx)),
    };
    const found = await Promise.all(deps.placements.map((port) => port.getPlacements(tx, input2)));
    return rows.map((r) => {
      const p = found.map((m) => m.get(r.personId)).find((x) => x !== undefined);
      return { ...r, placement: p?.displayLabel ?? null, reference: p?.reference ?? null };
    });
  });
}

export type StudentRecord = {
  person: {
    id: string;
    name: string;
    dateOfBirth: string | null;
    status: string;
    gender: string | null;
    photoFileId: string | null;
  };
  identifiers: {
    apaar: { status: string; note: string | null; masked: string | null };
    aadhaar: { masked: string | null };
    /** UDISE+ PEN, in clear: it is printed on the transfer certificate. */
    pen: string | null;
    abc: { masked: string | null };
  };
  names: { legalName: string; source: string; reason: string | null; recordedAt: string }[];
  memberships: {
    institutionId: string;
    institutionName: string;
    kind: string;
    from: string;
    until: string | null;
  }[];
  placements: Placement[];
  guardians:
    | {
        linkId: string;
        personId: string;
        name: string;
        relationship: string;
        phone: string | null;
        primary: boolean;
        feePayer: boolean;
        canLogin: boolean;
        restricted: { since: string; reason: string } | null;
        /** Owner-defined guardian fields, by key. */
        custom: Record<string, FieldValue>;
      }[]
    | null;
  /** Owner-defined student fields; null for those who only see the overview. */
  custom: Record<string, FieldValue> | null;
  /** Register, UDISE+ and TC details; null for those who only see the overview. */
  details: StudentDetails | null;
  documents:
    { id: string; kind: string; requirement: string; status: string; note: string | null }[] | null;
  timeline: TrailEntry[] | null;
  can: { update: boolean; reveal: boolean; readFull: boolean };
};

/**
 * One student's record. What comes back depends on permission: teachers see the overview and
 * placement; the office also sees guardians, documents and history; a parent sees their own
 * child. Aadhaar and APAAR are always masked here: revealing them is a separate, audited step.
 */
export type StudentDetails = {
  bloodGroup: string | null;
  motherTongue: string | null;
  religion: string | null;
  socialCategory: 'general' | 'obc' | 'sc' | 'st' | 'ews' | 'not_stated' | null;
  nationality: string;
  placeOfBirth: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  previousSchool: string | null;
  disability: string | null;
  medicalNotes: string | null;
};
const DETAIL_COLUMNS = {
  bloodGroup: 'blood_group',
  motherTongue: 'mother_tongue',
  religion: 'religion',
  socialCategory: 'social_category',
  nationality: 'nationality',
  placeOfBirth: 'place_of_birth',
  addressLine: 'address_line',
  city: 'city',
  pincode: 'pincode',
  stateCode: 'state_code',
  previousSchool: 'previous_school',
  disability: 'disability',
  medicalNotes: 'medical_notes',
} as const satisfies Record<keyof StudentDetails, string>;

async function detailsOf(tx: Tx, personId: string): Promise<StudentDetails> {
  const cols = Object.entries(DETAIL_COLUMNS)
    .map(([k, c]) => `${c} as "${k}"`)
    .join(', ');
  const [row] = await tx.execute<StudentDetails>(sql`
    select ${sql.raw(cols)} from student_profile where org_id = app_current_org() and person_id = ${personId}`);
  return (
    row ?? {
      ...(Object.fromEntries(
        Object.keys(DETAIL_COLUMNS).map((k) => [k, null]),
      ) as unknown as StudentDetails),
      nationality: 'Indian',
    }
  );
}

/**
 * Sets register details inside the caller's transaction (enrolment carries the application's).
 * Only non-empty values are written; the caller audits.
 */
export async function setStudentDetailsIn(
  tx: Tx,
  personId: string,
  input: Partial<Record<keyof StudentDetails, string | null | undefined>>,
): Promise<string[]> {
  const set = (Object.keys(input) as (keyof StudentDetails)[]).filter(
    (k) => k in DETAIL_COLUMNS && input[k]?.trim(),
  );
  for (const k of set)
    await tx.execute(sql`
      update student_profile set ${sql.raw(DETAIL_COLUMNS[k])} = ${input[k]?.trim() ?? null}, updated_at = now()
      where org_id = app_current_org() and person_id = ${personId}`);
  return set;
}

/**
 * Changes a student's register details. Only the fields given change; an empty string clears one.
 * The audit names the fields changed, never their values (category and medical notes are sensitive).
 */
export async function updateStudentDetails(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: Partial<Record<keyof StudentDetails, string | null | undefined>>,
): Promise<void> {
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      await tx.execute(sql`
        insert into student_profile (org_id, person_id) values (app_current_org(), ${personId})
        on conflict (org_id, person_id) do nothing`);
      const changed = (Object.keys(input) as (keyof StudentDetails)[]).filter(
        (k) => k in DETAIL_COLUMNS && input[k] !== undefined,
      );
      for (const k of changed) {
        const v = input[k]?.trim() || null;
        if (k === 'nationality' && !v) continue;
        await tx.execute(sql`
          update student_profile set ${sql.raw(DETAIL_COLUMNS[k])} = ${v}, updated_at = now()
          where org_id = app_current_org() and person_id = ${personId}`);
      }
      return {
        result: undefined,
        audit: {
          ...studentAudit('people.student.update', personId, { details: changed.join(',') }),
          dataClass: 'sensitive' as const,
        },
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

export async function studentRecord(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
): Promise<StudentRecord> {
  const resource = await personResource(deps, actor, 'people.student.read', personId, 'student');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'people.student.read', resource);
    const can = {
      update: await canDo(deps, tx, actor, 'people.student.update', resource),
      reveal: await canDo(deps, tx, actor, 'people.student.reveal', resource),
      readFull: await canDo(deps, tx, actor, 'people.student.read_full', resource),
    };

    const [p] = await tx.execute<
      StudentRecord['person'] & {
        apaarStatus: string;
        apaarNote: string | null;
        apaarLast4: string | null;
        aadhaarLast4: string | null;
        pen: string | null;
        abcLast4: string | null;
      }
    >(sql`
      select p.id::text, p.legal_name as name, p.date_of_birth::text as "dateOfBirth",
        p.photo_file_id::text as "photoFileId",
        coalesce(sp.status, 'active') as status, sp.gender,
        coalesce(sp.apaar_status, 'not_generated') as "apaarStatus", sp.apaar_note as "apaarNote",
        sp.apaar_last4 as "apaarLast4", sp.aadhaar_last4 as "aadhaarLast4", sp.pen,
        sp.abc_last4 as "abcLast4"
      from person p left join student_profile sp on sp.org_id = p.org_id and sp.person_id = p.id
      where p.org_id = app_current_org() and p.id = ${personId}`);
    if (!p) throw new PeopleError('person_not_found');

    const names = await tx.execute<StudentRecord['names'][number]>(sql`
      select legal_name as "legalName", source, reason, recorded_at::text as "recordedAt"
      from person_name where org_id = app_current_org() and person_id = ${personId} order by recorded_at desc`);
    const memberships = await tx.execute<StudentRecord['memberships'][number]>(sql`
      select m.institution_id::text as "institutionId", i.name as "institutionName", m.kind,
        lower(m.valid_during)::text as "from", (upper(m.valid_during) - 1)::text as "until"
      from institution_membership m join institution i on i.org_id = m.org_id and i.id = m.institution_id
      where m.org_id = app_current_org() and m.person_id = ${personId} and not isempty(m.valid_during)
      order by lower(m.valid_during) desc`);

    const on = await today(tx);
    const placements: Placement[] = [];
    for (const port of deps.placements) {
      const pl = await port.getCurrentPlacement(tx, { personId, onDate: on });
      if (pl) placements.push(pl);
    }

    const guardians = can.update
      ? [
          ...(await tx.execute<
            NonNullable<StudentRecord['guardians']>[number] & {
              restrictedAt: string | null;
              restrictionReason: string | null;
            }
          >(sql`
            select g.id::text as "linkId", g.guardian_person_id::text as "personId", gp.legal_name as name,
              g.relationship, g.is_primary_contact as primary, g.is_fee_payer as "feePayer", g.can_login as "canLogin",
              g.restricted_at::text as "restrictedAt", g.restriction_reason as "restrictionReason",
              (select address from person_contact c where c.org_id = g.org_id and c.person_id = g.guardian_person_id
                 and c.channel = 'sms' and c.disabled_at is null limit 1) as phone
            from guardian_link g join person gp on gp.org_id = g.org_id and gp.id = g.guardian_person_id
            where g.org_id = app_current_org() and g.student_person_id = ${personId}
              and (upper_inf(g.valid_during) or upper(g.valid_during) > app_today())
            order by g.is_primary_contact desc, gp.legal_name`)),
        ].map(({ restrictedAt, restrictionReason, ...g }) => ({
          ...g,
          restricted: restrictedAt
            ? { since: restrictedAt, reason: restrictionReason ?? '' }
            : null,
          custom: {} as Record<string, FieldValue>,
        }))
      : null;
    for (const g of guardians ?? []) g.custom = await valuesOf(tx, 'guardian', g.personId);

    const documents = can.readFull
      ? [
          ...(await tx.execute<NonNullable<StudentRecord['documents']>[number]>(sql`
            select id::text, kind, requirement, status, note from person_document
            where org_id = app_current_org() and person_id = ${personId} order by requirement, kind`)),
        ]
      : null;

    return {
      person: {
        id: p.id,
        name: p.name,
        dateOfBirth: p.dateOfBirth,
        status: p.status,
        gender: p.gender,
        photoFileId: p.photoFileId,
      },
      identifiers: {
        apaar: {
          status: p.apaarStatus,
          note: p.apaarNote,
          masked: p.apaarLast4 ? masked('apaar', p.apaarLast4) : null,
        },
        aadhaar: { masked: p.aadhaarLast4 ? masked('aadhaar', p.aadhaarLast4) : null },
        pen: p.pen,
        abc: { masked: p.abcLast4 ? masked('abc', p.abcLast4) : null },
      },
      names: [...names],
      memberships: [...memberships],
      placements,
      guardians,
      documents,
      custom: can.readFull ? await valuesOf(tx, 'student', personId) : null,
      details: can.readFull ? await detailsOf(tx, personId) : null,
      timeline: can.update ? await auditTrail(tx, personId) : null,
      can,
    };
  });
}

const studentAudit = (
  action: string,
  personId: string,
  detail: Record<string, string | number | boolean | null> = {},
  reason?: string,
) => ({
  action,
  entityType: 'person',
  entityId: personId,
  dataClass: 'personal' as const,
  detail,
  ...(reason ? { reason } : {}),
});

/** Status and gender. Names and identifiers have their own, stricter steps. */
export async function updateStudent(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: {
    status?: 'applicant' | 'active' | 'on_leave' | 'left' | 'passed_out' | 'alumni';
    gender?: 'female' | 'male' | 'other' | 'not_stated';
    custom?: Record<string, unknown> | undefined;
  },
): Promise<void> {
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      await tx.execute(sql`
      insert into student_profile (org_id, person_id, status, gender)
      values (app_current_org(), ${personId}, coalesce(${input.status ?? null}, 'active'), ${input.gender ?? null})
      on conflict (org_id, person_id) do update set
        status = coalesce(${input.status ?? null}, student_profile.status),
        gender = coalesce(${input.gender ?? null}, student_profile.gender),
        updated_at = now()`);
      const custom = await saveValues(tx, 'student', personId, input.custom ?? {});
      return {
        result: undefined,
        audit: studentAudit('people.student.update', personId, {
          status: input.status ?? null,
          gender: input.gender ?? null,
          custom: custom.join(','),
        }),
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

/** A new legal name. The old one stays in the history with its source; a reason is required. */
export async function correctName(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: { legalName: string; reason: string; source: 'correction' | 'board' },
): Promise<void> {
  const name = input.legalName.trim();
  if (!name || !input.reason.trim()) throw new PeopleError('name_and_reason_required');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      await tx.execute(
        sql`update person set legal_name = ${name} where org_id = app_current_org() and id = ${personId}`,
      );
      await tx.execute(sql`
      insert into person_name (org_id, person_id, legal_name, source, reason, recorded_by_account_id)
      values (app_current_org(), ${personId}, ${name}, ${input.source}, ${input.reason.trim()}, ${actor.accountId})`);
      return {
        result: undefined,
        audit: studentAudit(
          'people.student.update',
          personId,
          { change: 'name', source: input.source },
          input.reason.trim(),
        ),
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

/** APAAR: present (sealed), refused with evidence, or not generated with a reason. Never blocking. */
export async function setApaar(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: { status: 'present'; id: string } | { status: 'refused' | 'not_generated'; note: string },
): Promise<void> {
  const id = input.status === 'present' ? readApaar(input.id) : null;
  if (input.status === 'present' && !id) throw new PeopleError('bad_apaar');
  if (input.status !== 'present' && !input.note.trim()) throw new PeopleError('reason_required');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const sealed = id ? seal(deps.keys, id, ctx('apaar', actor, personId)) : null;
      await tx.execute(sql`
      insert into student_profile (org_id, person_id, apaar_status, apaar_note, apaar_sealed, apaar_last4)
      values (app_current_org(), ${personId}, ${input.status}, ${input.status === 'present' ? null : input.note.trim()},
        ${sealed}, ${id ? last4(id) : null})
      on conflict (org_id, person_id) do update set apaar_status = excluded.apaar_status,
        apaar_note = excluded.apaar_note, apaar_sealed = excluded.apaar_sealed,
        apaar_last4 = excluded.apaar_last4, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          ...studentAudit('people.student.update', personId, {
            change: 'apaar',
            status: input.status,
          }),
          dataClass: 'restricted' as const,
        },
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

/** Aadhaar is optional. Stored sealed, shown masked; null removes it. */
export async function setAadhaar(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  aadhaar: string | null,
): Promise<void> {
  const value = aadhaar === null ? null : readAadhaar(aadhaar);
  if (aadhaar !== null && !value) throw new PeopleError('bad_aadhaar');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const sealed = value ? seal(deps.keys, value, ctx('aadhaar', actor, personId)) : null;
      await tx.execute(sql`
      insert into student_profile (org_id, person_id, aadhaar_sealed, aadhaar_last4)
      values (app_current_org(), ${personId}, ${sealed}, ${value ? last4(value) : null})
      on conflict (org_id, person_id) do update set aadhaar_sealed = excluded.aadhaar_sealed,
        aadhaar_last4 = excluded.aadhaar_last4, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          ...studentAudit('people.student.update', personId, {
            change: 'aadhaar',
            removed: value === null,
          }),
          dataClass: 'restricted' as const,
        },
      };
    },
  );
}

/** PEN (UDISE+), optional and kept in clear; one student per PEN. Null removes it. */
export async function setPen(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  pen: string | null,
): Promise<void> {
  const value = pen === null ? null : readPen(pen);
  if (pen !== null && !value) throw new PeopleError('bad_pen');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      if (value) {
        const [taken] = await tx.execute<{ id: string }>(sql`
          select person_id::text as id from student_profile
          where org_id = app_current_org() and pen = ${value} and person_id <> ${personId}`);
        if (taken) throw new PeopleError('pen_taken');
      }
      await tx.execute(sql`
      insert into student_profile (org_id, person_id, pen)
      values (app_current_org(), ${personId}, ${value})
      on conflict (org_id, person_id) do update set pen = excluded.pen, updated_at = now()`);
      return {
        result: undefined,
        audit: studentAudit('people.student.update', personId, {
          change: 'pen',
          removed: value === null,
        }),
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

/** ABC ID (Academic Bank of Credits), optional. Stored sealed, shown masked; null removes it. */
export async function setAbcId(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  abc: string | null,
): Promise<void> {
  const value = abc === null ? null : readAbc(abc);
  if (abc !== null && !value) throw new PeopleError('bad_abc');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const sealed = value ? seal(deps.keys, value, ctx('abc', actor, personId)) : null;
      await tx.execute(sql`
      insert into student_profile (org_id, person_id, abc_sealed, abc_last4)
      values (app_current_org(), ${personId}, ${sealed}, ${value ? last4(value) : null})
      on conflict (org_id, person_id) do update set abc_sealed = excluded.abc_sealed,
        abc_last4 = excluded.abc_last4, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          ...studentAudit('people.student.update', personId, {
            change: 'abc',
            removed: value === null,
          }),
          dataClass: 'restricted' as const,
        },
        events: [{ type: STUDENT_UPDATED, payload: { personId } }],
      };
    },
  );
}

/** Shows an identifier in full. Needs its own permission and a reason, and is audited as restricted. */
export async function revealIdentifier(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  kind: 'aadhaar' | 'apaar' | 'abc',
  reason: string,
): Promise<string> {
  if (reason.trim().length < 5) throw new PeopleError('reason_required');
  const resource = await personResource(deps, actor, 'people.student.reveal', personId, 'student');
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.reveal', resource },
    async (tx) => {
      const column = sql.identifier(`${kind}_sealed`);
      const [row] = await tx.execute<{ sealed: Buffer | null }>(sql`
      select ${column} as sealed from student_profile where org_id = app_current_org() and person_id = ${personId}`);
      if (!row?.sealed) throw new PeopleError('not_recorded');
      return {
        result: open(deps.keys, row.sealed, ctx(kind, actor, personId)),
        audit: {
          ...studentAudit('people.student.reveal', personId, { identifier: kind }, reason.trim()),
          dataClass: 'restricted' as const,
        },
      };
    },
  );
}

/**
 * A guardian link's flags, or its restriction. A restricted guardian is blocked everywhere at once:
 * record, app, messages and pickup all read the same link.
 */
export async function setGuardianLink(
  deps: PeopleDeps,
  actor: Actor,
  linkId: string,
  input: {
    feePayer?: boolean;
    canLogin?: boolean;
    canPickup?: boolean;
    restriction?: { reason: string } | null;
  },
): Promise<void> {
  const [link] = await withTenant(deps.db, actor.orgId, (tx) =>
    tx.execute<{ studentId: string }>(sql`
      select student_person_id::text as "studentId" from guardian_link where org_id = app_current_org() and id = ${linkId}`),
  );
  if (!link) throw new PeopleError('guardian_link_not_found');
  if (input.restriction && input.restriction.reason.trim().length < 5)
    throw new PeopleError('reason_required');
  const resource = await personResource(
    deps,
    actor,
    'people.student.update',
    link.studentId,
    'student',
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const r = input.restriction;
      await tx.execute(sql`
      update guardian_link set
        is_fee_payer = coalesce(${input.feePayer ?? null}, is_fee_payer),
        can_login = coalesce(${input.canLogin ?? null}, can_login),
        can_pickup = coalesce(${input.canPickup ?? null}, can_pickup),
        restricted_at = case when ${r === undefined} then restricted_at when ${r === null} then null else now() end,
        restriction_reason = case when ${r === undefined} then restriction_reason when ${r === null} then null
          else ${r?.reason.trim() ?? null} end
      where org_id = app_current_org() and id = ${linkId}`);
      return {
        result: undefined,
        audit: {
          ...studentAudit(
            'people.student.update',
            link.studentId,
            { change: 'guardian', linkId, restricted: r ? true : r === null ? false : null },
            r?.reason.trim(),
          ),
          dataClass: r ? ('sensitive' as const) : ('personal' as const),
        },
        events: [
          {
            type: GUARDIAN_CHANGED,
            payload: { linkId, studentId: link.studentId, restricted: !!r },
          },
        ],
      };
    },
  );
}

/** A document on the checklist: required, conditional or optional; pending, received, verified or rejected. */
export async function setDocument(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: {
    kind: string;
    requirement: 'required' | 'conditional' | 'optional';
    status: 'pending' | 'received' | 'verified' | 'rejected';
    fileId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  if (input.status === 'rejected' && !input.note?.trim()) throw new PeopleError('reason_required');
  const resource = await personResource(deps, actor, 'people.student.update', personId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const checked = input.status === 'verified' || input.status === 'rejected';
      await tx.execute(sql`
      insert into person_document (org_id, person_id, kind, requirement, status, file_id, note,
        checked_by_account_id, checked_at)
      values (app_current_org(), ${personId}, ${input.kind}, ${input.requirement}, ${input.status},
        ${input.fileId ?? null}, ${input.note?.trim() || null}, ${checked ? actor.accountId : null},
        ${checked ? sql`now()` : null})
      on conflict (org_id, person_id, kind) do update set requirement = excluded.requirement,
        status = excluded.status, file_id = coalesce(excluded.file_id, person_document.file_id),
        note = excluded.note, checked_by_account_id = excluded.checked_by_account_id, checked_at = excluded.checked_at`);
      return {
        result: undefined,
        audit: studentAudit('people.student.update', personId, {
          change: 'document',
          kind: input.kind,
          status: input.status,
        }),
      };
    },
  );
}

export type StaffRecord = {
  person: {
    id: string;
    name: string;
    employeeCode: string;
    status: string;
    designation: string | null;
    joinedOn: string | null;
    leftOn: string | null;
  };
  pan: string | null;
  phone: string | null;
  workEmail: string | null;
  memberships: StudentRecord['memberships'];
  roles: HeldRole[];
  can: { update: boolean; exit: boolean; reveal: boolean };
};

export async function staffRecord(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
): Promise<StaffRecord> {
  const resource = await personResource(deps, actor, 'people.staff.read', personId, 'staff');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'people.staff.read', resource);
    const [p] = await tx.execute<
      StaffRecord['person'] & {
        panLast4: string | null;
        phone: string | null;
        workEmail: string | null;
      }
    >(sql`
      select p.id::text, p.legal_name as name, s.employee_code as "employeeCode", s.status, s.designation,
        s.joined_on::text as "joinedOn", s.left_on::text as "leftOn", s.pan_last4 as "panLast4", s.work_email as "workEmail",
        (select address from person_contact c where c.org_id = p.org_id and c.person_id = p.id and c.channel = 'sms' limit 1) as phone
      from person p join staff_profile s on s.org_id = p.org_id and s.person_id = p.id
      where p.org_id = app_current_org() and p.id = ${personId}`);
    if (!p) throw new PeopleError('person_not_found');
    const memberships = await tx.execute<StudentRecord['memberships'][number]>(sql`
      select m.institution_id::text as "institutionId", i.name as "institutionName", m.kind,
        lower(m.valid_during)::text as "from", (upper(m.valid_during) - 1)::text as "until"
      from institution_membership m join institution i on i.org_id = m.org_id and i.id = m.institution_id
      where m.org_id = app_current_org() and m.person_id = ${personId} and not isempty(m.valid_during)
      order by lower(m.valid_during) desc`);
    const { panLast4, phone, workEmail, ...person } = p;
    return {
      person,
      pan: panLast4 ? masked('pan', panLast4) : null,
      phone,
      workEmail,
      memberships: [...memberships],
      roles: await rolesOf(tx, personId),
      can: {
        update: await canDo(deps, tx, actor, 'people.staff.update', resource),
        exit: await canDo(deps, tx, actor, 'people.staff.exit', resource),
        reveal: await canDo(deps, tx, actor, 'people.staff.reveal', resource),
      },
    };
  });
}

export async function updateStaff(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: {
    designation?: string;
    status?: 'invited' | 'onboarding' | 'active' | 'on_leave' | 'notice';
    joinedOn?: string;
    pan?: string | null;
  },
): Promise<void> {
  const pan = input.pan === undefined || input.pan === null ? input.pan : readPan(input.pan);
  if (input.pan && !pan) throw new PeopleError('bad_pan');
  const resource = await personResource(deps, actor, 'people.staff.update', personId, 'staff');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.update', resource },
    async (tx) => {
      const [row] = await tx.execute(sql`
      update staff_profile set
        designation = coalesce(${input.designation ?? null}, designation),
        status = coalesce(${input.status ?? null}, status),
        joined_on = coalesce(${input.joinedOn ?? null}::date, joined_on),
        pan_sealed = case when ${pan === undefined} then pan_sealed else ${pan ? seal(deps.keys, pan, ctx('pan', actor, personId)) : null}::bytea end,
        pan_last4 = case when ${pan === undefined} then pan_last4 else ${pan ? last4(pan) : null} end
      where org_id = app_current_org() and person_id = ${personId} and status <> 'left'
      returning 1`);
      if (!row) throw new PeopleError('staff_not_found_or_left');
      return {
        result: undefined,
        audit: {
          action: 'people.staff.update',
          entityType: 'person',
          entityId: personId,
          dataClass: pan !== undefined ? ('restricted' as const) : ('personal' as const),
          detail: {
            designation: input.designation ?? null,
            status: input.status ?? null,
            pan: pan === undefined ? null : 'changed',
          },
        },
      };
    },
  );
}

/**
 * A staff member leaves. After their last day they hold no role, duty or membership anywhere in
 * the organisation. School-side allocations (class teacher, subjects) end through the event.
 */
export async function exitStaff(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: { lastDay: string; reason: string },
): Promise<{ endedRoles: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lastDay)) throw new PeopleError('bad_date');
  if (input.reason.trim().length < 3) throw new PeopleError('reason_required');
  const resource = await personResource(deps, actor, 'people.staff.exit', personId, 'staff');
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.exit', resource },
    async (tx) => {
      const [row] = await tx.execute(sql`
      update staff_profile set status = 'left', left_on = ${input.lastDay}::date
      where org_id = app_current_org() and person_id = ${personId} and status <> 'left' returning 1`);
      if (!row) throw new PeopleError('staff_not_found_or_left');
      await tx.execute(sql`
      update institution_membership
      set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${input.lastDay}::date + 1))
      where org_id = app_current_org() and person_id = ${personId} and kind = 'staff'
        and (upper_inf(valid_during) or upper(valid_during) > ${input.lastDay}::date + 1)`);
      const endedRoles = await endAllRoles(tx, personId, input.lastDay);
      return {
        result: { endedRoles },
        audit: {
          action: 'people.staff.exit',
          entityType: 'person',
          entityId: personId,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: { lastDay: input.lastDay, endedRoles },
        },
        events: [{ type: STAFF_EXITED, payload: { personId, lastDay: input.lastDay } }],
      };
    },
  );
}

export async function revealPan(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  reason: string,
): Promise<string> {
  if (reason.trim().length < 5) throw new PeopleError('reason_required');
  const resource = await personResource(deps, actor, 'people.staff.reveal', personId, 'staff');
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.reveal', resource },
    async (tx) => {
      const [row] = await tx.execute<{ sealed: Buffer | null }>(sql`
      select pan_sealed as sealed from staff_profile where org_id = app_current_org() and person_id = ${personId}`);
      if (!row?.sealed) throw new PeopleError('not_recorded');
      return {
        result: open(deps.keys, row.sealed, ctx('pan', actor, personId)),
        audit: {
          action: 'people.staff.reveal',
          entityType: 'person',
          entityId: personId,
          dataClass: 'restricted',
          reason: reason.trim(),
          detail: { identifier: 'pan' },
        },
      };
    },
  );
}

export async function listStaff(
  deps: PeopleDeps,
  actor: Actor,
  input: { institutionId: string; includeLeft?: boolean },
) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [inst] = await tx.execute<{ campusId: string }>(sql`
      select campus_id::text as "campusId" from institution where org_id = app_current_org() and id = ${input.institutionId}`);
    if (!inst) throw new PeopleError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'people.staff.read', {
      orgId: actor.orgId,
      place: { campusId: inst.campusId, institutionId: input.institutionId },
    });
    const rows = await tx.execute<{
      personId: string;
      name: string;
      employeeCode: string;
      status: string;
      designation: string | null;
      category: 'teaching' | 'administrative' | 'support' | null;
      photoFileId: string | null;
    }>(sql`
        select distinct on (p.legal_name, p.id) p.id::text as "personId", p.legal_name as name,
          s.employee_code as "employeeCode", s.status, s.designation, s.category,
          p.photo_file_id::text as "photoFileId"
        from institution_membership m
        join person p on p.org_id = m.org_id and p.id = m.person_id
        join staff_profile s on s.org_id = p.org_id and s.person_id = p.id
        where m.org_id = app_current_org() and m.institution_id = ${input.institutionId} and m.kind = 'staff'
          and (${input.includeLeft ?? false} or s.status <> 'left')
        order by p.legal_name, p.id`);
    const ids = rows.map((r) => r.personId);
    const roles = await currentRoleKeys(tx, ids);
    const due = await checksDueOf(tx, ids);
    return rows.map((r) => ({
      ...r,
      roleKeys: roles.get(r.personId) ?? [],
      checksDue: (due.get(r.personId) ?? []).map((l) => ({ kind: l.kind, state: l.state })),
    }));
  });
}

/** The signed-in person, for the app's header and sidebar. */
export async function whoAmI(deps: PeopleDeps, actor: Actor) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [me] = await tx.execute<{
      name: string;
      orgName: string;
      photoFileId: string | null;
    }>(sql`
      select p.legal_name as name, o.name as "orgName", p.photo_file_id::text as "photoFileId"
      from person p join organisation o on o.id = p.org_id
      where p.org_id = app_current_org() and p.id = ${actor.personId}`);
    if (!me) throw new PeopleError('person_not_found');
    const on = await today(tx);
    const roles = (await rolesOf(tx, actor.personId)).filter(
      (r) => r.until === null || r.until >= on,
    );
    return {
      personId: actor.personId,
      ...me,
      roles: [...new Set(roles.map((r) => r.roleName))],
      // For showing or hiding screens only; every request is still checked on the server.
      permissions: [...(await heldPermissions(tx, actor.personId))].sort(),
    };
  });
}

export type MyChild = { personId: string; name: string; placement: string | null };

/**
 * A guardian's children for the parent app: active, unrestricted links with app access. Each
 * child is checked with the guardian relation, so a restricted guardian sees nobody.
 */
export async function myChildren(deps: PeopleDeps, actor: Actor): Promise<MyChild[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const rows = await tx.execute<{ personId: string; name: string }>(sql`
      select g.student_person_id::text as "personId", p.legal_name as name
      from guardian_link g join person p on p.org_id = g.org_id and p.id = g.student_person_id
      where g.org_id = app_current_org() and g.guardian_person_id = ${actor.personId}
        and g.valid_during @> app_today() and g.restricted_at is null and g.can_login
      order by p.date_of_birth nulls last, p.legal_name`);
    const [d] = await tx.execute<{ today: string }>(sql`select app_today()::text as today`);
    const out: MyChild[] = [];
    for (const r of rows) {
      const allowed = await deps.permissions.can(tx, actor, 'people.student.read', {
        orgId: actor.orgId,
        subjectPersonId: r.personId,
      });
      if (!allowed.allowed) continue;
      const placement = await placementOf(deps, tx, r.personId, d?.today ?? '');
      out.push({ ...r, placement: placement?.displayLabel ?? null });
    }
    return out;
  });
}

/** A guardian's owner-defined fields, changed from their child's record (people.student.update). */
export async function setGuardianFields(
  deps: PeopleDeps,
  actor: Actor,
  studentId: string,
  guardianId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const resource = await personResource(deps, actor, 'people.student.update', studentId, 'student');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.student.update', resource },
    async (tx) => {
      const [link] = await tx.execute(sql`
      select 1 from guardian_link where org_id = app_current_org() and student_person_id = ${studentId}
        and guardian_person_id = ${guardianId}`);
      if (!link) throw new PeopleError('guardian_not_found');
      const changed = await saveValues(tx, 'guardian', guardianId, values);
      return {
        result: undefined,
        audit: {
          action: 'people.guardian.update_fields',
          entityType: 'person',
          entityId: guardianId,
          dataClass: 'personal',
          detail: { studentId, custom: changed.join(',') },
        },
      };
    },
  );
}

async function placementOf(deps: PeopleDeps, tx: Tx, personId: string, onDate: string) {
  for (const port of deps.placements) {
    const p = await port.getCurrentPlacement(tx, { personId, onDate });
    if (p) return p;
  }
  return null;
}

/**
 * APAAR IDs from a reconciliation (Government Reports): sealed and stored as present, inside the
 * caller's transaction, which has checked the permission, the student and consent, and writes the
 * audit. Values are already validated.
 */
export async function setApaarIdsIn(
  tx: Tx,
  keys: PeopleDeps['keys'],
  orgId: string,
  rows: { personId: string; apaar: string }[],
): Promise<void> {
  for (const r of rows) {
    const sealed = seal(keys, r.apaar, `apaar:${orgId}:${r.personId}`);
    await tx.execute(sql`
      insert into student_profile (org_id, person_id, apaar_status, apaar_note, apaar_sealed, apaar_last4)
      values (app_current_org(), ${r.personId}, 'present', null, ${sealed}, ${last4(r.apaar)})
      on conflict (org_id, person_id) do update set apaar_status = 'present', apaar_note = null,
        apaar_sealed = excluded.apaar_sealed, apaar_last4 = excluded.apaar_last4, updated_at = now()`);
  }
}

/**
 * Learners' APAAR and ABC IDs in full, for an audited export to a government system (ABC, NAD).
 * The caller has checked people.student.reveal and records the export. Call inside the tenant.
 */
/**
 * Staff PANs in full, for the TDS statement (24Q). Call inside the tenant, after the caller's own
 * permission check; the caller audits the export.
 */
export async function pansForExport(
  tx: Tx,
  keys: PeopleDeps['keys'],
  orgId: string,
  personIds: string[],
): Promise<Record<string, string | null>> {
  if (personIds.length === 0) return {};
  const rows = await tx.execute<{ id: string; pan: Buffer | null }>(sql`
    select person_id::text as id, pan_sealed as pan from staff_profile
    where org_id = app_current_org() and person_id = any(${`{${personIds.join(',')}}`}::uuid[])`);
  return Object.fromEntries(
    rows.map((r) => [r.id, r.pan ? open(keys, r.pan, `pan:${orgId}:${r.id}`) : null]),
  );
}

export async function learnerIdsForExport(
  tx: Tx,
  keys: PeopleDeps['keys'],
  orgId: string,
  personIds: string[],
): Promise<Record<string, { apaar: string | null; abc: string | null; pen: string | null }>> {
  if (personIds.length === 0) return {};
  const rows = await tx.execute<{
    id: string;
    apaar: Buffer | null;
    abc: Buffer | null;
    pen: string | null;
  }>(sql`
    select person_id::text as id, apaar_sealed as apaar, abc_sealed as abc, pen
    from student_profile where org_id = app_current_org()
      and person_id = any(${`{${personIds.join(',')}}`}::uuid[])`);
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        apaar: r.apaar ? open(keys, r.apaar, `apaar:${orgId}:${r.id}`) : null,
        abc: r.abc ? open(keys, r.abc, `abc:${orgId}:${r.id}`) : null,
        pen: r.pen,
      },
    ]),
  );
}
