// Identity & Access, the four-part check made visible (rule book §10.3): case grants for sensitive
// data, and an explanation of why someone can or can't do something.
import { withTenant, type Db } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  endCaseGrant,
  insertCaseGrant,
  listCaseGrants,
  listRoles,
  rolesOf,
  type Actor,
  type Decision,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { CATALOGUE, dataClassOf, type DataClass } from '../domain/catalogue.js';
import { AccessError } from './access.js';

type Permissions = ReturnType<typeof createPermissions>;
type Deps = { db: Db; permissions: Permissions };
const DPO = 'platform.privacy.manage';
export const CASE_GRANTED = 'platform.access.case_granted.v1';
export const CASE_ENDED = 'platform.access.case_ended.v1';
/** A case grant lasts at most a week (the database holds the same limit). */
export const CASE_MAX_HOURS = 168;

/**
 * The Data Protection Officer lets one person use one sensitive permission about one person, for
 * a reason, for up to a week. Only sensitive permissions; never to oneself; logged as sensitive.
 */
export async function grantCase(
  deps: Deps,
  actor: Actor,
  input: {
    granteeId: string;
    permission: string;
    subjectId: string;
    reason: string;
    hours: number;
  },
): Promise<string> {
  if (!(input.permission in CATALOGUE) || dataClassOf(input.permission) !== 'sensitive')
    throw new AccessError('not_sensitive');
  if (input.granteeId === actor.personId) throw new AccessError('own_request');
  const reason = input.reason.trim();
  if (reason.length < 10) throw new AccessError('reason');
  const hours = Math.min(CASE_MAX_HOURS, Math.max(1, Math.round(input.hours)));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: DPO, resource: { orgId: actor.orgId } },
    async (tx) => {
      if ((await rolesOf(tx, input.granteeId)).length === 0) throw new AccessError('not_staff');
      const id = await insertCaseGrant(tx, {
        granteeId: input.granteeId,
        permission: input.permission,
        subjectId: input.subjectId,
        reason,
        grantedById: actor.personId,
        hours,
      });
      return {
        result: id,
        audit: {
          action: 'platform.access.case_grant',
          entityType: 'person',
          entityId: input.subjectId,
          dataClass: 'sensitive',
          reason,
          detail: { grantee: input.granteeId, permission: input.permission, hours },
        },
        events: [
          {
            type: CASE_GRANTED,
            payload: {
              grantId: id,
              granteeId: input.granteeId,
              permission: input.permission,
              hours,
            },
          },
        ],
      };
    },
  );
}

/** Ends a running case grant before it expires. */
export async function endCase(deps: Deps, actor: Actor, grantId: string): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: DPO, resource: { orgId: actor.orgId } },
    async (tx) => {
      const g = await endCaseGrant(tx, grantId, actor.personId);
      if (!g) throw new AccessError('not_found');
      return {
        result: undefined,
        audit: {
          action: 'platform.access.case_end',
          entityType: 'person',
          entityId: g.subjectId,
          dataClass: 'sensitive',
          detail: { grantId, grantee: g.granteeId, permission: g.permission },
        },
        events: [{ type: CASE_ENDED, payload: { grantId } }],
      };
    },
  );
}

export type CaseGrantRow = {
  id: string;
  grantee: string;
  subject: string;
  grantedBy: string;
  permission: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
  endedAt: string | null;
  running: boolean;
};

/** Running case grants and those that closed in the last 30 days, for the DPO. */
export async function caseGrants(deps: Deps, actor: Actor): Promise<CaseGrantRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, DPO, { orgId: actor.orgId });
    const rows = await listCaseGrants(tx);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => [r.granteeId, r.subjectId, r.grantedById]),
    );
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      grantee: names[r.granteeId] ?? '',
      subject: names[r.subjectId] ?? '',
      grantedBy: names[r.grantedById] ?? '',
      permission: r.permission,
      reason: r.reason,
      grantedAt: r.grantedAt,
      expiresAt: r.expiresAt,
      endedAt: r.endedAt,
      running: !r.endedAt && new Date(r.expiresAt).getTime() > now,
    }));
  });
}

export type AccessExplanation = {
  decision: Decision;
  dataClass: DataClass;
  /** The person's current roles that carry the permission, and whether each reaches the place. */
  roles: {
    role: string;
    scope: 'organisation' | 'campus' | 'institution';
    reaches: boolean;
    /** Granted only for the person's own records or their wards (self or guardian). */
    needsRelationship: boolean;
  }[];
};

/**
 * Why a person can or can't use a permission at an institution (and about a person): the four
 * parts of the check — role, scope, relationship, data class — and any case grant (§10.3).
 */
export async function explainAccess(
  deps: Deps,
  actor: Actor,
  input: {
    personId: string;
    permission: string;
    institutionId: string | null;
    subjectId: string | null;
  },
): Promise<AccessExplanation> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'platform.role.read', { orgId: actor.orgId });
    if (!(input.permission in CATALOGUE))
      throw new AccessError('unknown_permission', [input.permission]);
    const place = input.institutionId ? await placeOf(tx, input.institutionId) : null;
    if (input.institutionId && !place) throw new AccessError('not_found');
    const resource = {
      orgId: actor.orgId,
      ...(place ? { place } : {}),
      ...(input.subjectId ? { subjectPersonId: input.subjectId } : {}),
    };
    const decision = await deps.permissions.can(
      tx,
      { accountId: actor.accountId, orgId: actor.orgId, personId: input.personId },
      input.permission,
      resource,
    );
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = d?.d ?? '';
    // Role key → whether it carries the permission only for a relationship (self or ward).
    const carrying = new Map<string, boolean>();
    for (const r of await listRoles(tx)) {
      if (r.permissions.includes(input.permission)) carrying.set(r.key, false);
      else if (r.relational.includes(input.permission)) carrying.set(r.key, true);
    }
    const roles = (await rolesOf(tx, input.personId))
      .filter((r) => r.from <= today && (r.until === null || r.until >= today))
      .filter((r) => carrying.has(r.roleKey))
      .map((r) => {
        const scope = r.scopeType as 'organisation' | 'campus' | 'institution';
        const reaches =
          scope === 'organisation' ||
          (scope === 'campus' && r.scopeId === place?.campusId) ||
          (scope === 'institution' && r.scopeId === place?.institutionId);
        return {
          role: r.roleName,
          scope,
          reaches: !!reaches,
          needsRelationship: carrying.get(r.roleKey) === true,
        };
      });
    return { decision, dataClass: dataClassOf(input.permission), roles };
  });
}
