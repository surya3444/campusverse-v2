// Pure rules for the hostel (docs/specs/HOSTEL.md). Dates are ISO days. No I/O.

export type HostelKind = 'boys' | 'girls' | 'mixed';

/** A boys' hostel takes male students, a girls' hostel female; unrecorded gender goes anywhere. */
export function fitsHostel(kind: HostelKind, gender: string | null): boolean {
  if (kind === 'mixed' || !gender || gender === 'not_stated' || gender === 'other') return true;
  return kind === 'boys' ? gender === 'male' : gender === 'female';
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Where an allocation ends when the student leaves the bed today: not resident from today, unless
 * they only came today, when the range must keep a day (they leave tomorrow).
 */
export const endOfStay = (from: string, today: string) => (from < today ? today : addDays(from, 1));

export function outpassProblem(
  leavesOn: string,
  backBy: string,
  today: string,
): 'past_date' | 'back_before_leaving' | null {
  if (leavesOn < today) return 'past_date';
  if (backBy < leavesOn) return 'back_before_leaving';
  return null;
}

/** Out, and not back by the end of the back-by day. */
export const isOverdue = (state: string, backBy: string, today: string) =>
  state === 'out' && backBy < today;
