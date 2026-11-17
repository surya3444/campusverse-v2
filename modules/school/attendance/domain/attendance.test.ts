import { describe, expect, it } from 'vitest';
import {
  attendancePercent,
  conflictsWith,
  daysFromSubmission,
  percentText,
  standing,
  type DayStatus,
} from './attendance.js';

describe('a submission', () => {
  const roster = ['a', 'b', 'c', 'd'];

  it('starts everyone present, shows approved leave, and applies the marks over both', () => {
    const days = daysFromSubmission(
      roster,
      [
        { personId: 'b', status: 'absent' },
        { personId: 'd', status: 'late' },
      ],
      new Map([
        ['c', 'medical_leave'],
        ['d', 'approved_leave'],
      ]),
    );
    expect(days).toEqual(
      new Map([
        ['a', 'present'],
        ['b', 'absent'],
        ['c', 'medical_leave'],
        ['d', 'late'],
      ]),
    );
  });

  it('refuses students not on the roster, students marked twice, and an empty roster', () => {
    expect(daysFromSubmission(roster, [{ personId: 'x', status: 'absent' }], new Map())).toBe(
      'not_on_roster',
    );
    expect(
      daysFromSubmission(
        roster,
        [
          { personId: 'a', status: 'absent' },
          { personId: 'a', status: 'late' },
        ],
        new Map(),
      ),
    ).toBe('marked_twice');
    expect(daysFromSubmission([], [], new Map())).toBe('empty_roster');
  });

  it('a later, different submission yields one conflict per difference', () => {
    const current = new Map<string, DayStatus>([
      ['a', 'present'],
      ['b', 'absent'],
    ]);
    expect(conflictsWith(current, new Map(current))).toEqual([]);
    expect(
      conflictsWith(
        current,
        new Map<string, DayStatus>([
          ['a', 'absent'],
          ['b', 'absent'],
        ]),
      ),
    ).toEqual([{ personId: 'a', current: 'present', incoming: 'absent' }]);
  });
});

describe('attendance percentage', () => {
  it('counts half days as half, skips holidays and rounds down', () => {
    // 3 working days: present, half day, absent → 3 halves of 6 = 50%.
    expect(attendancePercent(['present', 'half_day', 'absent', 'holiday'])).toEqual({
      workingDays: 3,
      attendedHalves: 3,
      basisPoints: 5000,
    });
    // 2 of 3 → 66.666…% → 6666, never rounded up.
    expect(attendancePercent(['present', 'late', 'medical_leave']).basisPoints).toBe(6666);
    expect(attendancePercent(['holiday']).basisPoints).toBeNull();
  });

  it('places a student against the board threshold', () => {
    const rule = { minimumBasisPoints: 7500, warnBelowBasisPoints: 8000 };
    expect(standing(7499, rule)).toBe('short');
    expect(standing(7500, rule)).toBe('warning');
    expect(standing(8000, rule)).toBe('ok');
    expect(standing(null, rule)).toBe('ok');
    expect(percentText(7505)).toBe('75.05');
  });
});
