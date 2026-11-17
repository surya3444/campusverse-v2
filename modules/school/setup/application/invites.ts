import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command, type Consumer } from '@campusverse/platform-events';
import { inviteAccount } from '@campusverse/platform-identity';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { COPY } from '../copy.js';
import { institutionResource } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;

export const INVITES_REQUESTED = 'school.invites.requested.v1';

type Candidate = {
  personId: string;
  kind: 'staff' | 'guardian';
  phone: string | null;
  email: string | null;
  linked: boolean;
};

/**
 * Everyone who should get a login: staff of the school, and guardians of its current or
 * upcoming students who may log in and aren't restricted.
 */
async function candidates(tx: Tx, institutionId: string): Promise<Candidate[]> {
  const rows = await tx.execute<Candidate>(sql`
    with people as (
      select distinct sp.person_id, 'staff' as kind, sp.work_email as email
      from staff_profile sp
      join role_assignment ra on ra.org_id = sp.org_id and ra.person_id = sp.person_id
      where sp.org_id = app_current_org() and ra.scope_id = ${institutionId} and upper_inf(ra.valid_during)
      union
      select distinct g.guardian_person_id, 'guardian', null::text
      from guardian_link g
      join school_enrolment e on e.org_id = g.org_id and e.person_id = g.student_person_id
      where g.org_id = app_current_org() and e.institution_id = ${institutionId}
        and upper(e.valid_during) > app_today() and upper_inf(g.valid_during)
        and g.restricted_at is null and g.can_login
    )
    select distinct on (p.person_id) p.person_id::text as "personId", p.kind, p.email,
      c.address as phone,
      exists (select 1 from identity.account_person_link l
              where l.org_id = app_current_org() and l.person_id = p.person_id) as linked
    from people p
    left join person_contact c on c.org_id = app_current_org() and c.person_id = p.person_id
      and c.channel = 'sms' and c.disabled_at is null
    -- 'staff' sorts after 'guardian', so desc picks staff for a teacher who is also a parent
    order by p.person_id, p.kind desc`);
  return [...rows];
}

export type InvitePreview = {
  staff: number;
  guardians: number;
  alreadyInvited: number;
  noPhone: number;
};

/** Wizard step 6, preview: who would get an invitation. */
export async function previewInvites(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<InvitePreview> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const all = await candidates(tx, institutionId);
    const due = all.filter((c) => !c.linked && c.phone);
    return {
      staff: due.filter((c) => c.kind === 'staff').length,
      guardians: due.filter((c) => c.kind === 'guardian').length,
      alreadyInvited: all.filter((c) => c.linked).length,
      noPhone: all.filter((c) => !c.phone).length,
    };
  });
}

/** Wizard step 6, confirmed: queues the invitations. A worker sends them. */
export async function sendInvites(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<void> {
  const resource = await institutionResource(db, actor, institutionId);
  await command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async () => ({
      result: undefined,
      audit: {
        action: 'school.setup.manage',
        entityType: 'institution',
        entityId: institutionId,
        dataClass: 'personal',
        detail: { step: 'invites' },
      },
      events: [{ type: INVITES_REQUESTED, payload: { institutionId } }],
    }),
  );
}

/**
 * Creates each login and queues a welcome message, exactly once per event. Repeat requests are
 * harmless too: linked people are skipped and each welcome has a per-person dedupe key.
 */
export const invitesConsumer: Consumer = {
  name: 'school.invites',
  queue: 'notifications',
  events: [INVITES_REQUESTED],
  handle: async (tx, event) => {
    const institutionId = String(event.payload.institutionId);
    const [school] = await tx.execute<{ name: string }>(sql`
      select name from institution where org_id = app_current_org() and id = ${institutionId}`);
    if (!school) return;
    for (const c of await candidates(tx, institutionId)) {
      if (c.linked || !c.phone) continue;
      await inviteAccount(tx, {
        orgId: event.orgId,
        personId: c.personId,
        phone: c.phone,
        email: c.email,
      });
      await requestMessage(tx, {
        recipientPersonId: c.personId,
        kind: 'account',
        language: 'en',
        title: COPY.en.inviteTitle(school.name),
        body:
          c.kind === 'staff'
            ? COPY.en.inviteStaffBody(school.name)
            : COPY.en.inviteGuardianBody(school.name),
        dedupeKey: `invite:${c.personId}`,
      });
    }
  },
};
