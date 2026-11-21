import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { drawOrder, reproduces, type DrawEntry } from './draw.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const entries: DrawEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  sibling: i % 5 === 0,
  appliedAt: `2026-11-${String(20 - i).padStart(2, '0')}T10:00:00Z`,
}));

describe('drawOrder', () => {
  it('gives the same order for the same seed, whatever order the applicants come in', () => {
    const opts = { method: 'lottery' as const, siblingFirst: false, seed: 'chits-4-17-29' };
    const a = drawOrder(entries, opts, sha);
    expect(drawOrder([...entries].reverse(), opts, sha)).toEqual(a);
    expect(a).toHaveLength(12);
    expect(new Set(a).size).toBe(12);
    // Another seed gives another order.
    expect(drawOrder(entries, { ...opts, seed: 'other' }, sha)).not.toEqual(a);
    expect(reproduces(a, entries, opts, sha)).toBe(true);
    expect(reproduces([...a].reverse(), entries, opts, sha)).toBe(false);
  });

  it('puts siblings first when asked, each group in draw order', () => {
    const opts = { method: 'lottery' as const, siblingFirst: true, seed: 's' };
    const order = drawOrder(entries, opts, sha);
    const siblings = entries.filter((e) => e.sibling).map((e) => e.id);
    expect(new Set(order.slice(0, siblings.length))).toEqual(new Set(siblings));
    const rest = drawOrder(
      entries.filter((e) => !e.sibling),
      { ...opts, siblingFirst: false },
      sha,
    );
    expect(order.slice(siblings.length)).toEqual(rest);
  });

  it('orders first come by when they applied', () => {
    const order = drawOrder(entries, { method: 'first_come', siblingFirst: false, seed: '-' }, sha);
    expect(order[0]).toBe(entries[11]?.id);
    expect(order[11]).toBe(entries[0]?.id);
  });
});
