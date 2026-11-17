import { describe, expect, it } from 'vitest';
import { dueProblem, nextSchoolDay } from './homework.js';

describe('homework dates', () => {
  it('takes a due date from today to 60 days ahead', () => {
    expect(dueProblem('2026-11-09', '2026-11-09')).toBeNull();
    expect(dueProblem('2026-11-09', '2026-11-08')).toBe('due_in_past');
    expect(dueProblem('2026-11-09', '2027-01-08')).toBeNull();
    expect(dueProblem('2026-11-09', '2027-01-09')).toBe('due_too_far');
  });

  it('defaults to the next school day, past Sundays and holidays', () => {
    // Saturday 14 Nov 2026 -> Sunday skipped -> Monday 16 is a holiday -> Tuesday 17.
    expect(nextSchoolDay('2026-11-14', (d) => d === '2026-11-16')).toBe('2026-11-17');
    expect(nextSchoolDay('2026-11-09', () => false)).toBe('2026-11-10');
  });
});
