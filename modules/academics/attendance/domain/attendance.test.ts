import { describe, expect, it } from 'vitest';
import { attendedBasisPoints, standing } from './attendance.js';

const rules = { minimumPercent: 75, condonableFromPercent: 65 };

describe('course attendance', () => {
  it('counts on duty as attended and rounds down', () => {
    expect(attendedBasisPoints(['present', 'on_duty', 'absent'])).toBe(6666);
    expect(attendedBasisPoints([])).toBeNull();
  });

  it('stands against the thresholds; a condonation lifts only a condonable or short case', () => {
    expect(standing(7500, rules, false)).toBe('eligible');
    expect(standing(7499, rules, false)).toBe('condonable');
    expect(standing(6499, rules, false)).toBe('short');
    expect(standing(7000, rules, true)).toBe('condoned');
    expect(standing(null, rules, false)).toBe('no_classes');
  });
});
