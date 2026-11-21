// Grievances & Committees rules (rule book §13.11, §15: POSH Act 2013, UGC anti-ragging and
// student grievance regulations). Pure. The day limits are starting points the institution can
// change per committee; counsel confirms them (§15 is not legal advice).

export const COMMITTEE_KINDS = [
  'internal_complaints',
  'anti_ragging',
  'sc_st_cell',
  'grievance_redressal',
  'other',
] as const;
export type CommitteeKind = (typeof COMMITTEE_KINDS)[number];

/**
 * Days to decide a case, by kind: POSH inquiry within 90 days (Act s.11(4)); anti-ragging acted
 * on at once (a week to decide); grievance redressal within 15 days; others 30.
 */
export const DEFAULT_DAYS: Record<CommitteeKind, number> = {
  internal_complaints: 90,
  anti_ragging: 7,
  sc_st_cell: 30,
  grievance_redressal: 15,
  other: 30,
};

/** A decided case can be appealed by whoever raised it within this many days. */
export const APPEAL_DAYS = 30;

export const CASE_STATES = ['received', 'inquiry', 'decided', 'appealed', 'closed'] as const;
export type CaseState = (typeof CASE_STATES)[number];

const NEXT: Record<CaseState, CaseState[]> = {
  received: ['inquiry', 'decided'],
  inquiry: ['decided'],
  decided: ['appealed', 'closed'],
  appealed: ['closed'],
  closed: [],
};
/** Who moves a case: the committee, except an appeal, which only the raiser makes. */
export function canMove(from: CaseState, to: CaseState, by: 'committee' | 'raiser'): boolean {
  if (!NEXT[from].includes(to)) return false;
  return to === 'appealed' ? by === 'raiser' : by === 'committee';
}

/** Overdue: still undecided after the committee's days. Dates YYYY-MM-DD. */
export function overdue(
  state: CaseState,
  receivedOn: string,
  days: number,
  today: string,
): boolean {
  if (state !== 'received' && state !== 'inquiry') return false;
  const gap = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${receivedOn}T00:00:00Z`)) / 864e5;
  return gap > days;
}
