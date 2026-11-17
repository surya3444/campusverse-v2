// Milestone 19: the organisation and its campuses on screen. Owners (platform.organisation.manage)
// edit details, logos and campus locations, and add campuses and schools after onboarding.
// Every change is audited with the fields that changed (names of fields, never values).
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { saveValues, valuesOf, type FieldValue } from '@campusverse/platform-fields';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';

type Permissions = ReturnType<typeof createPermissions>;

export const INSTITUTION_PROFILES = [
  'school',
  'affiliated_college',
  'autonomous_college',
  'university',
] as const;
/** Rule book §12.3: what an institution is, which switches modules, words and rule source. */
export type InstitutionProfile = (typeof INSTITUTION_PROFILES)[number];

const MANAGE = 'platform.organisation.manage';

export const ORGANISATION_CHANGED = 'platform.organisation.changed.v1';

export class OrganisationError extends Error {
  constructor(readonly code: 'campus_not_found' | 'campus_has_institutions') {
    super(`organisation: ${code}`);
    this.name = 'OrganisationError';
  }
}

export type OrganisationProfile = {
  orgId: string;
  name: string;
  legalName: string;
  gstin: string | null;
  /** Tax deduction account number, for TDS on salaries (24Q, Form 16). */
  tan: string | null;
  registeredAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  brandColour: string | null;
  logoFileId: string | null;
  custom: Record<string, FieldValue>;
};

export type CampusProfile = {
  campusId: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  latitude: string | null;
  longitude: string | null;
  geofenceMetres: number;
  photoFileId: string | null;
  institutions: number;
  custom: Record<string, FieldValue>;
};

/** Every key optional and allowed to be undefined (a field not being changed). */
type Change<T> = { [K in keyof T]?: T[K] | undefined };

export type OrganisationChange = Change<
  Omit<OrganisationProfile, 'orgId' | 'custom' | 'logoFileId'>
> & {
  custom?: Record<string, unknown> | undefined;
};

export type CampusChange = Change<
  Omit<CampusProfile, 'campusId' | 'institutions' | 'custom' | 'photoFileId'>
> & { custom?: Record<string, unknown> | undefined };

const ORG_COLUMNS = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  website: 'website',
  brandColour: 'brand_colour',
} as const;
const LEGAL_COLUMNS = {
  legalName: 'name',
  gstin: 'gstin',
  tan: 'tan',
  registeredAddress: 'registered_address',
} as const;
const CAMPUS_COLUMNS = {
  name: 'name',
  addressLine: 'address_line',
  city: 'city',
  district: 'district',
  stateCode: 'state_code',
  pincode: 'pincode',
  phone: 'phone',
  email: 'email',
  latitude: 'latitude',
  longitude: 'longitude',
  geofenceMetres: 'geofence_metres',
} as const;

const org = (actor: Actor) => ({ orgId: actor.orgId });

/** Sets each given column; returns the keys that were given. */
async function setColumns<K extends string>(
  tx: Tx,
  table: 'organisation' | 'legal_entity' | 'campus',
  where: ReturnType<typeof sql>,
  columns: Record<K, string>,
  change: object,
): Promise<K[]> {
  const given = change as Partial<Record<K, unknown>>;
  const keys = (Object.keys(columns) as K[]).filter((k) => given[k] !== undefined);
  // One statement, so checks across columns (latitude with longitude) see the whole change.
  if (keys.length > 0)
    await tx.execute(sql`
      update ${sql.identifier(table)}
      set ${sql.join(
        keys.map((k) => sql`${sql.identifier(columns[k])} = ${given[k] ?? null}`),
        sql`, `,
      )}
      where ${where}`);
  return keys;
}

async function readCampuses(tx: Tx): Promise<CampusProfile[]> {
  const rows = await tx.execute<Omit<CampusProfile, 'custom'>>(sql`
    select c.id::text as "campusId", c.name, c.address_line as "addressLine", c.city, c.district,
      c.state_code as "stateCode", c.pincode, c.phone, c.email, c.latitude::text, c.longitude::text,
      c.geofence_metres as "geofenceMetres", c.photo_file_id::text as "photoFileId",
      (select count(*)::int from institution i where i.org_id = c.org_id and i.campus_id = c.id) as institutions
    from campus c where c.org_id = app_current_org() order by c.created_at`);
  return Promise.all(
    rows.map(async (c) => ({ ...c, custom: await valuesOf(tx, 'campus', c.campusId) })),
  );
}

