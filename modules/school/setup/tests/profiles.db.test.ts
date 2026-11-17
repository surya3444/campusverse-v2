// Milestone 19 across modules (school module, per the rules): the organisation and campuses,
// logos, photos and their permissions, and files served only once the scanner has cleared them.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { myProfile, photoOf, setPhoto, updateMyProfile } from '@campusverse/people-records';
import {
  cleanFileBytes,
  FileRefused,
  storeFile,
  type ObjectStore,
} from '@campusverse/platform-documents';
import {
  addCampus,
  addInstitution,
  organisationProfile,
  setOrganisationLogo,
  updateCampus,
  updateOrganisation,
} from '@campusverse/platform-organisation';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);
const people = { db, permissions, keys: null as never, placements: [] };

// In-memory private storage: enough to store and read bytes in a test.
const objects = new Map<string, Uint8Array>();
const store: ObjectStore = {
  put: async (key, bytes) => void objects.set(key, bytes),
  get: async (key) => objects.get(key) ?? null,
  size: async (key) => objects.get(key)?.length ?? null,
  signedUpload: async () => 'http://unused',
  signedDownload: async () => 'http://unused',
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let t: SeededTenant;
let owner: Actor;
let principal: Actor;
let guardian: Actor;
let stranger: Actor;

const markClean = (fileId: string) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute(
      sql`update stored_file set scan_status = 'clean' where org_id = app_current_org() and id = ${fileId}`,
    ),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Profiles');
  owner = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'platform.organisation.manage',
      'platform.file.upload',
    ]),
  };
  principal = { accountId: randomUUID(), orgId: t.orgId, personId: t.principalId };
  guardian = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  // Every role lets its holders change their own profile (0018); the seed predates that.
  await withTenant(db, t.orgId, async (tx) => {
    await tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      select org_id, id, 'people.profile.update_own', 'self' from role where org_id = app_current_org()
      on conflict do nothing`);
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Other Parent') returning id::text`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select app_current_org(), ${p!.id}, id, 'organisation', app_current_org() from role where key = 'parent'`);
    stranger = { accountId: randomUUID(), orgId: t.orgId, personId: p!.id };
  });
});

afterAll(() => close());

describe('the organisation and campuses', () => {
  it('lets an owner change the organisation and keeps who changed it', async () => {
    await updateOrganisation(db, permissions, owner, {
      name: 'Synthetic Learning Trust',
      phone: '+918040000000',
      brandColour: '#2150e0',
    });
    const { organisation } = await organisationProfile(db, permissions, owner);
    expect(organisation).toMatchObject({
      name: 'Synthetic Learning Trust',
      brandColour: '#2150e0',
    });
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ actor: string; detail: { fields: string } }>(sql`
        select actor_person_id::text as actor, detail from audit_event
        where org_id = app_current_org() and action = 'platform.organisation.update'
        order by occurred_at desc limit 1`),
    );
    expect(row).toMatchObject({
      actor: owner.personId,
      detail: { fields: 'name,phone,brandColour' },
    });
  });

  it('refuses everyone else, and changes nothing', async () => {
    await expect(
      updateOrganisation(db, permissions, principal, { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(organisationProfile(db, permissions, principal)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const { organisation } = await organisationProfile(db, permissions, owner);
    expect(organisation.name).toBe('Synthetic Learning Trust');
  });

  it('adds a campus with its location, then a school on it', async () => {
    const campusId = await addCampus(db, permissions, owner, {
      name: 'Synthetic North Campus',
      stateCode: 'KA',
      city: 'Bengaluru',
    });
    await updateCampus(db, permissions, owner, campusId, {
      latitude: '12.971599',
      longitude: '77.594566',
      geofenceMetres: 250,
    });
    const schoolId = await addInstitution(db, permissions, owner, campusId, {
      name: 'Synthetic North School',
      profile: 'school',
      authorityCode: 'CBSE',
    });
    const { campuses } = await organisationProfile(db, permissions, owner);
    expect(campuses.find((c) => c.campusId === campusId)).toMatchObject({
      latitude: '12.971599',
      geofenceMetres: 250,
      institutions: 1,
      city: 'Bengaluru',
    });
    expect(schoolId).toMatch(/^[0-9a-f-]{36}$/);
    // A college under its affiliating university, with its profile (rule book §12.3).
    const collegeId = await addInstitution(db, permissions, owner, campusId, {
      name: 'Synthetic North College',
      profile: 'autonomous_college',
      authorityCode: 'VTU',
    });
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ type: string; profile: string }>(sql`
        select type, profile from institution where id = ${collegeId}`),
    );
    expect(row).toEqual({ type: 'college', profile: 'autonomous_college' });
  });

  it('serves a logo only once the scanner has cleared it', async () => {
    const fileId = await storeFile(
      db,
      permissions,
      store,
      owner,
      { permission: 'platform.organisation.manage', resource: { orgId: t.orgId } },
      { purpose: 'logo', fileName: 'logo.png', contentType: 'image/png', bytes: PNG },
    );
    await setOrganisationLogo(db, permissions, owner, fileId);
    await expect(cleanFileBytes(db, store, t.orgId, fileId)).rejects.toBeInstanceOf(FileRefused);
    await markClean(fileId);
    expect((await cleanFileBytes(db, store, t.orgId, fileId)).bytes).toEqual(PNG);
  });

  it('refuses a file that is not what it says it is', async () => {
    await expect(
      storeFile(
        db,
        permissions,
        store,
        owner,
        { permission: 'platform.organisation.manage', resource: { orgId: t.orgId } },
        {
          purpose: 'logo',
          fileName: 'logo.png',
          contentType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ),
    ).rejects.toMatchObject({ code: 'file_type' });
  });
});

describe('photos and my profile', () => {
  it('lets anyone change their own photo, email and language', async () => {
    const fileId = await storeFile(
      db,
      permissions,
      store,
      principal,
      {
        permission: 'people.profile.update_own',
        resource: {
          orgId: t.orgId,
          subjectPersonId: t.principalId,
          place: { campusId: await campusOf(), institutionId: t.institutionId },
        },
      },
      { purpose: 'photo', fileName: 'me.png', contentType: 'image/png', bytes: PNG },
    );
    await setPhoto(people, principal, t.principalId, fileId);
    await updateMyProfile(people, principal, {
      email: 'Principal@Synthetic.Test',
      preferredLanguage: 'kn',
    });
    expect(await myProfile(people, principal)).toMatchObject({
      photoFileId: fileId,
      email: 'principal@synthetic.test',
      preferredLanguage: 'kn',
    });
  });

  it("refuses changing someone else's photo without the right to update their record", async () => {
    await expect(setPhoto(people, principal, t.studentId, null)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(setPhoto(people, guardian, t.studentId, null)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("shows a child's photo to their guardian, and to no other parent", async () => {
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`update person set photo_file_id = (select photo_file_id from person where id = ${t.principalId})
        where org_id = app_current_org() and id = ${t.studentId}`),
    );
    expect(await photoOf(people, guardian, t.studentId)).not.toBeNull();
    await expect(photoOf(people, stranger, t.studentId)).rejects.toBeInstanceOf(PermissionDenied);
  });
});

async function campusOf(): Promise<string> {
  const [r] = await withTenant(db, t.orgId, (tx) =>
    tx.execute<{ c: string }>(
      sql`select campus_id::text as c from institution where org_id = app_current_org() and id = ${t.institutionId}`,
    ),
  );
  return r!.c;
}
