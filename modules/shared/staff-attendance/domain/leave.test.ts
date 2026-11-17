import { describe, expect, it } from 'vitest';
import type { DayStatus } from './day.js';
import {
  balanceOf,
  daysCounted,
  leaveYear,
  payrollRow,
  workingDates,
  type LeaveUse,
} from './leave.js';

describe('leave', () => {
  it('runs the leave year April to March', () => {
    expect(leaveYear('2026-04-01')).toBe(2026);
    expect(leaveYear('2027-03-31')).toBe(2026);
    expect(leaveYear('2027-01-15')).toBe(2026);
  });

  it('counts working days only: no Sundays, no holidays, halves for a half day', () => {
    // Mon 9 Nov to Mon 16 Nov 2026: Sunday 15th out, Saturday 14th a holiday.
    const holidays = new Set(['2026-11-14']);
    expect(workingDates('2026-11-09', '2026-11-16', holidays)).toHaveLength(6);
    expect(daysCounted('2026-11-09', '2026-11-16', false, holidays)).toBe(6);
    expect(daysCounted('2026-11-10', '2026-11-10', true, holidays)).toBe(0.5);
    expect(daysCounted('2026-11-15', '2026-11-15', false, holidays)).toBe(0);
  });

  it('carries last year over, capped and never below zero', () => {
    const sick = { daysPerYear: 12, carryForwardMax: 30, sinceYear: 2024 };
    const use: LeaveUse = new Map([
      [2024, { approved: 2, pending: 0, adjusted: 0 }], // 10 left
      [2025, { approved: 1, pending: 0, adjusted: 3 }], // 12 + 10 + 3 - 1 = 24 left
      [2026, { approved: 4, pending: 1.5, adjusted: 0 }],
    ]);
    expect(balanceOf(sick, use, 2026)).toMatchObject({ carried: 24, left: 12 + 24 - 4 - 1.5 });
    const capped = { ...sick, carryForwardMax: 5 };
    expect(balanceOf(capped, use, 2026).carried).toBe(5);
    const casual = { daysPerYear: 12, carryForwardMax: 0, sinceYear: 2024 };
    expect(balanceOf(casual, use, 2026).left).toBe(6.5);
    // Overspent last year (a negative adjustment): nothing negative carries.
    const over: LeaveUse = new Map([[2025, { approved: 12, pending: 0, adjusted: -5 }]]);
    expect(balanceOf({ ...sick, sinceYear: 2025 }, over, 2026).carried).toBe(0);
    expect(
      balanceOf({ daysPerYear: null, carryForwardMax: 0, sinceYear: 2024 }, use, 2026).left,
    ).toBeNull();
  });

  it('works out paid days and loss of pay for a month', () => {
    const working = [
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ];
    const days = new Map<string, DayStatus>([
      ['2026-11-02', 'present'],
      ['2026-11-03', 'half_day'], // half day, no leave: ½ loss of pay
      ['2026-11-04', 'absent'], // 1 loss of pay
      ['2026-11-05', 'on_leave'], // approved paid leave below
      ['2026-11-06', 'half_day'], // a half-day unpaid leave: ½ loss of pay, ½ present
      // 7th: nothing marked
    ]);
    const leave = new Map([
      ['2026-11-05', { days: 1, paid: true }],
      ['2026-11-06', { days: 0.5, paid: false }],
    ]);
    expect(payrollRow({ calendarDays: 30, working, days, leave })).toEqual({
      workingDays: 6,
      present: 2,
      onDuty: 0,
      halfDays: 1,
      paidLeave: 1,
      unpaidLeave: 0.5,
      absent: 1,
      notMarked: 1,
      lossOfPay: 2,
      paidDays: 28,
    });
  });

  it('counts an on-leave mark with no leave behind it as not marked', () => {
    const row = payrollRow({
      calendarDays: 30,
      working: ['2026-11-02'],
      days: new Map([['2026-11-02', 'on_leave']]),
      leave: new Map(),
    });
    expect(row).toMatchObject({ notMarked: 1, lossOfPay: 0, paidDays: 30 });
  });
});