/** The organisation's details and every campus, for owners. */
export async function organisationProfile(
  db: Db,
  permissions: Permissions,
  actor: Actor,
): Promise<{ organisation: OrganisationProfile; campuses: CampusProfile[] }> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, MANAGE, org(actor));
    const [o] = await tx.execute<Omit<OrganisationProfile, 'custom'>>(sql`
      select o.id::text as "orgId", o.name, l.name as "legalName", l.gstin, l.tan, l.registered_address as "registeredAddress",
        o.phone, o.email, o.website, o.brand_colour as "brandColour", o.logo_file_id::text as "logoFileId"
      from organisation o
      join lateral (select * from legal_entity where org_id = o.id order by created_at limit 1) l on true
      where o.id = app_current_org()`);
    if (!o) throw new Error('organisationProfile: organisation missing');
    return {
      organisation: { ...o, custom: await valuesOf(tx, 'organisation', actor.orgId) },
      campuses: await readCampuses(tx),
    };
  });
}

export async function updateOrganisation(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  change: OrganisationChange,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      const a = await setColumns(
        tx,
        'organisation',
        sql`id = app_current_org()`,
        ORG_COLUMNS,
        change,
      );
      const b = await setColumns(
        tx,
        'legal_entity',
        sql`org_id = app_current_org() and id = (select id from legal_entity where org_id = app_current_org() order by created_at limit 1)`,
        LEGAL_COLUMNS,
        change,
      );
      const custom = await saveValues(tx, 'organisation', actor.orgId, change.custom ?? {});
      return {
        result: undefined,
        audit: {
          action: 'platform.organisation.update',
          entityType: 'organisation',
          entityId: actor.orgId,
          dataClass: 'operational',
          detail: { fields: [...a, ...b].join(','), custom: custom.join(',') },
        },
        events: [{ type: ORGANISATION_CHANGED, payload: { orgId: actor.orgId } }],
      };
    },
  );
}

/** Sets or clears the organisation's logo (a stored, scanned image). */
export async function setOrganisationLogo(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  fileId: string | null,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      await tx.execute(
        sql`update organisation set logo_file_id = ${fileId} where id = app_current_org()`,
      );
      return {
        result: undefined,
        audit: {
          action: 'platform.organisation.set_logo',
          entityType: 'organisation',
          entityId: actor.orgId,
          dataClass: 'operational',
          detail: { fileId },
        },
        events: [{ type: ORGANISATION_CHANGED, payload: { orgId: actor.orgId } }],
      };
    },
  );
}

