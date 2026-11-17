// Statutory returns from an approved payroll run (rule book §13.7 Payroll › Statutory, §15). Pure.
// EPFO's ECR 2.0 text file: one line per member, fields joined by "#~#", whole rupees:
// UAN, name, gross wages, EPF wages, EPS wages, EDLI wages, EPF contribution (employee),
// EPS contribution, EPF−EPS difference (employer), NCP days, refund of advances.
import type { PayrollRules } from '@campusverse/rules';

export type EcrInput = {
  uan: string;
  name: string;
  basicPaise: number;
  daPaise: number;
  grossPaise: number;
  pfPaise: number;
  employerPfPaise: number;
  lopHalves: number;
};

export type EcrMember = {
  line: string;
  epfWagesPaise: number;
  epsPaise: number;
  differencePaise: number;
  ncpDays: number;
};

const rupees = (paise: number) => String(Math.round(paise / 100));
/** Half up to the rupee, in paise. */
const roundRupee = (paise: number) => Math.floor((paise + 50) / 100) * 100;

/** Names in ECR are plain capitals; the separator never appears inside a field. */
export const ecrName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^A-Za-z .]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

export function ecrMember(m: EcrInput, rules: PayrollRules['pf']): EcrMember {
  // The slip's PF wage: prorated basic + DA, capped at the ceiling (as computeSlip does).
  const epfWages = Math.min(m.basicPaise + m.daPaise, rules.wageCeilingPaise);
  const epsWages = Math.min(epfWages, rules.wageCeilingPaise);
  const eps = Math.min(roundRupee((epsWages * rules.epsBp) / 10_000), m.employerPfPaise);
  const difference = m.employerPfPaise - eps;
  // ponytail: NCP days rounded from half days; check with the payroll adviser whether EPFO wants
  // half days rounded up for the month.
  const ncpDays = Math.round(m.lopHalves / 2);
  const line = [
    m.uan,
    ecrName(m.name),
    rupees(m.grossPaise),
    rupees(epfWages),
    rupees(epsWages),
    rupees(epsWages),
    rupees(m.pfPaise),
    rupees(eps),
    rupees(difference),
    String(ncpDays),
    '0',
  ].join('#~#');
  return { line, epfWagesPaise: epfWages, epsPaise: eps, differencePaise: difference, ncpDays };
}

/**
 * The Labour Codes' wage rule (in force from 21 Nov 2025): allowances left out of "wages" may not
 * exceed half of the total; any excess counts as wages. Returns the shortfall to add, or 0.
 * Shown as a warning on salaries; how PF treats it is for the payroll adviser to confirm.
 */
export function wageRuleShortfall(s: { basicPaise: number; daPaise: number; grossPaise: number }) {
  const wages = s.basicPaise + s.daPaise;
  const half = Math.ceil(s.grossPaise / 2);
  return Math.max(0, half - wages);
}

/** ESIC's monthly contribution upload: the portal's columns, in order. */
export const ESI_HEADER = [
  'IP Number',
  'IP Name',
  'No of Days for which wages paid/payable during the month',
  'Total Monthly Wages',
  'Reason Code for Zero workings days',
  'Last Working Day',
];

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * One member's line in the ESI monthly contribution file: IP number, name, days paid (whole days;
 * a half day of loss of pay costs the day) and the month's wages in whole rupees.
 */
export function esiMember(m: {
  ipNumber: string;
  name: string;
  calendarDays: number;
  lopHalves: number;
  grossPaise: number;
}): string {
  const days = Math.floor((m.calendarDays * 2 - m.lopHalves) / 2);
  const wages = Math.round(m.grossPaise / 100);
  return [m.ipNumber, ecrName(m.name), String(days), String(wages), days === 0 ? '0' : '', '']
    .map(csvCell)
    .join(',');
}
