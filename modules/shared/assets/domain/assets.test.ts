import { describe, expect, it } from 'vitest';
import { balanceOf, isLow, nextTags, warrantyEndingSoon } from './assets.js';

describe('nextTags', () => {
  it('continues the highest tag in use, or starts at AST-0001', () => {
    expect(nextTags(['AST-0009', 'AST-0002', 'misc'], 2)).toEqual(['AST-0010', 'AST-0011']);
    expect(nextTags([], 1)).toEqual(['AST-0001']);
    expect(nextTags(['LAB/7'], 1)).toEqual(['LAB/8']);
  });
});

describe('stock', () => {
  it('balances movements and flags low at or under the reorder level', () => {
    expect(
      balanceOf([
        { direction: 'in', quantity: 50 },
        { direction: 'out', quantity: 45 },
      ]),
    ).toBe(5);
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(6, 5)).toBe(false);
    expect(isLow(0, 0)).toBe(false);
  });
});

describe('warrantyEndingSoon', () => {
  it('within 30 days and not already over', () => {
    expect(warrantyEndingSoon('2026-12-01', '2026-11-11')).toBe(true);
    expect(warrantyEndingSoon('2027-01-01', '2026-11-11')).toBe(false);
    expect(warrantyEndingSoon('2026-11-01', '2026-11-11')).toBe(false);
    expect(warrantyEndingSoon(null, '2026-11-11')).toBe(false);
  });
});
