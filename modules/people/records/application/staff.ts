// Milestone 20: creating staff on screen, and the full staff record (department, employment,
// qualifications, emergency contact, sealed Aadhaar and bank account, owner-defined fields).
import { seal } from '@campusverse/crypto';
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { saveValues, valuesOf, type FieldValue } from '@campusverse/platform-fields';
import { assignRole, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  last4,
  masked,
  maskedAccount,
  readAadhaar,
  readBankAccount,
} from '../domain/identifiers.js';
import { categoryOf, type WorkRole } from '../domain/checks.js';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStaffProfile,
  findByPhoneAndName,
} from './people.js';
import { PeopleError, personResource, type PeopleDeps } from './records.js';

export const STAFF_CREATED = 'people.staff.created.v1';

export type EmploymentType = 'permanent' | 'probation' | 'contract' | 'part_time' | 'visiting';
export type Gender = 'female' | 'male' | 'other' | 'not_stated';

export type NewStaff = {
  institutionId: string;
  name: string;
  phone: string;
  employeeCode?: string | null;
  designation?: string | null;
  department?: string | null;
  employmentType?: EmploymentType | null;
  joinedOn: string;
  gender?: Gender | null;
  dateOfBirth?: string | null;
  workEmail?: string | null;
  /** What they do here: gives the matching role (app access) and category. Null: no app role. */
  workRole?: WorkRole | null;
  custom?: Record<string, unknown>;
};

const ctx = (kind: string, actor: Actor, personId: string) => `${kind}:${actor.orgId}:${personId}`;

async function placeOfInstitution(tx: Tx, institutionId: string) {
  const [row] = await tx.execute<{ campusId: string }>(sql`
    select campus_id::text as "campusId" from institution where org_id = app_current_org() and id = ${institutionId}`);
  if (!row) throw new PeopleError('institution_not_found');
  return { campusId: row.campusId, institutionId };
}

