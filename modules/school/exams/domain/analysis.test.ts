import { describe, expect, it } from 'vitest';
import { paperStats, toppers } from './analysis.js';

const grade = (bp: number) => (bp >= 9100 ? 'A1' : bp >= 3300 ? 'C' : 'E');

describe('paperStats', () => {
  it('averages entered marks in basis points, counts absentees, and applies the pass mark', () => {
    const s = paperStats(
      '80',
      [
        { value: '72', code: null },
        { value: '40.5', code: null },
        { value: '20', code: null },
        { value: null, code: 'AB' },
        { value: null, code: 'EX' },
        { value: null, code: null },
      ],
      3300,
      grade,
    );
    expect(s).toEqual({
      entered: 4, // three marks and the absentee (exempt doesn't count; blank isn't entered)
      absent: 1,
      blank: 1,
      // (72 + 40.5 + 20 + 0) / 4 = 33.125 of 80 → 41.40% (down to whole basis points)
      averageBp: 4140,
      highest: '72',
      lowest: '0',
      passed: 2,
      passRateBp: 5000,
      grades: { C: 2, E: 2 }, // 72 of 80 is 90%: below the 91% A1 band
    });
  });

  it('says nothing about a paper with no marks yet', () => {
    expect(paperStats('100', [{ value: null, code: null }], 3300, grade)).toMatchObject({
      entered: 0,
      averageBp: null,
      highest: null,
      passRateBp: null,
    });
  });
});

describe('toppers', () => {
  it('ranks students with every subject counted, ties sharing a place', () => {
    expect(
      toppers(
        [
          { studentId: 'a', percentBp: 9000, complete: true },
          { studentId: 'b', percentBp: 9500, complete: true },
          { studentId: 'c', percentBp: 9500, complete: true },
          { studentId: 'd', percentBp: 9900, complete: false },
          { studentId: 'e', percentBp: 8000, complete: true },
        ],
        3,
      ),
    ).toEqual([
      { studentId: 'b', percentBp: 9500, rank: 1 },
      { studentId: 'c', percentBp: 9500, rank: 1 },
      { studentId: 'a', percentBp: 9000, rank: 3 },
    ]);
  });
});
