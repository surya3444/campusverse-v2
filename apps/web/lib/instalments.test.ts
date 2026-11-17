import { describe, expect, it } from 'vitest';
import { instalmentsFor, splitPaise } from './instalments';

describe('instalmentsFor', () => {
  it('uses the academic year that holds today', () => {
    expect(instalmentsFor('two_terms', '2026-11-13').map((i) => i.dueOn)).toEqual([
      '2026-06-10',
      '2026-11-10',
    ]);
    expect(instalmentsFor('annual', '2027-03-01')[0]?.dueOn).toBe('2026-06-10');
    expect(instalmentsFor('monthly', '2026-06-01').at(-1)?.dueOn).toBe('2027-03-10');
  });
  it('shares always add up to 100%', () => {
    for (const s of ['annual', 'two_terms', 'three_terms', 'monthly'] as const)
      expect(instalmentsFor(s, '2026-07-01').reduce((a, i) => a + i.shareBp, 0)).toBe(10_000);
    expect(instalmentsFor('three_terms', '2026-07-01').map((i) => i.shareBp)).toEqual([
      3334, 3333, 3333,
    ]);
  });
});

describe('splitPaise', () => {
  it('adds up exactly', () => {
    const parts = splitPaise(1_000_001, [3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_001);
  });
});
