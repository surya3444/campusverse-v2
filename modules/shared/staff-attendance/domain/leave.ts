// Staff leave with no I/O (docs/specs/STAFF_LEAVE.md): the leave year, which days a request
// counts, what's left of a type, and a month's payroll inputs. Every figure is a whole or half
// day, kept as a number (halves are exact in binary floating point, so sums never drift).
import type { DayStatus } from './day.js';

/** The leave year (April to March) a date falls in, named by the year it starts. */
export const leaveYear = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1;
};
export const leaveYearRange = (year: number) => ({
  from: `${year}-04-01`,
  to: `${year + 1}-03-31`,
});

/** Every date from..to inclusive (YYYY-MM-DD). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to;) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

/** The working dates in a range: not Sunday, not a holiday. */
export const workingDates = (from: string, to: string, holidays: ReadonlySet<string>) =>
  datesBetween(from, to).filter((d) => !isSunday(d) && !holidays.has(d));

/** Days a request counts: its working dates, or half of its one date. */
export function daysCounted(
  from: string,
  to: string,
  halfDay: boolean,
  holidays: ReadonlySet<string>,
): number {
  const n = workingDates(from, to, holidays).length;
  return halfDay ? n * 0.5 : n;
}

export type LeaveTypeRule = {
  daysPerYear: number | null;
  carryForwardMax: number;
  /** The first leave year the type existed: nothing carries in from before it. */
  sinceYear: number;
};
/** One person's use of one type, by leave year. */
export type LeaveUse = Map<number, { approved: number; pending: number; adjusted: number }>;
export type Balance = {
  year: number;
  /** Null when the type has no limit (loss of pay). */
  allowance: number | null;
  carried: number;
  adjusted: number;
  approved: number;
  pending: number;
  /** What can still be asked for; null when unlimited. */
  left: number | null;
};

/**
 * What's left of a type in a year: this year's days + carried over + adjustments − approved −
 * pending. Carried over = last year's balance, capped and never below zero.
 */
export function balanceOf(type: LeaveTypeRule, use: LeaveUse, year: number): Balance {
  const u = use.get(year) ?? { approved: 0, pending: 0, adjusted: 0 };
  if (type.daysPerYear === null) return { year, allowance: null, carried: 0, ...u, left: null };
  let carried = 0;
  if (year > type.sinceYear && type.carryForwardMax > 0) {
    const prev = balanceOf(type, use, year - 1).left ?? 0;
    carried = Math.min(type.carryForwardMax, Math.max(0, prev));
  }
  return {
    year,
    allowance: type.daysPerYear,
    carried,
    ...u,
    left: type.daysPerYear + carried + u.adjusted - u.approved - u.pending,
  };
}

export type PayrollRow = {
  workingDays: number;
  present: number;
  onDuty: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  notMarked: number;
  lossOfPay: number;
  paidDays: number;
};

/**
 * A month's payroll inputs for one person. `working` = the month's working dates up to today
 * (later ones aren't counted yet); `days` = the register; `leave` = approved leave by date
 * (days 1 or 0.5, paid or not). Loss of pay = unpaid leave + absent + ½ per half day that isn't
 * a half-day leave. Paid days = calendar days − loss of pay.
 */
export function payrollRow(input: {
  calendarDays: number;
  working: string[];
  days: Map<string, DayStatus>;
  leave: Map<string, { days: number; paid: boolean }>;
}): PayrollRow {
  const r: PayrollRow = {
    workingDays: input.working.length,
    present: 0,
    onDuty: 0,
    halfDays: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    absent: 0,
    notMarked: 0,
    lossOfPay: 0,
    paidDays: 0,
  };
  for (const d of input.working) {
    const l = input.leave.get(d);
    const s = input.days.get(d);
    if (l) {
      if (l.paid) r.paidLeave += l.days;
      else r.unpaidLeave += l.days;
      // A half-day leave: the other half is worked.
      if (l.days < 1) r.present += 0.5;
      continue;
    }
    if (s === 'present') r.present += 1;
    else if (s === 'on_duty') r.onDuty += 1;
    else if (s === 'half_day') {
      r.halfDays += 1;
      r.present += 0.5;
    } else if (s === 'absent') r.absent += 1;
    // Nothing marked, or "on leave" with no leave behind it: the office records the leave first.
    else r.notMarked += 1;
  }
  r.lossOfPay = r.unpaidLeave + r.absent + r.halfDays * 0.5;
  r.paidDays = input.calendarDays - r.lossOfPay;
  return r;
}
