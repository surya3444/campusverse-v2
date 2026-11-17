// Milestone 19: photos and "My profile". Anyone may change their own photo, email and language
// (people.profile.update_own, relation self); a student's or staff member's photo is changed by
// those who may update that record, and seen by those who may read it (guardians included).
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { PeopleError, personResource, type PeopleDeps } from './records.js';

export const PROFILE_CHANGED = 'people.profile.changed.v1';
const OWN = 'people.profile.update_own';
export type Language = 'en' | 'kn' | 'te' | 'ta' | 'hi' | 'mr' | 'ur';

/**
 * Resources for acting on one's own record: one per place the person holds a role, since a
 * 'self' grant still sits at its role's scope. Organisation-wide first.
 */
async function selfResources(tx: Tx, actor: Actor): Promise<Resource[]> {
  const scopes = await tx.execute<{ type: string; id: string; campus: string | null }>(sql`
    select a.scope_type as type, a.scope_id::text as id,
      case a.scope_type when 'institution' then (select campus_id::text from institution i
        where i.org_id = a.org_id and i.id = a.scope_id) end as campus
    from role_assignment a
    where a.org_id = app_current_org() and a.person_id = ${actor.personId} and a.valid_during @> app_today()
    order by a.scope_type = 'organisation' desc`);
  const self = { orgId: actor.orgId, subjectPersonId: actor.personId };
  return [
    self,
    ...scopes.flatMap((s): Resource[] =>
      s.type === 'campus'
        ? [{ ...self, place: { campusId: s.id } }]
        : s.type === 'institution' && s.campus
          ? [{ ...self, place: { campusId: s.campus, institutionId: s.id } }]
          : [],
    ),
  ];
}

async function ownResource(deps: PeopleDeps, actor: Actor): Promise<Resource> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const candidates = await selfResources(tx, actor);
    for (const r of candidates)
      if ((await deps.permissions.can(tx, actor, OWN, r)).allowed) return r;
    return candidates[0] as Resource;
  });
}

async function kindOf(tx: Tx, personId: string): Promise<'student' | 'staff' | 'other'> {
  const [row] = await tx.execute<{ student: boolean; staff: boolean }>(sql`
    select exists (select 1 from student_profile where org_id = app_current_org() and person_id = ${personId}) as student,
      exists (select 1 from staff_profile where org_id = app_current_org() and person_id = ${personId}) as staff`);
  return row?.student ? 'student' : row?.staff ? 'staff' : 'other';
}

/** Which permission changes or shows this person's photo, and where it is checked. */
export async function photoCheck(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  mode: 'change' | 'read',
): Promise<{ permission: string; resource: Resource } | 'self'> {
  if (personId === actor.personId)
    return mode === 'read' ? 'self' : { permission: OWN, resource: await ownResource(deps, actor) };
  const kind = await withTenant(deps.db, actor.orgId, (tx) => kindOf(tx, personId));
  if (kind === 'other') throw new PeopleError('person_not_found');
  const permission = `people.${kind}.${mode === 'change' ? 'update' : 'read'}`;
  return { permission, resource: await personResource(deps, actor, permission, personId, kind) };
}

/** Sets or clears a person's photo (a stored file that the scanner has seen or will see). */
export async function setPhoto(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  fileId: string | null,
): Promise<void> {
  const check = await photoCheck(deps, actor, personId, 'change');
  if (check === 'self') throw new Error('unreachable');
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    await tx.execute(sql`
      update person set photo_file_id = ${fileId} where org_id = app_current_org() and id = ${personId}`);
    return {
      result: undefined,
      audit: {
        action: 'people.person.set_photo',
        entityType: 'person',
        entityId: personId,
        dataClass: 'personal',
        detail: { fileId },
      },
      events: [{ type: PROFILE_CHANGED, payload: { personId } }],
    };
  });
}

/** The current photo's file id, if the actor may see this person. */
export async function photoOf(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
): Promise<string | null> {
  const check = await photoCheck(deps, actor, personId, 'read');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    if (check !== 'self')
      await deps.permissions.assertCan(tx, actor, check.permission, check.resource);
    const [row] = await tx.execute<{ f: string | null }>(sql`
      select photo_file_id::text as f from person where org_id = app_current_org() and id = ${personId}`);
    return row?.f ?? null;
  });
}

export type MyProfile = {
  personId: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferredLanguage: Language;
  photoFileId: string | null;
};

/** One's own profile: always readable by oneself. */
export async function myProfile(deps: PeopleDeps, actor: Actor): Promise<MyProfile> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [p] = await tx.execute<MyProfile>(sql`
      select p.id::text as "personId", p.legal_name as name, p.email, p.preferred_language as "preferredLanguage",
        p.photo_file_id::text as "photoFileId",
        (select address from person_contact c where c.org_id = p.org_id and c.person_id = p.id
           and c.channel = 'sms' and c.disabled_at is null order by c.created_at limit 1) as phone
      from person p where p.org_id = app_current_org() and p.id = ${actor.personId}`);
    if (!p) throw new PeopleError('person_not_found');
    return p;
  });
}

export async function updateMyProfile(
  deps: PeopleDeps,
  actor: Actor,
  change: { email?: string | null; preferredLanguage?: Language },
): Promise<void> {
  const fields = (['email', 'preferredLanguage'] as const).filter((k) => change[k] !== undefined);
  if (fields.length === 0) return;
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: OWN, resource: await ownResource(deps, actor) },
    async (tx) => {
      if (change.email !== undefined)
        await tx.execute(sql`
        update person set email = ${change.email?.trim().toLowerCase() || null}
        where org_id = app_current_org() and id = ${actor.personId}`);
      if (change.preferredLanguage !== undefined)
        await tx.execute(sql`
        update person set preferred_language = ${change.preferredLanguage}
        where org_id = app_current_org() and id = ${actor.personId}`);
      return {
        result: undefined,
        audit: {
          action: 'people.profile.update_own',
          entityType: 'person',
          entityId: actor.personId,
          dataClass: 'personal',
          detail: { fields: fields.join(',') },
        },
        events: [{ type: PROFILE_CHANGED, payload: { personId: actor.personId } }],
      };
    },
  );
}

/** Inside another module's command (admissions enrolment): the applicant's photo becomes the student's. */
export async function setPhotoIn(tx: Tx, personId: string, fileId: string): Promise<void> {
  await tx.execute(sql`
    update person set photo_file_id = ${fileId} where org_id = app_current_org() and id = ${personId}`);
}
