// Mentoring rules (rule book §13.5, docs/specs/MENTORING.md). Pure: no database or HTTP.

export const CONCERNS = ['fine', 'watch', 'concern'] as const;
export type Concern = (typeof CONCERNS)[number];
export const MEETING_STATES = ['scheduled', 'held', 'missed', 'cancelled'] as const;
export type MeetingState = (typeof MEETING_STATES)[number];
export const ESCALATE_TO = ['hod', 'counsellor', 'parent'] as const;
export type EscalateTo = (typeof ESCALATE_TO)[number];

/** A mentee needs a check-in when none was held in this many days. */
export const CHECK_IN_DAYS = 30;

/** A meeting can move only forward from scheduled. */
export function canMove(from: MeetingState, to: MeetingState): boolean {
  return from === 'scheduled' && to !== 'scheduled';
}

/**
 * Mentees per mentor, and how many students have none: what the head of department balances.
 * `loads` are each mentor's current mentee counts.
 */
export function loadSummary(loads: number[], students: number) {
  const assigned = loads.reduce((a, b) => a + b, 0);
  return {
    mentors: loads.length,
    unassigned: Math.max(0, students - assigned),
    // One decimal place, like "1 : 18.5".
    average: loads.length === 0 ? 0 : Math.round((assigned / loads.length) * 10) / 10,
    highest: loads.length === 0 ? 0 : Math.max(...loads),
  };
}

/**
 * Whether a check-in is due: never held, or the last one longer ago than the window. Dates are
 * YYYY-MM-DD calendar days.
 */
export function checkInDue(lastHeld: string | null, today: string, days = CHECK_IN_DAYS): boolean {
  if (!lastHeld) return true;
  const gap = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastHeld}T00:00:00Z`)) / 864e5;
  return gap > days;
}
