// Roles and access on screen (decision 0020): owners build roles from the catalogue, a sensitive
// permission waits for a second owner, and assignments carry a scope and dates.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import {
  addAssignment,
  addGrant,
  addSelfGrants,
  createRole as insertRole,
  currentOwners,
  endAssignment as closeAssignment,
  heldPermissions,
  listAssignments,
  listRoles,
  removeGrant,
  renameRole as updateRoleName,
  roleById,
  type Actor,
  type Assignment,
  type RoleRow,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  LOCKED_ROLES,
  isSensitive,
  planGrants,
  roleKey,
  type GrantPlan,
} from '../domain/catalogue.js';

type Permissions = ReturnType<typeof createPermissions>;

export const ROLE_CHANGED = 'platform.role.changed.v1';
export const ACCESS_CHANGED = 'platform.access.changed.v1';

export class AccessError extends Error {
  constructor(
    readonly code:
      | 'locked'
      | 'unknown_permission'
      | 'not_held'
      | 'not_found'
      | 'own_request'
      | 'not_alone'
      | 'last_owner'
      | 'decided'
      | 'reason'
      | 'name'
      | 'not_sensitive'
      | 'not_staff',
    readonly permissions: string[] = [],
  ) {
    super(`access: ${code}`);
    this.name = 'AccessError';
  }
}

export type GrantRequest = {
  id: string;
  roleId: string;
  roleName: string;
  permission: string;
  requestedBy: string;
  requestedAt: string;
  decision: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
};

const org = (actor: Actor) => ({ orgId: actor.orgId });

async function requests(tx: Tx, openOnly: boolean): Promise<GrantRequest[]> {
  return [
    ...(await tx.execute<GrantRequest>(sql`
      select q.id::text, q.role_id::text as "roleId", r.name as "roleName", q.permission,
        q.requested_by_person_id::text as "requestedBy", q.requested_at::text as "requestedAt",
        q.decision, q.decided_by_person_id::text as "decidedBy", q.decided_at::text as "decidedAt", q.reason
      from role_grant_request q join role r on r.org_id = q.org_id and r.id = q.role_id
      where q.org_id = app_current_org() and (${!openOnly} or q.decision is null)
      order by q.requested_at desc limit 100`)),
  ];
}

export type AccessOverview = {
  roles: (RoleRow & { locked: boolean; pending: string[] })[];
  requests: GrantRequest[];
  owners: string[];
};

/** Every role with its permissions and holders, and grant requests (open first). */
export async function accessOverview(
  db: Db,
  permissions: Permissions,
  actor: Actor,
): Promise<AccessOverview> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'platform.role.read', org(actor));
    const all = await requests(tx, false);
    const open = all.filter((r) => r.decision === null);
    return {
      roles: (await listRoles(tx)).map((r) => ({
        ...r,
        locked: LOCKED_ROLES.has(r.key),
        pending: open.filter((q) => q.roleId === r.id).map((q) => q.permission),
      })),
      requests: all,
      owners: await currentOwners(tx),
    };
  });
}

/** A new role, empty or copied from another role (its ordinary and sensitive grants alike go through planning). */
export async function createRole(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { name: string; copyFrom?: string | null },
): Promise<{ roleId: string; plan: GrantPlan }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new AccessError('name');
  return command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.manage', resource: org(actor) },
    async (tx) => {
      const roles = await listRoles(tx);
      if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase()))
        throw new AccessError('name');
      const key = roleKey(name, new Set(roles.map((r) => r.key)));
      const roleId = await insertRole(tx, key, name);
      await addSelfGrants(tx, roleId);
      const source = input.copyFrom ? roles.find((r) => r.id === input.copyFrom) : undefined;
      const plan = source
        ? await applyGrants(tx, actor, { id: roleId, key, permissions: [] }, source.permissions)
        : { add: [], request: [], remove: [] };
      return {
        result: { roleId, plan },
        audit: {
          action: 'platform.role.create',
          entityType: 'role',
          entityId: roleId,
          dataClass: 'operational',
          detail: {
            key,
            copiedFrom: source?.key ?? null,
            added: plan.add.length,
            requested: plan.request.length,
          },
        },
        events: [{ type: ROLE_CHANGED, payload: { roleId } }],
      };
    },
  );
}

