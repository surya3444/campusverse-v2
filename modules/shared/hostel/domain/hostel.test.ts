import { describe, expect, it } from 'vitest';
import { endOfStay, fitsHostel, isOverdue, outpassProblem } from './hostel.js';

describe('fitsHostel', () => {
  it('matches boys and girls, and lets unrecorded gender anywhere', () => {
    expect(fitsHostel('boys', 'male')).toBe(true);
    expect(fitsHostel('boys', 'female')).toBe(false);
    expect(fitsHostel('girls', 'male')).toBe(false);
    expect(fitsHostel('girls', null)).toBe(true);
    expect(fitsHostel('boys', 'not_stated')).toBe(true);
    expect(fitsHostel('mixed', 'female')).toBe(true);
  });
});

describe('endOfStay', () => {
  it('ends today, or tomorrow for someone who only came today', () => {
    expect(endOfStay('2026-06-01', '2026-11-10')).toBe('2026-11-10');
    expect(endOfStay('2026-11-10', '2026-11-10')).toBe('2026-11-11');
  });
});

describe('outpasses', () => {
  it('not in the past, back on or after leaving', () => {
    expect(outpassProblem('2026-11-10', '2026-11-12', '2026-11-10')).toBeNull();
    expect(outpassProblem('2026-11-09', '2026-11-12', '2026-11-10')).toBe('past_date');
    expect(outpassProblem('2026-11-12', '2026-11-11', '2026-11-10')).toBe('back_before_leaving');
  });
  it('is overdue only when out past the back-by day', () => {
    expect(isOverdue('out', '2026-11-09', '2026-11-10')).toBe(true);
    expect(isOverdue('out', '2026-11-10', '2026-11-10')).toBe(false);
    expect(isOverdue('returned', '2026-11-01', '2026-11-10')).toBe(false);
  });
});
