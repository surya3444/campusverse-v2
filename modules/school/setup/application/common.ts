import { withTenant, type Db } from '@campusverse/db';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource } from '@campusverse/platform-permissions';

/** A setup failure the person can act on. `code` maps to a message in the language files. */
export const STRUCTURE_APPLIED = 'school.structure.applied.v1';

export class SetupError extends Error {
  constructor(
    readonly code: string,
    readonly details: unknown = null,
  ) {
    super(`Setup: ${code}`);
    this.name = 'SetupError';
  }
}

/** The permission resource for work on one institution. Unknown institution: not found. */
export async function institutionResource(
  db: Db,
  actor: Actor,
  institutionId: string,
): Promise<Resource> {
  const place = await withTenant(db, actor.orgId, (tx) => placeOf(tx, institutionId));
  if (!place) throw new SetupError('institution_not_found');
  return { orgId: actor.orgId, place };
}
