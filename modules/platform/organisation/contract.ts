// Public API of organisation: the campus tree (organisation, legal entity, campus, institution).
import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { InstitutionProfile } from './application/profiles.js';
import { writeAudit } from '@campusverse/platform-audit';
import { sql } from 'drizzle-orm';

export type NewOrganisation = {
  name: string;
  legalEntityName: string;
  gstin?: string | null;
  campusName: string;
  institution: {
    name: string;
    type: 'school' | 'college' | 'university';
    authorityCode: string;
    stateCode: string;
  };
};

export type CampusTree = {
  orgId: string;
  legalEntityId: string;
  campusId: string;
  institutionId: string;
};

/**
 * Creates a customer's campus tree in its own tenant context. A platform service with no tenant
 * actor (signup or the admin portal calls it), so the audit row records the system.
 * `then` runs in the same transaction, for the caller's own setup (roles, owner).
 */
export async function createOrganisation<T>(
  db: Db,
  input: NewOrganisation,
  then: (tx: Tx, tree: CampusTree) => Promise<T>,
): Promise<{ tree: CampusTree; result: T }> {
  const [row] = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
  if (!row) throw new Error('createOrganisation: no id');
  const orgId = row.id;
  return withTenant(db, orgId, async (tx) => {
    const one = async (q: ReturnType<typeof sql>) => {
      const [r] = await tx.execute<{ id: string }>(q);
      if (!r) throw new Error('createOrganisation: insert returned no row');
      return r.id;
    };
    await tx.execute(sql`insert into organisation (id, name) values (${orgId}, ${input.name})`);
    const legalEntityId = await one(sql`
      insert into legal_entity (org_id, name, gstin) values (${orgId}, ${input.legalEntityName}, ${input.gstin ?? null})
      returning id::text`);
    const campusId = await one(sql`
      insert into campus (org_id, name) values (${orgId}, ${input.campusName}) returning id::text`);
    const i = input.institution;
    const institutionId = await one(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, authority_code, name, state_code, status)
      values (${orgId}, ${campusId}, ${legalEntityId}, ${i.type}, ${i.authorityCode}, ${i.name}, ${i.stateCode}, 'setup')
      returning id::text`);
    const tree = { orgId, legalEntityId, campusId, institutionId };
    await writeAudit(tx, null, {
      action: 'platform.organisation.create',
      entityType: 'organisation',
      entityId: orgId,
      dataClass: 'operational',
      detail: { institutionType: i.type, authority: i.authorityCode, state: i.stateCode },
    });
    return { tree, result: await then(tx, tree) };
  });
}

/** Campus and institution ids for a permission check's `place`. Call inside the tenant. */
export async function placeOf(
  tx: Tx,
  institutionId: string,
): Promise<{ campusId: string; institutionId: string } | null> {
  const [row] = await tx.execute<{ campusId: string }>(sql`
    select campus_id::text as "campusId" from institution where org_id = app_current_org() and id = ${institutionId}`);
  return row ? { campusId: row.campusId, institutionId } : null;
}

/** An institution's profile, or null if there is no such institution. Call inside the tenant. */
export async function institutionProfile(
  tx: Tx,
  institutionId: string,
): Promise<InstitutionProfile | null> {
  const [row] = await tx.execute<{ profile: InstitutionProfile }>(sql`
    select profile from institution where org_id = app_current_org() and id = ${institutionId}`);
  return row?.profile ?? null;
}

export type InstitutionInfo = {
  institutionId: string;
  campusId: string;
  name: string;
  legalEntityId: string;
  legalEntityName: string;
  /** The legal entity's TAN (TDS on salaries), when set. */
  tan: string | null;
  stateCode: string | null;
  /** The board for a school, the affiliating university or regulator otherwise. */
  authorityCode: string;
  profile: InstitutionProfile;
};

/** An institution with its legal entity (receipts and invoices belong to the entity). Call inside the tenant. */
export async function institutionInfo(
  tx: Tx,
  institutionId: string,
): Promise<InstitutionInfo | null> {
  const [row] = await tx.execute<InstitutionInfo>(sql`
    select i.id::text as "institutionId", i.campus_id::text as "campusId", i.name,
      l.id::text as "legalEntityId", l.name as "legalEntityName", l.tan, i.state_code as "stateCode",
      i.authority_code as "authorityCode", i.profile
    from institution i join legal_entity l on l.org_id = i.org_id and l.id = i.legal_entity_id
    where i.org_id = app_current_org() and i.id = ${institutionId}`);
  return row ?? null;
}

export type Address = {
  addressLine?: string | null | undefined;
  city?: string | null | undefined;
  district?: string | null | undefined;
  stateCode: string;
  pincode?: string | null | undefined;
};

export type NewInstitution = Address & {
  name: string;
  type: 'school' | 'college' | 'university';
  /** Null or left out: the type's default (school, affiliated college, university). */
  profile?: InstitutionProfile | null | undefined;
  authorityCode: string;
  udiseCode?: string | null | undefined;
  affiliationNumber?: string | null | undefined;
  establishedYear?: number | null | undefined;
  medium?: string | null | undefined;
  lowestClass?: string | null | undefined;
  highestClass?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  website?: string | null | undefined;
};

export type NewTree = {
  name: string;
  legalEntityName: string;
  gstin?: string | null | undefined;
  campuses: (Address & { name: string; institutions: NewInstitution[] })[];
};

export type Tree = {
  orgId: string;
  legalEntityId: string;
  campuses: { campusId: string; name: string; institutionIds: string[] }[];
};

/**
 * Onboarding: a whole organisation at once (one legal entity, several campuses, each with its
 * institutions and their profiles), in its own tenant transaction. `then` runs in the same
 * transaction for the caller's setup (roles, the admin, the customer record).
 */
export async function createOrganisationTree<T>(
  db: Db,
  input: NewTree,
  then: (tx: Tx, tree: Tree) => Promise<T>,
): Promise<{ tree: Tree; result: T }> {
  const [row] = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
  if (!row) throw new Error('createOrganisationTree: no id');
  const orgId = row.id;
  return withTenant(db, orgId, async (tx) => {
    const one = async (q: ReturnType<typeof sql>) => {
      const [r] = await tx.execute<{ id: string }>(q);
      if (!r) throw new Error('createOrganisationTree: insert returned no row');
      return r.id;
    };
    await tx.execute(sql`insert into organisation (id, name) values (${orgId}, ${input.name})`);
    const legalEntityId = await one(sql`
      insert into legal_entity (org_id, name, gstin)
      values (${orgId}, ${input.legalEntityName}, ${input.gstin ?? null}) returning id::text`);
    const campuses: Tree['campuses'] = [];
    for (const c of input.campuses) {
      const campusId = await one(sql`
        insert into campus (org_id, name, address_line, city, district, state_code, pincode)
        values (${orgId}, ${c.name}, ${c.addressLine ?? null}, ${c.city ?? null}, ${c.district ?? null},
          ${c.stateCode}, ${c.pincode ?? null})
        returning id::text`);
      const institutionIds: string[] = [];
      for (const i of c.institutions) {
        institutionIds.push(
          await one(sql`
            insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name, state_code,
              status, udise_code, affiliation_number, established_year, medium, lowest_class, highest_class,
              address_line, city, district, pincode, phone, email, website)
            values (${orgId}, ${campusId}, ${legalEntityId}, ${i.type}, ${i.profile ?? null}, ${i.authorityCode}, ${i.name}, ${i.stateCode},
              'setup', ${i.udiseCode ?? null}, ${i.affiliationNumber ?? null}, ${i.establishedYear ?? null},
              ${i.medium ?? null}, ${i.lowestClass ?? null}, ${i.highestClass ?? null},
              ${i.addressLine ?? c.addressLine ?? null}, ${i.city ?? c.city ?? null},
              ${i.district ?? c.district ?? null}, ${i.pincode ?? c.pincode ?? null},
              ${i.phone ?? null}, ${i.email?.toLowerCase() ?? null}, ${i.website ?? null})
            returning id::text`),
        );
      }
      campuses.push({ campusId, name: c.name, institutionIds });
    }
    const tree = { orgId, legalEntityId, campuses };
    await writeAudit(tx, null, {
      action: 'platform.organisation.create',
      entityType: 'organisation',
      entityId: orgId,
      dataClass: 'operational',
      detail: {
        campuses: campuses.length,
        institutions: campuses.reduce((n, c) => n + c.institutionIds.length, 0),
        source: 'onboarding',
      },
    });
    return { tree, result: await then(tx, tree) };
  });
}

export type TreeView = {
  organisation: { orgId: string; name: string };
  campuses: {
    campusId: string;
    name: string;
    city: string | null;
    institutions: { institutionId: string; name: string; type: string; status: string }[];
  }[];
};

/** The organisation, its campuses and their institutions, for the scope switcher. Call inside the tenant. */
export async function organisationTree(tx: Tx): Promise<TreeView | null> {
  const [org] = await tx.execute<TreeView['organisation']>(sql`
    select id::text as "orgId", name from organisation where id = app_current_org()`);
  if (!org) return null;
  const rows = await tx.execute<{
    campusId: string;
    campus: string;
    city: string | null;
    institutionId: string | null;
    name: string | null;
    type: string | null;
    status: string | null;
  }>(sql`
    select c.id::text as "campusId", c.name as campus, c.city, i.id::text as "institutionId", i.name, i.type, i.status
    from campus c left join institution i on i.org_id = c.org_id and i.campus_id = c.id
    where c.org_id = app_current_org() order by c.name, i.name`);
  const campuses = new Map<string, TreeView['campuses'][number]>();
  for (const r of rows) {
    const c = campuses.get(r.campusId) ?? {
      campusId: r.campusId,
      name: r.campus,
      city: r.city,
      institutions: [],
    };
    if (r.institutionId && r.name && r.type && r.status)
      c.institutions.push({
        institutionId: r.institutionId,
        name: r.name,
        type: r.type,
        status: r.status,
      });
    campuses.set(r.campusId, c);
  }
  return { organisation: org, campuses: [...campuses.values()] };
}

export {
  ORGANISATION_CHANGED,
  OrganisationError,
  addCampus,
  addInstitution,
  INSTITUTION_PROFILES,
  type InstitutionProfile,
  brandFiles,
  campusGate,
  organisationProfile,
  setCampusPhoto,
  setOrganisationLogo,
  updateCampus,
  updateOrganisation,
  type CampusChange,
  type CampusProfile,
  type OrganisationChange,
  type OrganisationProfile,
} from './application/profiles.js';
