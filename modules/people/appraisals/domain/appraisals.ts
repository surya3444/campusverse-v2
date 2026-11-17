// Pure rules for appraisals (docs/specs/APPRAISALS.md). Scores in whole numbers; no floats.

export type Weighted = { weight: number; score: number };

/**
 * The weighted average of 1–5 ratings in hundredths, rounded half up: weights 1 and 2 with
 * scores 4 and 3 give (4 + 6) / 3 = 3.333… → 333.
 */
export function weightedScore(ratings: Weighted[]): number {
  const den = ratings.reduce((n, r) => n + r.weight, 0);
  if (den === 0) throw new Error('weightedScore: no weights');
  const num = ratings.reduce((n, r) => n + r.weight * r.score, 0) * 100;
  return Math.floor((2 * num + den) / (2 * den));
}

/** 367 → "3.67", for a numeric column and for showing. */
export const fromHundredths = (h: number) =>
  `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;

/** Every criterion rated exactly once, each 1 to 5. */
export function completeRatings(
  criteria: string[],
  ratings: { criterionId: string; score: number }[],
): boolean {
  const ids = new Set(ratings.map((r) => r.criterionId));
  return (
    ids.size === ratings.length &&
    criteria.length === ratings.length &&
    criteria.every((c) => ids.has(c)) &&
    ratings.every((r) => Number.isInteger(r.score) && r.score >= 1 && r.score <= 5)
  );
}
