// Privacy & Consent rules (rule book §13.12, §15, §16.5). Pure: no database or HTTP.

/**
 * Purposes a guardian decides one by one (§16.5: "each purpose consented separately"). Health and
 * partner sharing are separate purposes; APAAR is optional with consent (§5, contradiction 7).
 * An organisation may publish notices for other purposes too; these are the ones every school needs.
 */
export const PURPOSES = [
  'health_records',
  'health_partner_sharing',
  'apaar_id',
  'photos_publication',
  'whatsapp_updates',
  'alumni_contact',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export type RequestKind =
  'access' | 'correction' | 'erasure' | 'grievance' | 'nomination' | 'withdraw_consent';
export type RequestState = 'open' | 'in_progress' | 'done' | 'rejected';

/**
 * The internal target for answering a data-rights request. Counsel confirms the statutory period
 * (§15 is not legal advice); this keeps every request on a clock from the day it arrives.
 */
export const REQUEST_TARGET_DAYS = 30;

export const requestDueAt = (receivedAt: Date): Date =>
  new Date(receivedAt.getTime() + REQUEST_TARGET_DAYS * 864e5);

export const isClosed = (s: RequestState) => s === 'done' || s === 'rejected';

export const requestOverdue = (r: { state: RequestState; dueAt: Date }, now: Date) =>
  !isClosed(r.state) && r.dueAt.getTime() < now.getTime();

/** CERT-In Directions (28 Apr 2022): report a cyber incident within 6 hours of noticing it. */
export const CERT_IN_HOURS = 6;

export type CertInStatus = 'reported' | 'due' | 'late';

export function certInStatus(
  b: { discoveredAt: Date; certInReportedAt: Date | null },
  now: Date,
): CertInStatus {
  const deadline = b.discoveredAt.getTime() + CERT_IN_HOURS * 36e5;
  if (b.certInReportedAt) return b.certInReportedAt.getTime() <= deadline ? 'reported' : 'late';
  return now.getTime() <= deadline ? 'due' : 'late';
}

/** Coverage of one purpose: share of students whose latest guardian decision is a grant. */
export const coveragePercent = (granted: number, total: number) =>
  total === 0 ? 0 : Math.floor((granted * 100) / total);
