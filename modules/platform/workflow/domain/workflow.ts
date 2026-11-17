// The approval engine's rules, pure (rule book §12.4 decision 6): which steps apply to a request,
// and whether a person may decide its current step.

/**
 * Processes that use the engine, with the permission that approves when the designer has set no
 * steps (today's behaviour), and whether steps can depend on an amount.
 */
export const PROCESSES = {
  'expenses.bill': { permission: 'expenses.bill.approve', amounts: true },
  'academics.registration': { permission: 'academics.registration.approve', amounts: false },
  'payroll.settlement': { permission: 'payroll.run.approve', amounts: true },
  'academics.results': { permission: 'academics.exam.publish', amounts: false },
  'academics.reexam': { permission: 'academics.exam.publish', amounts: false },
  'academics.condonation': { permission: 'academics.attendance.condone', amounts: false },
  'staff.leave': { permission: 'staff.leave.approve', amounts: false },
  'finance.refund': { permission: 'finance.refund.approve', amounts: true },
  'communications.notice': { permission: 'communications.notice.approve', amounts: false },
} as const;
export type ProcessKey = keyof typeof PROCESSES;
export const isProcess = (p: string): p is ProcessKey => p in PROCESSES;

/** A step as the designer sets it. */
export type PolicyStep = {
  role: string;
  minAmountPaise: number | null;
  hours: number | null;
  escalateTo: string | null;
};

/** A step as a request carries it. `role` null means anyone with the process's permission. */
export type RequestStep = { role: string | null; hours: number | null; escalateTo: string | null };

const ANYONE: RequestStep = { role: null, hours: null, escalateTo: null };

/**
 * The steps that apply to a request: those without an amount, and those whose amount the request
 * reaches. With none, anyone holding the process's permission decides, so there is always a step.
 */
export function applicableSteps(policy: PolicyStep[], amountPaise: number | null): RequestStep[] {
  const steps = policy
    .filter((s) => s.minAmountPaise === null || (amountPaise ?? -1) >= s.minAmountPaise)
    .map(({ role, hours, escalateTo }) => ({ role, hours, escalateTo }));
  return steps.length ? steps : [ANYONE];
}

export type HeldRole = {
  roleKey: string;
  scopeType: 'organisation' | 'campus' | 'institution';
  scopeId: string;
};
export type Place = { orgId: string; campusId: string; institutionId: string };

const covers = (r: HeldRole, p: Place) =>
  (r.scopeType === 'organisation' && r.scopeId === p.orgId) ||
  (r.scopeType === 'campus' && r.scopeId === p.campusId) ||
  (r.scopeType === 'institution' && r.scopeId === p.institutionId);

export const holdsRoleAt = (roles: HeldRole[], key: string, p: Place) =>
  roles.some((r) => r.roleKey === key && covers(r, p));

export const overdueAt = (step: RequestStep, since: Date): Date | null =>
  step.hours ? new Date(since.getTime() + step.hours * 3_600_000) : null;

/**
 * Whether a person may decide the current step: by the step's role at a scope covering the
 * institution (or the process's permission when the step has no role), or, once the step's
 * timer has run out, by the escalation role.
 */
export function mayDecide(input: {
  step: RequestStep;
  since: Date;
  now: Date;
  roles: HeldRole[];
  place: Place;
  holdsPermission: boolean;
}): { ok: boolean; escalated: boolean } {
  const { step, roles, place } = input;
  if (step.role === null ? input.holdsPermission : holdsRoleAt(roles, step.role, place))
    return { ok: true, escalated: false };
  const due = overdueAt(step, input.since);
  if (due && input.now >= due && step.escalateTo && holdsRoleAt(roles, step.escalateTo, place))
    return { ok: true, escalated: true };
  return { ok: false, escalated: false };
}
