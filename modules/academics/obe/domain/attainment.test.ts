import { describe, expect, it } from 'vitest';
import { coAttainment, levelOf, outcomeAttainment, type Settings } from './attainment.js';

const s: Settings = {
  targetPercent: 60,
  level1Percent: 50,
  level2Percent: 60,
  level3Percent: 70,
  cieWeight: 40,
  targetLevel: 2,
};
const row = (
  cie: number | null,
  see: number | null,
  absent = false,
  scores: (number | null)[] = [],
) => ({
  cie,
  see,
  absent,
  scores,
});

describe('OBE attainment', () => {
  it('levels the share of students who achieved the target', () => {
    expect([49.99, 50, 60, 69.99, 70].map((p) => levelOf(p, s))).toEqual([0, 1, 2, 2, 3]);
  });

  it('weights internal and end-exam attainment; absence counts as not achieved', () => {
    // Internal (out of 40): 30, 20, 26, 25 → 75%, 50%, 65%, 62.5% → 3 of 4 achieve (75%: level 3).
    // End exam (out of 60): 40, absent, 30, 36 → 66.7%, —, 50%, 60% → 2 of 4 achieve (50%: level 1).
    const rows = [row(30, 40), row(20, null, true), row(26, 30), row(25, 36)];
    const r = coAttainment({ items: ['cie', 'see'], plan: null, cieMax: 40, rows, settings: s });
    expect(r.cie).toMatchObject({ achieved: 3, of: 4, level: 3 });
    expect(r.see).toMatchObject({ achieved: 2, of: 4, percent: 50, level: 1 });
    expect(r.level).toBe(1.8); // 0.4 × 3 + 0.6 × 1
  });

  it('measures a CO by its own internal components', () => {
    const plan = [{ maxMarks: 50 }, { maxMarks: 10 }];
    const rows = [
      row(30, null, false, [40, 2]),
      row(30, null, false, [20, 9]),
      row(30, null, false, [30, null]),
    ];
    // Component 0 only: 80%, 40%, 60% → 2 of 3 (66.67%: level 2).
    expect(coAttainment({ items: ['cie:0'], plan, cieMax: 40, rows, settings: s })).toMatchObject({
      cie: { achieved: 2, of: 3, level: 2 },
      see: null,
      level: 2,
    });
    // Both: 42/60, 29/60 → 1 of 2 (the third has no score for component 1).
    expect(
      coAttainment({ items: ['cie:0', 'cie:1'], plan, cieMax: 40, rows, settings: s }).cie,
    ).toMatchObject({
      achieved: 1,
      of: 2,
    });
  });

  it('works POs out from CO levels through the matrix', () => {
    const po = outcomeAttainment([
      {
        level: 3,
        mappings: [
          { outcomeId: 'PO1', level: 3 },
          { outcomeId: 'PO2', level: 1 },
        ],
      },
      { level: 1.8, mappings: [{ outcomeId: 'PO1', level: 2 }] },
      { level: null, mappings: [{ outcomeId: 'PO1', level: 3 }] },
    ]);
    // PO1: (3×3 + 1.8×2) ÷ 5 = 2.52; PO2: 3.
    expect(Object.fromEntries(po)).toEqual({
      PO1: { value: 2.52, cos: 2 },
      PO2: { value: 3, cos: 1 },
    });
  });

  it('never shows COs at target with a PO below it (demo defect 1)', () => {
    // Every CO at or above the target level: every PO they serve is too, whatever the matrix.
    for (let i = 0; i < 200; i++) {
      const cos = Array.from({ length: 1 + (i % 5) }, (_, k) => ({
        level: s.targetLevel + ((i * 7 + k * 3) % 11) / 10,
        mappings: [{ outcomeId: `PO${1 + ((i + k) % 3)}`, level: 1 + ((i + k) % 3) }],
      }));
      for (const [, v] of outcomeAttainment(cos))
        expect(v.value).toBeGreaterThanOrEqual(s.targetLevel);
    }
  });
});
