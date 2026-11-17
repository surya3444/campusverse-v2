// Public API of the permissions module. Other modules import only this file.
import type { Redis, Tx } from '@campusverse/db';
import { evaluate, type Decision, type DenyReason, type Resource } from './domain/evaluate.js';
import { loadSnapshot } from './infrastructure/snapshot.js';

export type { Decision, DenyReason, Resource } from './domain/evaluate.js';

/** A verified person acting inside one organisation. Built by identity, never from client input. */
export type Actor = { accountId: string; orgId: string; personId: string };

export class PermissionDenied extends Error {
  constructor(
    readonly permission: string,
    readonly reason: DenyReason,
  ) {
    super(`Permission denied: ${permission} (${reason})`);
    this.name = 'PermissionDenied';
  }
}

/** Pass null for Redis to always read Postgres. tx must come from withTenant(actor.orgId). */
export function createPermissions(redis: Redis | null) {
  async function can(
    tx: Tx,
    actor: Actor,
    permission: string,
    resource: Resource,
  ): Promise<Decision> {
    return evaluate(await loadSnapshot(tx, redis, actor), permission, resource);
  }

  async function assertCan(tx: Tx, actor: Actor, permission: string, resource: Resource) {
    const decision = await can(tx, actor, permission, resource);
    if (!decision.allowed) throw new PermissionDenied(permission, decision.reason);
  }

  return { can, assertCan };
}

export {
  endCaseGrant,
  insertCaseGrant,
  listCaseGrants,
  type CaseGrant,
} from './infrastructure/cases.js';
export {
  assignRole,
  currentRoleKeys,
  endAllRoles,
  removeImportedRoles,
  rolesOf,
  type HeldRole,
  type RoleScope,
} from './infrastructure/assignments.js';
export {
  addAssignment,
  addGrant,
  addSelfGrants,
  createRole,
  currentOwners,
  endAssignment,
  heldPermissions,
  holdersAt,
  listAssignments,
  listRoles,
  removeGrant,
  renameRole,
  roleById,
  type Assignment,
  type RoleRow,
} from './infrastructure/roles.js';