/** The next free code: EMP-0001, EMP-0002… */
async function nextEmployeeCode(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ n: number }>(sql`
    select coalesce(max(substring(employee_code from '^EMP-(\\d+)$')::int), 0)::int as n
    from staff_profile where org_id = app_current_org()`);
  return `EMP-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

/**
 * A new staff member, from the office: a person with their mobile number, a staff profile, and
 * their place at the institution from the joining date. The same name and mobile number already
 * on staff is refused; it is the same person.
 */
export async function createStaff(
  deps: PeopleDeps,
  actor: Actor,
  input: NewStaff,
): Promise<string> {
  const place = await withTenant(deps.db, actor.orgId, (tx) =>
    placeOfInstitution(tx, input.institutionId),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.create', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const existing = await findByPhoneAndName(tx, input.phone, input.name);
      if (existing) {
        const [staff] = await tx.execute(sql`
          select 1 from staff_profile where org_id = app_current_org() and person_id = ${existing}`);
        if (staff) throw new PeopleError('already_staff');
      }
      const personId =
        existing ??
        (await createPerson(tx, {
          legalName: input.name.trim(),
          dateOfBirth: input.dateOfBirth ?? null,
          source: 'signup',
        }));
      await addPhone(tx, personId, input.phone);
      const code = input.employeeCode?.trim() || (await nextEmployeeCode(tx));
      const [taken] = await tx.execute(sql`
        select 1 from staff_profile where org_id = app_current_org() and employee_code = ${code}`);
      if (taken) throw new PeopleError('employee_code_taken');
      await ensureStaffProfile(tx, personId, {
        employeeCode: code,
        workEmail: input.workEmail?.toLowerCase() ?? null,
      });
      await tx.execute(sql`
        update staff_profile set designation = ${input.designation?.trim() || null},
          department = ${input.department?.trim() || null}, employment_type = ${input.employmentType ?? null},
          gender = ${input.gender ?? null}, joined_on = ${input.joinedOn}::date,
          category = ${categoryOf(input.workRole ?? null)}
        where org_id = app_current_org() and person_id = ${personId}`);
      // Everyday work roles only; administrators and principals are given in Access.
      if (input.workRole)
        await assignRole(tx, {
          personId,
          roleKey: input.workRole,
          scope: { type: 'institution', id: input.institutionId },
        });
      await addMembership(tx, {
        personId,
        institutionId: input.institutionId,
        kind: 'staff',
        from: input.joinedOn,
        until: null,
      });
      const custom = await saveValues(tx, 'staff', personId, input.custom ?? {});
      return {
        result: personId,
        audit: {
          action: 'people.staff.create',
          entityType: 'person',
          entityId: personId,
          dataClass: 'personal',
          detail: {
            institutionId: input.institutionId,
            employeeCode: code,
            workRole: input.workRole ?? null,
            custom: custom.join(','),
          },
        },
        events: [
          { type: STAFF_CREATED, payload: { personId, institutionId: input.institutionId } },
        ],
      };
    },
  );
}

export type StaffDetails = {
  department: string | null;
  employmentType: EmploymentType | null;
  qualifications: string | null;
  experienceMonths: number | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  aadhaar: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  /** PF universal account number (12 digits). */
  pfUan: string | null;
  esiNumber: string | null;
  photoFileId: string | null;
  custom: Record<string, FieldValue>;
};

export async function staffDetails(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
): Promise<StaffDetails> {
  const resource = await personResource(deps, actor, 'people.staff.read', personId, 'staff');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'people.staff.read', resource);
    const [d] = await tx.execute<
      Omit<StaffDetails, 'aadhaar' | 'bankAccount' | 'custom'> & {
        aadhaarLast4: string | null;
        bankLast4: string | null;
      }
    >(sql`
      select s.department, s.employment_type as "employmentType", s.qualifications,
        s.experience_months as "experienceMonths", s.gender, p.date_of_birth::text as "dateOfBirth",
        s.emergency_name as "emergencyName", s.emergency_phone as "emergencyPhone",
        s.aadhaar_last4 as "aadhaarLast4", s.bank_last4 as "bankLast4", s.bank_ifsc as "bankIfsc",
        s.pf_uan as "pfUan", s.esi_number as "esiNumber", p.photo_file_id::text as "photoFileId"
      from staff_profile s join person p on p.org_id = s.org_id and p.id = s.person_id
      where s.org_id = app_current_org() and s.person_id = ${personId}`);
    if (!d) throw new PeopleError('person_not_found');
    const { aadhaarLast4, bankLast4, ...rest } = d;
    return {
      ...rest,
      aadhaar: aadhaarLast4 ? masked('aadhaar', aadhaarLast4) : null,
      bankAccount: bankLast4 ? maskedAccount(bankLast4) : null,
      custom: await valuesOf(tx, 'staff', personId),
    };
  });
}

/** PF UAN and ESI number for statutory returns, many staff at once. Call inside the tenant, after a permission check. */
export async function statutoryIds(
  tx: Tx,
  personIds: string[],
): Promise<Record<string, { pfUan: string | null; esiNumber: string | null }>> {
  if (personIds.length === 0) return {};
  const rows = await tx.execute<{ id: string; pfUan: string | null; esiNumber: string | null }>(sql`
    select person_id::text as id, pf_uan as "pfUan", esi_number as "esiNumber" from staff_profile
    where org_id = app_current_org() and person_id = any(${`{${personIds.join(',')}}`}::uuid[])`);
  return Object.fromEntries(rows.map((r) => [r.id, { pfUan: r.pfUan, esiNumber: r.esiNumber }]));
}

export type StaffDetailsChange = {
  [K in Exclude<keyof StaffDetails, 'photoFileId' | 'custom'>]?: StaffDetails[K] | undefined;
} & { custom?: Record<string, unknown> | undefined };

const COLUMNS = {
  department: 'department',
  employmentType: 'employment_type',
  qualifications: 'qualifications',
  experienceMonths: 'experience_months',
  gender: 'gender',
  emergencyName: 'emergency_name',
  emergencyPhone: 'emergency_phone',
  bankIfsc: 'bank_ifsc',
  pfUan: 'pf_uan',
  esiNumber: 'esi_number',
} as const;

/** Changes the details; Aadhaar and the bank account are sealed, with only the last four in clear. */
export async function updateStaffDetails(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  change: StaffDetailsChange,
): Promise<void> {
  const aadhaar = change.aadhaar == null ? change.aadhaar : readAadhaar(change.aadhaar);
  if (change.aadhaar && !aadhaar) throw new PeopleError('bad_aadhaar');
  const bank =
    change.bankAccount == null ? change.bankAccount : readBankAccount(change.bankAccount);
  if (change.bankAccount && !bank) throw new PeopleError('bad_bank_account');
  const resource = await personResource(deps, actor, 'people.staff.update', personId, 'staff');
  const sensitive = aadhaar !== undefined || bank !== undefined;
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'people.staff.update', resource },
    async (tx) => {
      const keys = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
        (k) => change[k] !== undefined,
      );
      const sets = keys.map((k) => sql`${sql.identifier(COLUMNS[k])} = ${change[k] ?? null}`);
      if (aadhaar !== undefined)
        sets.push(
          sql`aadhaar_sealed = ${aadhaar ? seal(deps.keys, aadhaar, ctx('aadhaar', actor, personId)) : null}::bytea`,
          sql`aadhaar_last4 = ${aadhaar ? last4(aadhaar) : null}`,
        );
      if (bank !== undefined)
        sets.push(
          sql`bank_account_sealed = ${bank ? seal(deps.keys, bank, ctx('bank', actor, personId)) : null}::bytea`,
          sql`bank_last4 = ${bank ? last4(bank) : null}`,
        );
      if (sets.length > 0) {
        const r = await tx.execute(sql`
        update staff_profile set ${sql.join(sets, sql`, `)}
        where org_id = app_current_org() and person_id = ${personId} and status <> 'left'`);
        if (r.count === 0) throw new PeopleError('staff_not_found_or_left');
      }
      if (change.dateOfBirth !== undefined)
        await tx.execute(sql`
        update person set date_of_birth = ${change.dateOfBirth}::date where org_id = app_current_org() and id = ${personId}`);
      const custom = await saveValues(tx, 'staff', personId, change.custom ?? {});
      return {
        result: undefined,
        audit: {
          action: 'people.staff.update',
          entityType: 'person',
          entityId: personId,
          dataClass: sensitive ? ('restricted' as const) : ('personal' as const),
          detail: {
            fields: [...keys, ...(change.dateOfBirth !== undefined ? ['dateOfBirth'] : [])].join(
              ',',
            ),
            aadhaar: aadhaar === undefined ? null : 'changed',
            bankAccount: bank === undefined ? null : 'changed',
            custom: custom.join(','),
          },
        },
      };
    },
  );
}
