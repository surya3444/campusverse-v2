// What each Campusverse staff role may do in the admin portal. Pure; no I/O.

export type StaffRole = 'owner' | 'support';

export type StaffAction =
  | 'customers.read'
  | 'customers.create'
  | 'customers.plan'
  | 'customers.status'
  | 'flags.set'
  | 'flags.default'
  | 'switches.set'
  | 'plans.manage'
  | 'support.request'
  | 'approvals.decide'
  | 'health.read'
  | 'audit.read'
  | 'staff.manage'
  | 'incidents.manage'
  /** Rule packs (rule book §15.1): support drafts a new version; an owner releases it. */
  | 'rules.draft'
  | 'rules.release';

const SUPPORT: readonly StaffAction[] = [
  'customers.read',
  'customers.create',
  'customers.status',
  'flags.set',
  'support.request',
  'health.read',
  'audit.read',
  // Whoever is on duty records an incident and its steps; the clocks don't wait for an owner.
  'incidents.manage',
  'rules.draft',
];

/** Owners can do everything; support staff can look, create, and ask (never approve). */
export const staffCan = (role: StaffRole, action: StaffAction): boolean =>
  role === 'owner' || SUPPORT.includes(action);

/** Support access is time-boxed: 15 minutes to 4 hours. */
export const SUPPORT_MINUTES = { min: 15, max: 240 } as const;
