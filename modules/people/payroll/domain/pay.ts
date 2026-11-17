// A month's payslip from a salary and loss of pay (docs/specs/PAYROLL.md). Whole paise only;
// rates come from packages/rules. No database, no framework.
import { professionalTax, type PayrollRules } from '@campusverse/rules';

export const EARNINGS = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const;
export type Earning = (typeof EARNINGS)[number];

export type Salary = Record<Earning, number> & {
  pf: boolean;
  esi: boolean;
  pt: boolean;
  tdsPaise: number;
  otherDeductionPaise: number;
};

export type Slip = {
  calendarDays: number;
  lopHalves: number;
  /** Paid days in half days (calendar × 2 − loss of pay). */
  paidHalves: number;
  earnings: Record<Earning, number>;
  gross: number;
  pf: number;
  esi: number;
  pt: number;
  /** The state labour welfare fund, in the months it is collected. */
  lwf: number;
  tds: number;
  otherDeduction: number;
  net: number;
  employerPf: number;
  employerEsi: number;
  employerLwf: number;
  /** Back pay for earlier months after a revision, included in gross. */
  arrears: number;
  /** TDS or the other deduction was reduced so net isn't negative. */
  capped: boolean;
};

/** Half up to the nearest rupee. */
export const roundRupee = (paise: number) => Math.floor((paise + 50) / 100) * 100;
/** Up to the next rupee (ESI). */
export const ceilRupee = (paise: number) => Math.ceil(paise / 100) * 100;
/** x × num ÷ den in whole numbers, rounded half up to the rupee. */
const share = (x: number, num: number, den: number) =>
  roundRupee(Math.floor((x * num * 2 + den) / (2 * den)));

export const monthlyGross = (s: Salary) => EARNINGS.reduce((a, k) => a + s[k], 0);

export { professionalTax };

/** What back pay adds to a slip: the gross difference and the PF and ESI on it. */
export type ArrearsDelta = {
  gross: number;
  pf: number;
  employerPf: number;
  esi: number;
  employerEsi: number;
};
const NO_ARREARS: ArrearsDelta = { gross: 0, pf: 0, employerPf: 0, esi: 0, employerEsi: 0 };

/**
 * Back pay for one earlier month after a back-dated revision: that month recomputed on the salary
 * now in force for it (same days and loss of pay), less what was paid (its slip plus arrears
 * already paid for it). Null when nothing more is due; a reduction is never recovered here.
 */
export function arrearsFor(input: {
  salary: Salary;
  rules: PayrollRules;
  calendarDays: number;
  lopHalves: number;
  month: number;
  paid: ArrearsDelta;
}): ArrearsDelta | null {
  const due = computeSlip({
    salary: { ...input.salary, tdsPaise: 0, otherDeductionPaise: 0 },
    rules: input.rules,
    calendarDays: input.calendarDays,
    lopHalves: input.lopHalves,
    month: input.month,
  });
  const gross = due.gross - input.paid.gross;
  if (gross <= 0) return null;
  const pos = (n: number) => Math.max(0, n);
  return {
    gross,
    pf: pos(due.pf - input.paid.pf),
    employerPf: pos(due.employerPf - input.paid.employerPf),
    esi: pos(due.esi - input.paid.esi),
    employerEsi: pos(due.employerEsi - input.paid.employerEsi),
  };
}

export function computeSlip(input: {
  salary: Salary;
  rules: PayrollRules;
  calendarDays: number;
  /** Loss of pay in half days. */
  lopHalves: number;
  /** 1–12, for a month-specific professional tax and the labour welfare fund. */
  month: number;
  /** Back pay for earlier months (see arrearsFor): added to gross, PF and ESI as computed then. */
  arrears?: ArrearsDelta | undefined;
}): Slip {
  const { salary: s, rules, calendarDays } = input;
  const full = calendarDays * 2;
  const lopHalves = Math.min(Math.max(0, input.lopHalves), full);
  const paidHalves = full - lopHalves;
  const earnings = Object.fromEntries(
    EARNINGS.map((k) => [k, share(s[k], paidHalves, full)]),
  ) as Record<Earning, number>;
  const gross = EARNINGS.reduce((a, k) => a + earnings[k], 0);
  const pfWage = Math.min(earnings.basic + earnings.da, rules.pf.wageCeilingPaise);
  const pf = s.pf ? share(pfWage, rules.pf.rateBp, 10_000) : 0;
  const esiOn = s.esi && monthlyGross(s) <= rules.esi.grossLimitPaise;
  const esi = esiOn ? ceilRupee(Math.ceil((gross * rules.esi.employeeBp) / 10_000)) : 0;
  const employerEsi = esiOn ? ceilRupee(Math.ceil((gross * rules.esi.employerBp) / 10_000)) : 0;
  // Professional tax on the month's own salary; arrears don't move it into another slab.
  const pt = s.pt ? professionalTax(rules.pt, gross, input.month) : 0;
  const lwfOn = !!rules.lwf && rules.lwf.months.includes(input.month);
  const lwf = lwfOn ? (rules.lwf?.employeePaise ?? 0) : 0;
  const a = input.arrears ?? NO_ARREARS;
  const totalGross = gross + a.gross;
  const totalPf = pf + a.pf;
  const totalEsi = esi + a.esi;
  // Statutory first; TDS and the other deduction give way so net is never negative.
  let room = Math.max(0, totalGross - totalPf - totalEsi - pt - lwf);
  const tds = Math.min(s.tdsPaise, room);
  room -= tds;
  const otherDeduction = Math.min(s.otherDeductionPaise, room);
  const net = totalGross - totalPf - totalEsi - pt - lwf - tds - otherDeduction;
  return {
    calendarDays,
    lopHalves,
    paidHalves,
    earnings,
    gross: totalGross,
    pf: totalPf,
    esi: totalEsi,
    pt,
    lwf,
    tds,
    otherDeduction,
    net,
    employerPf: pf + a.employerPf,
    employerEsi: employerEsi + a.employerEsi,
    employerLwf: lwfOn ? (rules.lwf?.employerPaise ?? 0) : 0,
    arrears: a.gross,
    capped: tds < s.tdsPaise || otherDeduction < s.otherDeductionPaise,
  };
}

/** "2026-11" → its first day, last day and number of days. */
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days };
}
