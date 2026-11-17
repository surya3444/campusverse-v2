// Safety checks for staff who work with children. Which checks a role needs follows the CBSE
// and state school-transport safety guidance (police verification of every employee who meets
// children; for drivers a valid licence and medical fitness). The lists are a starting point for
// counsel and the school to confirm, not legal advice.

export const CHECK_KINDS = [
  'police_verification',
  'driving_licence',
  'medical_fitness',
  'psv_badge',
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** Checks each work role needs. Support staff without an app role need police verification. */
export const REQUIRED_CHECKS: Record<string, readonly CheckKind[]> = {
  teacher: ['police_verification'],
  office: ['police_verification'],
  driver: ['driving_licence', 'police_verification', 'medical_fitness'],
  bus_attendant: ['police_verification'],
  security: ['police_verification'],
  warden: ['police_verification'],
  nurse: ['police_verification'],
  support: ['police_verification'],
};

/** Every check the person's roles need, in the order above, without repeats. */
export function requiredChecks(roleKeys: readonly string[]): CheckKind[] {
  const out = new Set<CheckKind>();
  for (const k of roleKeys) for (const c of REQUIRED_CHECKS[k] ?? []) out.add(c);
  return CHECK_KINDS.filter((c) => out.has(c));
}

export type CheckState = 'ok' | 'expiring' | 'expired' | 'missing';
/** A licence that runs out within this many days shows as expiring. */
export const EXPIRING_DAYS = 30;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** The state of the latest check of a kind on a day (dates are ISO, compared as text). */
export function checkState(
  latest: { validUntil: string | null } | undefined,
  today: string,
): CheckState {
  if (!latest) return 'missing';
  if (latest.validUntil === null) return 'ok';
  if (latest.validUntil < today) return 'expired';
  return latest.validUntil <= addDays(today, EXPIRING_DAYS) ? 'expiring' : 'ok';
}

/** Work roles a staff member can be given when added (never administrator or principal). */
export const WORK_ROLES = [
  'teacher',
  'office',
  'driver',
  'bus_attendant',
  'security',
  'warden',
  'nurse',
] as const;
export type WorkRole = (typeof WORK_ROLES)[number];
export type StaffCategory = 'teaching' | 'administrative' | 'support';

/** The category a work role belongs to; no role (housekeeping, cooks) is support. */
export function categoryOf(role: WorkRole | null): StaffCategory {
  if (role === 'teacher') return 'teaching';
  if (role === 'office') return 'administrative';
  return 'support';
}
