import { describe, expect, it } from 'vitest';
import { canMove, checkInDue, loadSummary } from './mentoring.js';

describe('mentoring rules', () => {
  it('moves a meeting only out of scheduled', () => {
    expect(canMove('scheduled', 'held')).toBe(true);
    expect(canMove('scheduled', 'scheduled')).toBe(false);
    expect(canMove('held', 'missed')).toBe(false);
  });
  it('summarises mentor loads and the students left without one', () => {
    expect(loadSummary([18, 19], 40)).toEqual({
      mentors: 2,
      unassigned: 3,
      average: 18.5,
      highest: 19,
    });
    expect(loadSummary([], 12)).toEqual({ mentors: 0, unassigned: 12, average: 0, highest: 0 });
  });
  it('says a check-in is due when never held or past the window', () => {
    expect(checkInDue(null, '2026-11-19')).toBe(true);
    expect(checkInDue('2026-10-20', '2026-11-19')).toBe(false);
    expect(checkInDue('2026-10-19', '2026-11-19')).toBe(true);
  });
});