export async function addCampus(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: CampusChange & { name: string; stateCode: string },
): Promise<string> {
  return command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into campus (org_id, name, state_code) values (app_current_org(), ${input.name}, ${input.stateCode})
      returning id::text`);
      if (!row) throw new Error('addCampus: insert returned no row');
      const fields = await setColumns(
        tx,
        'campus',
        sql`org_id = app_current_org() and id = ${row.id}`,
        CAMPUS_COLUMNS,
        input,
      );
      const custom = await saveValues(tx, 'campus', row.id, input.custom ?? {});
      return {
        result: row.id,
        audit: {
          action: 'platform.organisation.add_campus',
          entityType: 'campus',
          entityId: row.id,
          dataClass: 'operational',
          detail: { fields: fields.join(','), custom: custom.join(',') },
        },
        events: [{ type: ORGANISATION_CHANGED, payload: { orgId: actor.orgId, campusId: row.id } }],
      };
    },
  );
}

export async function updateCampus(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  campusId: string,
  change: CampusChange,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      const [c] = await tx.execute(
        sql`select 1 from campus where org_id = app_current_org() and id = ${campusId}`,
      );
      if (!c) throw new OrganisationError('campus_not_found');
      const fields = await setColumns(
        tx,
        'campus',
        sql`org_id = app_current_org() and id = ${campusId}`,
        CAMPUS_COLUMNS,
        change,
      );
      const custom = await saveValues(tx, 'campus', campusId, change.custom ?? {});
      return {
        result: undefined,
        audit: {
          action: 'platform.organisation.update_campus',
          entityType: 'campus',
          entityId: campusId,
          dataClass: 'operational',
          detail: { fields: fields.join(','), custom: custom.join(',') },
        },
        events: [{ type: ORGANISATION_CHANGED, payload: { orgId: actor.orgId, campusId } }],
      };
    },
  );
}

export async function setCampusPhoto(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  campusId: string,
  fileId: string | null,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      const r = await tx.execute(sql`
      update campus set photo_file_id = ${fileId} where org_id = app_current_org() and id = ${campusId}`);
      if (r.count === 0) throw new OrganisationError('campus_not_found');
      return {
        result: undefined,
        audit: {
          action: 'platform.organisation.set_campus_photo',
          entityType: 'campus',
          entityId: campusId,
          dataClass: 'operational',
          detail: { fileId },
        },
      };
    },
  );
}

const TYPE_OF: Record<InstitutionProfile, 'school' | 'college' | 'university'> = {
  school: 'school',
  affiliated_college: 'college',
  autonomous_college: 'college',
  university: 'university',
};

/**
 * An institution added to a campus after onboarding: a school, or a college or university with
 * its profile (rule book §12.3). It starts in setup, under the organisation's legal entity. The
 * authority is the board for a school and the affiliating university (or UGC) otherwise.
 */
export async function addInstitution(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  campusId: string,
  input: {
    profile: InstitutionProfile;
    name: string;
    authorityCode: string;
    lowestClass?: string | null;
    highestClass?: string | null;
  },
): Promise<string> {
  const type = TYPE_OF[input.profile];
  return command(
    db,
    permissions,
    actor,
    { permission: MANAGE, resource: org(actor) },
    async (tx) => {
      const [c] = await tx.execute<{
        state: string | null;
        address: string | null;
        city: string | null;
        district: string | null;
        pincode: string | null;
      }>(sql`
      select state_code as state, address_line as address, city, district, pincode
      from campus where org_id = app_current_org() and id = ${campusId}`);
      if (!c) throw new OrganisationError('campus_not_found');
      const [row] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name, state_code,
        status, lowest_class, highest_class, address_line, city, district, pincode)
      select app_current_org(), ${campusId}, l.id, ${type}, ${input.profile}, ${input.authorityCode}, ${input.name},
        ${c.state}, 'setup', ${input.lowestClass ?? null}, ${input.highestClass ?? null}, ${c.address}, ${c.city},
        ${c.district}, ${c.pincode}
      from legal_entity l where l.org_id = app_current_org() order by l.created_at limit 1
      returning id::text`);
      if (!row) throw new Error('addInstitution: insert returned no row');
      return {
        result: row.id,
        audit: {
          action: 'platform.organisation.add_institution',
          entityType: 'institution',
          entityId: row.id,
          dataClass: 'operational',
          detail: { campusId, type, profile: input.profile, authority: input.authorityCode },
        },
        events: [
          {
            type: ORGANISATION_CHANGED,
            payload: { orgId: actor.orgId, campusId, institutionId: row.id },
          },
        ],
      };
    },
  );
}

/** Logos and campus photos are shown to everyone in the organisation: which file is current. */
export async function brandFiles(tx: Tx): Promise<{
  organisation: string | null;
  campuses: Record<string, string>;
  institutions: Record<string, string>;
}> {
  const [o] = await tx.execute<{ logo: string | null }>(sql`
    select logo_file_id::text as logo from organisation where id = app_current_org()`);
  const c = await tx.execute<{ id: string; f: string }>(sql`
    select id::text, photo_file_id::text as f from campus where org_id = app_current_org() and photo_file_id is not null`);
  const i = await tx.execute<{ id: string; f: string }>(sql`
    select id::text, logo_file_id::text as f from institution where org_id = app_current_org() and logo_file_id is not null`);
  return {
    organisation: o?.logo ?? null,
    campuses: Object.fromEntries(c.map((r) => [r.id, r.f])),
    institutions: Object.fromEntries(i.map((r) => [r.id, r.f])),
  };
}

/** Where a campus's gate is and how near counts as on campus; null if not set. Call inside the tenant. */
export async function campusGate(
  tx: Tx,
  campusId: string,
): Promise<{ lat: number; lng: number; radiusMetres: number } | null> {
  const [row] = await tx.execute<{ lat: string | null; lng: string | null; r: number }>(sql`
    select latitude::text as lat, longitude::text as lng, geofence_metres as r
    from campus where org_id = app_current_org() and id = ${campusId}`);
  return row?.lat && row.lng
    ? { lat: Number(row.lat), lng: Number(row.lng), radiusMetres: row.r }
    : null;
}
