import { PACKS, payrollRules } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import type { Salary } from './pay.js';
import { addWorkingDays, settlementFor } from './settlement.js';

const R = 100;
const salary: Salary = {
  basic: 15_000 * R,
  da: 3_000 * R,
  hra: 6_000 * R,
  conveyance: 0,
  special: 6_000 * R,
  other: 0,
  pf: true,
  esi: false,
  pt: true,
  tdsPaise: 0,
  otherDeductionPaise: 0,
};
const gratuityRules = PACKS['labour.central'].builtin.payload.gratuity!;

describe('final settlement', () => {
  it('falls due two working days after the last day, past Sundays and holidays', () => {
    // Fri 13 Nov 2026 → Sat 14, (Sun 15) → Mon 16.
    expect(addWorkingDays('2026-11-13', 2, new Set())).toBe('2026-11-16');
    expect(addWorkingDays('2026-11-13', 2, new Set(['2026-11-14']))).toBe('2026-11-17');
  });

  it('pays the final month’s days and gratuity on Labour Codes wages', () => {
    const f = settlementFor({
      salary,
      rules: payrollRules('KA'),
      gratuityRules,
      lastDay: '2026-10-15',
      joinedOn: '2019-04-01',
      fixedTerm: false,
      monthPaid: false,
    });
    expect(f.salaryDays).toBe(15);
    expect(f.salaryNetPaise).toBeGreaterThan(0);
    // Gross ₹30,000; basic + DA ₹18,000 is above half, so wages are ₹18,000.
    expect(f.gratuityWagesPaise).toBe(18_000 * R);
    // 7 years 6½ months → 8 years: ₹18,000 × 15 × 8 ÷ 26 = ₹83,076.92 → ₹83,077.
    expect(f).toMatchObject({ serviceMonths: 90, gratuityYears: 8, gratuityPaise: 83_077 * R });
    expect(f.totalPaise).toBe(f.salaryNetPaise + f.gratuityPaise);
  });

  it('adds the wage-rule shortfall to gratuity wages; a paid month isn’t paid twice', () => {
    const lean = { ...salary, basic: 8_000 * R, da: 0, special: 16_000 * R };
    const f = settlementFor({
      salary: lean,
      rules: payrollRules('KA'),
      gratuityRules,
      lastDay: '2026-10-31',
      joinedOn: '2025-09-01',
      fixedTerm: true,
      monthPaid: true,
    });
    // Gross ₹30,000; basic ₹8,000 is ₹7,000 short of half.
    expect(f.gratuityWagesPaise).toBe(15_000 * R);
    expect(f).toMatchObject({ salaryDays: 0, salaryNetPaise: 0, gratuityYears: 1 });
    expect(f.gratuityPaise).toBe(8_654 * R);
    expect(
      settlementFor({
        salary,
        rules: payrollRules('KA'),
        gratuityRules,
        lastDay: '2026-10-31',
        joinedOn: null,
        fixedTerm: false,
        monthPaid: true,
      }).gratuityPaise,
    ).toBe(0);
  });
});
