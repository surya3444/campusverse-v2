import { schema, withTenant, type Db } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { and, eq } from 'drizzle-orm';
import { authenticate } from './sessions.js';

const { accountPersonLink, organisation, person } = schema;

export type Profile = { orgId: string; personId: string; orgName: string; personName: string };

/**
 * The people this login can act as, for the organisation and shared-phone profile picker.
 * Names are read inside each organisation's own tenant context.
 */
export async function listProfiles(db: Db, accountId: string): Promise<Profile[]> {
  const links = await db
    .select({ orgId: accountPersonLink.orgId, personId: accountPersonLink.personId })
    .from(accountPersonLink)
    .where(eq(accountPersonLink.accountId, accountId));

  const profiles: Profile[] = [];
  for (const link of links) {
    const [row] = await withTenant(db, link.orgId, (tx) =>
      tx
        .select({ orgName: organisation.name, personName: person.legalName })
        .from(person)
        .innerJoin(organisation, eq(organisation.id, person.orgId))
        .where(and(eq(person.orgId, link.orgId), eq(person.id, link.personId))),
    );
    if (row) profiles.push({ ...link, ...row });
  }
  return profiles;
}

/**
 * Turns an access token plus the chosen profile into an Actor. The org and person come from
 * the client, so they are accepted only if this login is linked to that person.
 */
export async function resolveActor(
  db: Db,
  accessToken: string,
  chosen: { orgId: string; personId: string },
): Promise<Actor | null> {
  const auth = await authenticate(db, accessToken);
  if (!auth) return null;
  const [link] = await db
    .select({ orgId: accountPersonLink.orgId })
    .from(accountPersonLink)
    .where(
      and(
        eq(accountPersonLink.accountId, auth.accountId),
        eq(accountPersonLink.orgId, chosen.orgId),
        eq(accountPersonLink.personId, chosen.personId),
      ),
    );
  return link
    ? { accountId: auth.accountId, orgId: chosen.orgId, personId: chosen.personId }
    : null;
}
