// Pure permission evaluation: role, scope, relationship and state. No I/O.

export type ScopeType = 'organisation' | 'campus' | 'institution';
export type GuardianFlag =
  'is_fee_payer' | 'can_pickup' | 'academic_messages' | 'fee_messages' | 'location_access';

export type Grant = {
  permission: string;
  scopeType: ScopeType;
  scopeId: string;
  relation: 'self' | 'guardian' | null;
  guardianFlag: GuardianFlag | null;
};

/** What one person may do in one organisation on one day. Ids and flags only, so safe to cache. */
export type PermissionSnapshot = {
  orgId: string;
  personId: string;
  grants: Grant[];
  /** Active, unrestricted, login-enabled guardian links: student person id → flags switched on. */
  guardianOf: Record<string, GuardianFlag[]>;
  /**
   * Case grants (rule book §10.3): one sensitive permission about one person, for a reason, until
   * `expiresAt`. They allow only that permission about that person, whatever the roles say.
   */
  cases?: { id: string; permission: string; subjectPersonId: string; expiresAt: string }[];
};

export type Resource = {
  orgId: string;
  /** Where the resource sits. An institution always belongs to a campus, so both are given. */
  place?: { campusId: string; institutionId?: string };
  /** The person the action is about, such as the student whose record is read. */
  subjectPersonId?: string;
  /** Module-owned state, such as an open marks window. false denies. */
  stateAllows?: boolean;
};

export type DenyReason =
  'other_tenant' | 'no_grant' | 'out_of_scope' | 'no_relationship' | 'state_closed';

/** `case` names the case grant that allowed it, when no role did. */
export type Decision = { allowed: true; case?: string } | { allowed: false; reason: DenyReason };

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function evaluate(
  s: PermissionSnapshot,
  permission: string,
  r: Resource,
  now: Date = new Date(),
): Decision {
  if (r.orgId !== s.orgId) return deny('other_tenant');
  const byRole = byRoles(s, permission, r);
  if (byRole.allowed || r.stateAllows === false) return byRole;
  const c = s.cases?.find(
    (x) =>
      x.permission === permission &&
      x.subjectPersonId === r.subjectPersonId &&
      new Date(x.expiresAt) > now,
  );
  return c ? { allowed: true, case: c.id } : byRole;
}

function byRoles(s: PermissionSnapshot, permission: string, r: Resource): Decision {
  const grants = s.grants.filter((g) => g.permission === permission);
  if (grants.length === 0) return deny('no_grant');

  const inScope = grants.filter((g) => scopeMatches(g, r));
  if (inScope.length === 0) return deny('out_of_scope');

  if (!inScope.some((g) => relationHolds(s, g, r))) return deny('no_relationship');

  if (r.stateAllows === false) return deny('state_closed');
  return { allowed: true };
}

function scopeMatches(g: Grant, r: Resource): boolean {
  switch (g.scopeType) {
    case 'organisation':
      return g.scopeId === r.orgId;
    case 'campus':
      return g.scopeId === r.place?.campusId;
    case 'institution':
      return g.scopeId === r.place?.institutionId;
  }
}

function relationHolds(s: PermissionSnapshot, g: Grant, r: Resource): boolean {
  if (g.relation === null) return true;
  if (!r.subjectPersonId) return false;
  if (g.relation === 'self') return r.subjectPersonId === s.personId;
  const flags = s.guardianOf[r.subjectPersonId];
  if (!flags) return false;
  return g.guardianFlag === null || flags.includes(g.guardianFlag);
}
