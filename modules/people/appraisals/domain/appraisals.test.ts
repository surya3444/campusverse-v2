import { describe, expect, it } from 'vitest';
import { completeRatings, fromHundredths, weightedScore } from './appraisals.js';

describe('weightedScore', () => {
  it('averages by weight in hundredths, half up', () => {
    expect(
      weightedScore([
        { weight: 1, score: 4 },
        { weight: 2, score: 3 },
      ]),
    ).toBe(333);
    expect(
      weightedScore([
        { weight: 1, score: 4 },
        { weight: 1, score: 3 },
        { weight: 1, score: 4 },
      ]),
    ).toBe(367);
    expect(
      weightedScore([
        { weight: 1, score: 3 },
        { weight: 1, score: 4 },
      ]),
    ).toBe(350);
    expect(weightedScore([{ weight: 5, score: 5 }])).toBe(500);
    // 2.125 rounds up to 2.13.
    expect(
      weightedScore([
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 2 },
        { weight: 1, score: 3 },
      ]),
    ).toBe(213);
  });
  it('shows hundredths', () => {
    expect(fromHundredths(367)).toBe('3.67');
    expect(fromHundredths(500)).toBe('5.00');
    expect(fromHundredths(105)).toBe('1.05');
  });
});

describe('completeRatings', () => {
  it('needs every criterion rated once, 1 to 5', () => {
    expect(
      completeRatings(
        ['a', 'b'],
        [
          { criterionId: 'a', score: 3 },
          { criterionId: 'b', score: 5 },
        ],
      ),
    ).toBe(true);
    expect(completeRatings(['a', 'b'], [{ criterionId: 'a', score: 3 }])).toBe(false);
    expect(completeRatings(['a'], [{ criterionId: 'a', score: 6 }])).toBe(false);
    expect(
      completeRatings(
        ['a'],
        [
          { criterionId: 'a', score: 3 },
          { criterionId: 'a', score: 4 },
        ],
      ),
    ).toBe(false);
  });
});
