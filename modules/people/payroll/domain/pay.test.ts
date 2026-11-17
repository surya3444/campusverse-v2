import { payrollRules } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import {
  arrearsFor,
  computeSlip,
  monthBounds,
  professionalTax,
  roundRupee,
  type Salary,
} from './pay.js';

const R = 100;
const salary = (over: Partial<Salary> = {}): Salary => ({
  basic: 20_000 * R,
  da: 0,
  hra: 8_000 * R,
  conveyance: 1_600 * R,
  special: 400 * R,
  other: 0,
  pf: true,
  esi: true,
  pt: true,
  tdsPaise: 0,
  otherDeductionPaise: 0,
  ...over,
});

describe('computeSlip', () => {
  it('a full month: PF capped at the ₹15,000 ceiling, no ESI above ₹21,000, Karnataka PT', () => {
    const s = computeSlip({
      salary: salary(),
      rules: payrollRules('KA'),
      calendarDays: 30,
      lopHalves: 0,
      month: 11,
    });
    expect(s.gross).toBe(30_000 * R);
    expect(s.pf).toBe(1_800 * R);
    expect(s.esi).toBe(0);
    expect(s.pt).toBe(200 * R);
    expect(s.net).toBe((30_000 - 1_800 - 200) * R);
    expect(s.employerPf).toBe(1_800 * R);
  });

  it('prorates every earning by paid days (half days count), rounded to the rupee', () => {
    // 2.5 days' loss of pay in a 30-day month: 27.5 / 30.
    const s = computeSlip({
      salary: salary(),
      rules: payrollRules('KA'),
      calendarDays: 30,
      lopHalves: 5,
      month: 11,
    });
    expect(s.paidHalves).toBe(55);
    expect(s.earnings.basic).toBe(roundRupee(Math.round((20_000 * R * 55) / 60)));
    expect(s.gross).toBe(Object.values(s.earnings).reduce((a: number, b: number) => a + b, 0));
    expect(s.net).toBe(s.gross - s.pf - s.esi - s.pt - s.tds - s.otherDeduction);
  });

  it('ESI on a small salary, rounded up; Telangana PT slab', () => {
    const s = computeSlip({
      salary: salary({
        basic: 12_000 * R,
        hra: 3_000 * R,
        conveyance: 1_000 * R,
        special: 500 * R,
      }),
      rules: payrollRules('TS'),
      calendarDays: 31,
      lopHalves: 0,
      month: 1,
    });
    expect(s.gross).toBe(16_500 * R);
    expect(s.esi).toBe(124 * R); // 0.75% of 16,500 = 123.75 → 124
    expect(s.employerEsi).toBe(537 * R); // 536.25 → 537
    expect(s.pt).toBe(150 * R);
    expect(s.pf).toBe(1_440 * R);
  });

  it('never goes below zero: TDS and the other deduction give way', () => {
    const s = computeSlip({
      salary: salary({ tdsPaise: 50_000 * R, otherDeductionPaise: 1_000 * R }),
      rules: payrollRules('KA'),
      calendarDays: 30,
      lopHalves: 0,
      month: 11,
    });
    expect(s.net).toBe(0);
    expect(s.capped).toBe(true);
    expect(s.otherDeduction).toBe(0);
  });

  it('a whole month of loss of pay pays nothing and deducts nothing', () => {
    const s = computeSlip({
      salary: salary(),
      rules: payrollRules('KA'),
      calendarDays: 30,
      lopHalves: 60,
      month: 11,
    });
    expect(s).toMatchObject({ gross: 0, pf: 0, esi: 0, pt: 0, net: 0 });
  });
});

describe('professional tax', () => {
  it('Karnataka February is ₹300; Tamil Nadu is a sixth of the half-year slab', () => {
    expect(professionalTax(payrollRules('KA').pt, 30_000 * R, 2)).toBe(300 * R);
    expect(professionalTax(payrollRules('KA').pt, 24_999 * R, 11)).toBe(0);
    // ₹8,000 a month = ₹48,000 a half year → ₹930 / 6 = ₹155.
    expect(professionalTax(payrollRules('TN').pt, 8_000 * R, 5)).toBe(155 * R);
    expect(professionalTax(payrollRules(null).pt, 90_000 * R, 5)).toBe(0);
  });
});

describe('monthBounds', () => {
  it('knows leap years', () => {
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29', days: 29 });
    expect(monthBounds('2026-11').days).toBe(30);
  });
});

describe('labour welfare fund and arrears', () => {
  const base = {
    basic: 20_000 * R,
    da: 0,
    hra: 8_000 * R,
    conveyance: 0,
    special: 2_000 * R,
    other: 0,
    pf: true,
    esi: false,
    pt: true,
    tdsPaise: 0,
    otherDeductionPaise: 0,
  };
  it('takes LWF only in the months the state collects it', () => {
    const rules = payrollRules('KA');
    const dec = computeSlip({ salary: base, rules, calendarDays: 31, lopHalves: 0, month: 12 });
    const nov = computeSlip({ salary: base, rules, calendarDays: 30, lopHalves: 0, month: 11 });
    expect([dec.lwf, dec.employerLwf]).toEqual([20 * R, 40 * R]);
    expect([nov.lwf, nov.employerLwf]).toEqual([0, 0]);
    expect(dec.net).toBe(
      dec.gross - dec.pf - dec.esi - dec.pt - dec.lwf - dec.tds - dec.otherDeduction,
    );
  });

  it('pays the difference for an earlier month after a raise, with the PF on it, once', () => {
    const rules = payrollRules('KA');
    const old = computeSlip({ salary: base, rules, calendarDays: 30, lopHalves: 2, month: 9 });
    const raised = { ...base, basic: 22_000 * R };
    const paid = {
      gross: old.gross,
      pf: old.pf,
      employerPf: old.employerPf,
      esi: old.esi,
      employerEsi: old.employerEsi,
    };
    const d = arrearsFor({
      salary: raised,
      rules,
      calendarDays: 30,
      lopHalves: 2,
      month: 9,
      paid,
    })!;
    // Basic for 29 of 30 days, each rounded to the rupee: ₹21,267 − ₹19,333. PF stays capped.
    expect(d.gross).toBe(1_934 * R);
    expect(d.pf).toBe(0);
    // Once that is paid, nothing more is due.
    expect(
      arrearsFor({
        salary: raised,
        rules,
        calendarDays: 30,
        lopHalves: 2,
        month: 9,
        paid: { ...paid, gross: paid.gross + d.gross },
      }),
    ).toBeNull();
    // A cut is never recovered here.
    expect(
      arrearsFor({
        salary: { ...base, basic: 18_000 * R },
        rules,
        calendarDays: 30,
        lopHalves: 2,
        month: 9,
        paid,
      }),
    ).toBeNull();
    const now = computeSlip({
      salary: raised,
      rules,
      calendarDays: 31,
      lopHalves: 0,
      month: 10,
      arrears: d,
    });
    expect(now.arrears).toBe(d.gross);
    expect(now.gross).toBe(
      computeSlip({ salary: raised, rules, calendarDays: 31, lopHalves: 0, month: 10 }).gross +
        d.gross,
    );
  });
});
