import { describe, expect, it } from 'vitest';
import { coverage, monthOf, nextYearMonth, planEditable } from './syllabus.js';

describe('coverage', () => {
  const units = [
    { id: 'a', plannedMonth: '2026-06-01' },
    { id: 'b', plannedMonth: '2026-07-01' },
    { id: 'c', plannedMonth: '2026-12-01' },
    { id: 'd', plannedMonth: null },
  ];
  it('counts expected units up to this month and flags a section behind', () => {
    expect(coverage(units, new Set(['a']), '2026-07-15')).toEqual({
      total: 4,
      done: 1,
      expected: 2,
      behind: true,
      percent: 25,
    });
    expect(coverage(units, new Set(['a', 'b', 'd']), '2026-07-15')).toMatchObject({
      behind: false,
      percent: 75,
    });
  });
  it('is never behind with nothing planned, and 0% of nothing', () => {
    expect(coverage([], new Set(), '2026-07-15')).toMatchObject({
      total: 0,
      percent: 0,
      behind: false,
    });
  });
});

describe('dates', () => {
  it('reads months, moves them a year, and keeps plans editable until the next day', () => {
    expect(monthOf('2026-07-15')).toBe('2026-07-01');
    expect(nextYearMonth('2026-07-01')).toBe('2027-07-01');
    expect(nextYearMonth(null)).toBeNull();
    expect(planEditable('2026-07-15', '2026-07-16')).toBe(true);
    expect(planEditable('2026-07-15', '2026-07-17')).toBe(false);
  });
});
