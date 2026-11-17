import { CREDIT_FRAMEWORKS } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import { batchYears, checkRegulation, ltpCredits, nextStep, parity } from './structure.js';

describe('academic engine rules', () => {
  it('parity follows the term number', () => {
    expect([1, 2, 3, 8].map(parity)).toEqual(['odd', 'even', 'odd', 'even']);
  });

  it('labels a batch by its years', () => {
    expect(batchYears(2025, 8, 'semester')).toBe('2025–29');
    expect(batchYears(2026, 3, 'year')).toBe('2026–29');
    expect(batchYears(2026, 6, 'trimester')).toBe('2026–28');
  });

  it('L-T-P to credits', () => {
    expect(ltpCredits(3, 1, 0)).toBe(4);
    expect(ltpCredits(0, 0, 3)).toBe(1.5);
  });

  it('checks a regulation against its framework', () => {
    const ug3 = CREDIT_FRAMEWORKS.UGC_UG3;
    const full = Array.from({ length: 6 }, (_, i) => ({ termNumber: i + 1, credits: 20 }));
    const ok = checkRegulation(full, 6, null, ug3);
    expect(ok).toMatchObject({ totalCredits: 120, blocking: [], warnings: [] });

    const short = checkRegulation(
      [...full.slice(0, 5), { termNumber: 7, credits: 4 }, { termNumber: 1, credits: 4.5 }],
      6,
      null,
      ug3,
    );
    expect(short.blocking).toEqual(['term_out_of_range']);
    expect(short.termCredits).toEqual([24.5, 20, 20, 20, 20, 0]);
    expect(short.warnings).toEqual([
      { kind: 'term_load', term: 1, credits: 24.5, min: 18, max: 22 },
      { kind: 'term_empty', term: 6 },
      { kind: 'below_minimum', credits: 104.5, minimum: 120 },
      { kind: 'exit_short', term: 6, credits: 104.5, needed: 120, award: 'Bachelor’s degree' },
    ]);

    expect(checkRegulation([], 4, 80, null).blocking).toEqual(['empty']);
  });

  it('a batch opens the next term, then completes', () => {
    expect(nextStep(1, 8)).toEqual({ kind: 'open', term: 2 });
    expect(nextStep(8, 8)).toEqual({ kind: 'complete' });
  });
});