export async function renameRole(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  roleId: string,
  name: string,
): Promise<void> {
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new AccessError('name');
  await command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.manage', resource: org(actor) },
    async (tx) => {
      const role = await roleById(tx, roleId);
      if (!role) throw new AccessError('not_found');
      if (LOCKED_ROLES.has(role.key)) throw new AccessError('locked');
      await updateRoleName(tx, roleId, clean);
      return {
        result: undefined,
        audit: {
          action: 'platform.role.rename',
          entityType: 'role',
          entityId: roleId,
          dataClass: 'operational',
          detail: { key: role.key },
        },
        events: [{ type: ROLE_CHANGED, payload: { roleId } }],
      };
    },
  );
}

/** Sets a role's permissions: ordinary ones now, sensitive ones as requests, removals at once. */
export async function setRolePermissions(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  roleId: string,
  wanted: string[],
): Promise<GrantPlan> {
  return command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.manage', resource: org(actor) },
    async (tx) => {
      const role = await roleById(tx, roleId);
      if (!role) throw new AccessError('not_found');
      const plan = await applyGrants(tx, actor, role, wanted);
      return {
        result: plan,
        audit: {
          action: 'platform.role.set_permissions',
          entityType: 'role',
          entityId: roleId,
          dataClass: 'operational',
          detail: {
            key: role.key,
            added: plan.add.join(' '),
            requested: plan.request.join(' '),
            removed: plan.remove.join(' '),
          },
        },
        events: [{ type: ROLE_CHANGED, payload: { roleId } }],
      };
    },
  );
}

async function applyGrants(
  tx: Tx,
  actor: Actor,
  role: Pick<RoleRow, 'id' | 'key' | 'permissions'>,
  wanted: string[],
): Promise<GrantPlan> {
  const open = (await requests(tx, true)).filter((q) => q.roleId === role.id);
  const result = planGrants({
    roleKey: role.key,
    current: role.permissions,
    pending: open.map((q) => q.permission),
    wanted,
    actorHolds: await heldPermissions(tx, actor.personId),
  });
  if (!result.ok) throw new AccessError(result.error, result.permissions);
  const { plan } = result;
  for (const p of plan.add) await addGrant(tx, role.id, p);
  for (const p of plan.remove) await removeGrant(tx, role.id, p);
  // A request is withdrawn when the owner unticks it before anyone decides.
  for (const q of open.filter((q) => !wanted.includes(q.permission)))
    await tx.execute(sql`
      update role_grant_request set decision = 'withdrawn', decided_by_person_id = ${actor.personId}, decided_at = now()
      where org_id = app_current_org() and id = ${q.id}`);
  for (const p of plan.request)
    await tx.execute(sql`
      insert into role_grant_request (org_id, role_id, permission, requested_by_person_id)
      values (app_current_org(), ${role.id}, ${p}, ${actor.personId})`);
  return plan;
}

/**
 * Another owner approves or rejects a waiting grant. With only one owner in the organisation,
 * that owner may confirm their own request alone; it is recorded as such.
 */
