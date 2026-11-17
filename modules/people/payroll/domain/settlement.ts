// Final settlement (rule book §13.7 Gratuity & Final Settlement; Labour Codes in force since
// 21 Nov 2025): salary to the last day, gratuity, and the date it falls due — two working days
// after the last working day. Pure; rates come from packages/rules.
import { gratuity, type GratuityRules, type PayrollRules } from '@campusverse/rules';
import { computeSlip, monthBounds, monthlyGross, type Salary } from './pay.js';
import { wageRuleShortfall } from './statutory.js';

/** The date `n` working days after `from`, skipping Sundays and the institution's holidays. */
export function addWorkingDays(from: string, n: number, holidays: ReadonlySet<string>): string {
  const d = new Date(`${from}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && !holidays.has(day)) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export type SettlementFigures = {
  salaryDays: number;
  salaryNetPaise: number;
  gratuityWagesPaise: number;
  serviceMonths: number;
  gratuityYears: number;
  gratuityPaise: number;
  totalPaise: number;
};

/**
 * What a leaver is owed. The final month's days are paid here unless an approved pay run already
 * paid that month. Gratuity wages follow the Labour Codes' wage definition: basic + DA, plus any
 * allowances above half of gross. Without a joining date there is no gratuity to compute.
 */
export function settlementFor(input: {
  salary: Salary;
  rules: PayrollRules;
  gratuityRules: GratuityRules;
  lastDay: string;
  joinedOn: string | null;
  fixedTerm: boolean;
  /** The final month is already in an approved or paid run. */
  monthPaid: boolean;
}): SettlementFigures {
  const { days: calendarDays } = monthBounds(input.lastDay.slice(0, 7));
  const salaryDays = input.monthPaid ? 0 : Number(input.lastDay.slice(8, 10));
  const salaryNetPaise =
    salaryDays === 0
      ? 0
      : computeSlip({
          salary: input.salary,
          rules: input.rules,
          calendarDays,
          lopHalves: (calendarDays - salaryDays) * 2,
          month: Number(input.lastDay.slice(5, 7)),
        }).net;
  const gross = monthlyGross(input.salary);
  const gratuityWagesPaise =
    input.salary.basic +
    input.salary.da +
    wageRuleShortfall({
      basicPaise: input.salary.basic,
      daPaise: input.salary.da,
      grossPaise: gross,
    });
  const g = input.joinedOn
    ? gratuity(input.gratuityRules, {
        monthlyWagesPaise: gratuityWagesPaise,
        joinedOn: input.joinedOn,
        lastDay: input.lastDay,
        fixedTerm: input.fixedTerm,
      })
    : { months: 0, years: 0, amountPaise: 0 };
  return {
    salaryDays,
    salaryNetPaise,
    gratuityWagesPaise,
    serviceMonths: g.months,
    gratuityYears: g.amountPaise > 0 ? g.years : 0,
    gratuityPaise: g.amountPaise,
    totalPaise: salaryNetPaise + g.amountPaise,
  };
}
