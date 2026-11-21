import { describe, expect, it } from 'vitest';
import { TEMPLATES, answerFits, weightedScore } from './surveys.js';

describe('survey rules', () => {
  it('checks answers against their questions', () => {
    const [rate] = TEMPLATES.faculty;
    expect(answerFits(rate!, { rating: 4 })).toBe(true);
    expect(answerFits(rate!, { rating: 6 })).toBe(false);
    expect(answerFits(rate!, undefined)).toBe(false);
    const pick = TEMPLATES.exit.find((q) => q.kind === 'choice')!;
    expect(answerFits(pick, { choice: 'Job' })).toBe(true);
    expect(answerFits(pick, { choice: 'Travel' })).toBe(false);
  });
  it('weights each question’s average', () => {
    expect(
      weightedScore([
        { average: 4, weight: 2 },
        { average: 3, weight: 1 },
      ]),
    ).toBe(3.67);
    expect(weightedScore([{ average: null, weight: 1 }])).toBeNull();
  });
  it('every template has at least one rating to score', () => {
    for (const qs of Object.values(TEMPLATES))
      expect(qs.some((q) => q.kind === 'rating')).toBe(true);
  });
});