export async function decideGrant(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  requestId: string,
  input: { decision: 'approved' | 'rejected' | 'confirmed_alone'; reason?: string | null },
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.approve', resource: org(actor) },
    async (tx) => {
      const [q] = await tx.execute<{
        role_id: string;
        permission: string;
        requested_by: string;
        decision: string | null;
      }>(sql`
      select role_id::text, permission, requested_by_person_id::text as requested_by, decision
      from role_grant_request where org_id = app_current_org() and id = ${requestId} for update`);
      if (!q) throw new AccessError('not_found');
      if (q.decision) throw new AccessError('decided');
      const own = q.requested_by === actor.personId;
      if (input.decision === 'approved' && own) throw new AccessError('own_request');
      if (input.decision === 'confirmed_alone') {
        if (!own) throw new AccessError('not_found');
        if ((await currentOwners(tx)).length > 1) throw new AccessError('not_alone');
      }
      if (input.decision === 'rejected' && !input.reason?.trim()) throw new AccessError('reason');
      await tx.execute(sql`
      update role_grant_request set decision = ${input.decision}, decided_by_person_id = ${actor.personId},
        decided_at = now(), reason = ${input.reason?.trim() || null}
      where org_id = app_current_org() and id = ${requestId}`);
      if (input.decision !== 'rejected') await addGrant(tx, q.role_id, q.permission);
      return {
        result: undefined,
        audit: {
          action: `platform.role.${input.decision === 'rejected' ? 'reject_grant' : input.decision === 'approved' ? 'approve_grant' : 'confirm_grant_alone'}`,
          entityType: 'role',
          entityId: q.role_id,
          dataClass: 'operational',
          ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
          detail: { permission: q.permission, requestId, requestedBy: q.requested_by },
        },
        events: [{ type: ROLE_CHANGED, payload: { roleId: q.role_id } }],
      };
    },
  );
}

export type ScopeInput = { type: 'organisation' | 'campus' | 'institution'; id: string };

/** Who holds which role where, current and upcoming. */
export async function accessOf(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  personId?: string,
): Promise<Assignment[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'platform.role.read', org(actor));
    return listAssignments(tx, personId);
  });
}

export async function assignAccess(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    personId: string;
    roleId: string;
    scope: ScopeInput;
    from: string;
    until: string | null;
  },
): Promise<string> {
  return command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.assign', resource: org(actor) },
    async (tx) => {
      const role = await roleById(tx, input.roleId);
      if (!role || role.key === 'parent') throw new AccessError('not_found');
      // Nobody hands out more than they hold themselves.
      const held = await heldPermissions(tx, actor.personId);
      const notHeld = role.permissions.filter((p) => !held.has(p));
      if (notHeld.length) throw new AccessError('not_held', notHeld);
      const scope =
        input.scope.type === 'organisation'
          ? { type: 'organisation' as const, id: actor.orgId }
          : input.scope;
      const id = await addAssignment(tx, {
        personId: input.personId,
        roleId: role.id,
        scopeType: scope.type,
        scopeId: scope.id,
        from: input.from,
        until: input.until,
      });
      return {
        result: id,
        audit: {
          action: 'platform.access.assign',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'operational',
          detail: {
            role: role.key,
            scopeType: scope.type,
            scopeId: scope.id,
            from: input.from,
            until: input.until,
            sensitive: role.permissions.some(isSensitive),
          },
        },
        events: [{ type: ACCESS_CHANGED, payload: { personId: input.personId, roleId: role.id } }],
      };
    },
  );
}

/** Ends an assignment after the given day. The organisation always keeps at least one owner. */
export async function endAccess(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  assignmentId: string,
  lastDay: string,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: 'platform.role.assign', resource: org(actor) },
    async (tx) => {
      const [a] = (await listAssignments(tx)).filter((x) => x.id === assignmentId);
      if (!a) throw new AccessError('not_found');
      if (a.roleKey === 'owner') {
        const owners = await currentOwners(tx);
        if (owners.length <= 1 && owners.includes(a.personId)) throw new AccessError('last_owner');
      }
      await closeAssignment(tx, assignmentId, lastDay);
      return {
        result: undefined,
        audit: {
          action: 'platform.access.end',
          entityType: 'person',
          entityId: a.personId,
          dataClass: 'operational',
          detail: { role: a.roleKey, scopeType: a.scopeType, scopeId: a.scopeId, lastDay },
        },
        events: [{ type: ACCESS_CHANGED, payload: { personId: a.personId, roleId: a.roleId } }],
      };
    },
  );
}
