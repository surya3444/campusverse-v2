// The school's profile (what onboarding asked for): readable by anyone who can read setup,
// editable by those who can manage it. Every change is audited with the fields that changed.
import { withTenant, type Db } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { saveValues, valuesOf, type FieldValue } from '@campusverse/platform-fields';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { institutionResource, SetupError } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;

export type SchoolProfile = {
  name: string;
  board: string;
  stateCode: string | null;
  status: string;
  campus: string;
  udiseCode: string | null;
  affiliationNumber: string | null;
  establishedYear: number | null;
  medium: string | null;
  lowestClass: string | null;
  highestClass: string | null;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoFileId: string | null;
  /** Whether a signature is on file; the image itself is shown only to those who manage setup. */
  hasSignature: boolean;
  /** Owner-defined institution fields, by key. */
  custom: Record<string, FieldValue>;
};

export type ProfileChange = {
  /** Owner-defined fields to change, by key (checked against their definitions). */
  custom?: Record<string, unknown> | undefined;
} & {
  [
    K in keyof Pick<
      SchoolProfile,
      | 'name'
      | 'udiseCode'
      | 'affiliationNumber'
      | 'establishedYear'
      | 'medium'
      | 'lowestClass'
      | 'highestClass'
      | 'addressLine'
      | 'city'
      | 'district'
      | 'pincode'
      | 'phone'
      | 'email'
      | 'website'
    >
  ]?: SchoolProfile[K] | undefined;
};

const COLUMNS: Record<Exclude<keyof ProfileChange, 'custom'>, string> = {
  name: 'name',
  udiseCode: 'udise_code',
  affiliationNumber: 'affiliation_number',
  establishedYear: 'established_year',
  medium: 'medium',
  lowestClass: 'lowest_class',
  highestClass: 'highest_class',
  addressLine: 'address_line',
  city: 'city',
  district: 'district',
  pincode: 'pincode',
  phone: 'phone',
  email: 'email',
  website: 'website',
};

export async function schoolProfile(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<SchoolProfile> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const [p] = await tx.execute<Omit<SchoolProfile, 'custom'>>(sql`
      select i.name, i.authority_code as board, i.state_code as "stateCode", i.status, c.name as campus,
        i.udise_code as "udiseCode", i.affiliation_number as "affiliationNumber",
        i.established_year as "establishedYear", i.medium, i.lowest_class as "lowestClass",
        i.highest_class as "highestClass", i.address_line as "addressLine", i.city, i.district,
        i.pincode, i.phone, i.email, i.website, i.logo_file_id::text as "logoFileId",
        i.signature_file_id is not null as "hasSignature"
      from institution i join campus c on c.org_id = i.org_id and c.id = i.campus_id
      where i.org_id = app_current_org() and i.id = ${institutionId}`);
    if (!p) throw new SetupError('institution_not_found');
    return { ...p, custom: await valuesOf(tx, 'institution', institutionId) };
  });
}

export async function updateSchoolProfile(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  change: ProfileChange,
): Promise<void> {
  const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter(
    (k) => change[k] !== undefined,
  );
  const custom = change.custom ?? {};
  if (fields.length === 0 && Object.keys(custom).length === 0) return;
  await command(
    db,
    permissions,
    actor,
    {
      permission: 'school.setup.manage',
      resource: await institutionResource(db, actor, institutionId),
    },
    async (tx) => {
      for (const k of fields)
        await tx.execute(sql`
          update institution set ${sql.identifier(COLUMNS[k])} = ${change[k] ?? null}
          where org_id = app_current_org() and id = ${institutionId}`);
      const customChanged = await saveValues(tx, 'institution', institutionId, custom);
      return {
        result: undefined,
        audit: {
          action: 'school.setup.profile_update',
          entityType: 'institution',
          entityId: institutionId,
          dataClass: 'operational',
          detail: { fields: fields.join(','), custom: customChanged.join(',') },
        },
      };
    },
  );
}

/** Sets or clears the school's logo or the principal's signature (stored, scanned images). */
export async function setInstitutionImage(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  kind: 'logo' | 'signature',
  fileId: string | null,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    {
      permission: 'school.setup.manage',
      resource: await institutionResource(db, actor, institutionId),
    },
    async (tx) => {
      await tx.execute(sql`
        update institution set ${sql.identifier(kind === 'logo' ? 'logo_file_id' : 'signature_file_id')} = ${fileId}
        where org_id = app_current_org() and id = ${institutionId}`);
      return {
        result: undefined,
        audit: {
          action: `school.setup.set_${kind}`,
          entityType: 'institution',
          entityId: institutionId,
          dataClass: 'operational',
          detail: { fileId },
        },
      };
    },
  );
}

/** Which image file a school uses for its logo or signature. Signature needs school.setup.manage. */
export async function institutionImage(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  kind: 'logo' | 'signature',
): Promise<string | null> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    if (kind === 'signature')
      await permissions.assertCan(tx, actor, 'school.setup.manage', resource);
    const [row] = await tx.execute<{ f: string | null }>(sql`
      select ${sql.identifier(kind === 'logo' ? 'logo_file_id' : 'signature_file_id')}::text as f
      from institution where org_id = app_current_org() and id = ${institutionId}`);
    return row?.f ?? null;
  });
}
