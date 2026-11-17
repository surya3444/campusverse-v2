// OBE attainment, pure (rule book §13.2 OBE › Attainment: "direct from tagged items; … targets and
// weights"). A CO's direct attainment comes from the share of students achieving the target share
// of the marks of the items tagged to it; POs and PSOs come only from CO attainment through the
// CO–PO/PSO matrix, held to the same target level, so they can never disagree (§17 defect 1).

export type Settings = {
  targetPercent: number;
  level1Percent: number;
  level2Percent: number;
  level3Percent: number;
  cieWeight: number;
  targetLevel: number;
};

export type StudentMarks = {
  cie: number | null;
  see: number | null;
  absent: boolean;
  scores: (number | null)[];
};

export type Side = { achieved: number; of: number; percent: number; level: number };
export type CoResult = { cie: Side | null; see: Side | null; level: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The attainment level (0–3) for the share of students who achieved the target. */
export function levelOf(percent: number, s: Settings): number {
  return percent >= s.level3Percent
    ? 3
    : percent >= s.level2Percent
      ? 2
      : percent >= s.level1Percent
        ? 1
        : 0;
}

function side(results: boolean[], s: Settings): Side | null {
  if (results.length === 0) return null;
  const achieved = results.filter(Boolean).length;
  const percent = round2((achieved * 100) / results.length);
  return { achieved, of: results.length, percent, level: levelOf(percent, s) };
}

/**
 * A CO's direct attainment from its tagged items: `see` (the end exam; absent counts as not
 * achieved), `cie` (the whole internal mark) or `cie:N` (one internal component). Students with
 * no mark for a side are left out of it. Both sides tagged: weighted by `cieWeight`.
 */
export function coAttainment(input: {
  items: string[];
  plan: { maxMarks: number }[] | null;
  cieMax: number;
  rows: StudentMarks[];
  settings: Settings;
}): CoResult {
  const { items, plan, cieMax, rows, settings: s } = input;
  const seeMax = 100 - cieMax;
  const target = s.targetPercent / 100;
  const parts = items.filter((i) => i.startsWith('cie:')).map((i) => Number(i.slice(4)));
  const cieResults = items.includes('cie')
    ? rows.filter((r) => r.cie !== null).map((r) => (r.cie ?? 0) / cieMax >= target)
    : parts.length && plan
      ? rows
          .filter((r) => parts.every((p) => r.scores[p] !== null && r.scores[p] !== undefined))
          .map(
            (r) =>
              parts.reduce((n, p) => n + (r.scores[p] ?? 0), 0) /
                parts.reduce((n, p) => n + (plan[p]?.maxMarks ?? 0), 0) >=
              target,
          )
      : [];
  const seeResults = items.includes('see')
    ? rows
        .filter((r) => r.absent || r.see !== null)
        .map((r) => !r.absent && (r.see ?? 0) / seeMax >= target)
    : [];
  const cie = side(cieResults, s);
  const see = side(seeResults, s);
  const level =
    cie && see
      ? round2((s.cieWeight * cie.level + (100 - s.cieWeight) * see.level) / 100)
      : (cie?.level ?? see?.level ?? null);
  return { cie, see, level };
}

/**
 * PO and PSO attainment: for each outcome, the CO levels weighted by their matrix levels
 * (Σ CO level × mapping ÷ Σ mapping). COs without a level (nothing tagged, no marks) are left out.
 */
export function outcomeAttainment(
  cos: { level: number | null; mappings: { outcomeId: string; level: number }[] }[],
): Map<string, { value: number; cos: number }> {
  const sums = new Map<string, { weighted: number; weights: number; cos: number }>();
  for (const co of cos) {
    if (co.level === null) continue;
    for (const m of co.mappings) {
      const x = sums.get(m.outcomeId) ?? { weighted: 0, weights: 0, cos: 0 };
      sums.set(m.outcomeId, {
        weighted: x.weighted + co.level * m.level,
        weights: x.weights + m.level,
        cos: x.cos + 1,
      });
    }
  }
  return new Map(
    [...sums].map(([id, x]) => [id, { value: round2(x.weighted / x.weights), cos: x.cos }]),
  );
}
