// Pure rules for assets and stock (docs/specs/ASSETS.md). No I/O.

/** The next free tags after the highest number in use with the commonest prefix: AST-0009 → AST-0010. */
export function nextTags(existing: string[], count: number, fallback = 'AST-'): string[] {
  let best: { prefix: string; n: number; width: number } | null = null;
  for (const tag of existing) {
    const m = /^(.*?)(\d+)$/.exec(tag);
    if (!m) continue;
    const prefix = m[1] ?? '';
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix, n, width: (m[2] ?? '').length };
  }
  const start = best ? best.n + 1 : 1;
  const prefix = best ? best.prefix : fallback;
  const width = best ? best.width : 4;
  return Array.from(
    { length: count },
    (_, i) => `${prefix}${String(start + i).padStart(width, '0')}`,
  );
}

export type Movement = { direction: 'in' | 'out'; quantity: number };
export const balanceOf = (moves: Movement[]) =>
  moves.reduce((b, m) => b + (m.direction === 'in' ? m.quantity : -m.quantity), 0);

/** At or below the reorder level (a level of 0 never flags). */
export const isLow = (balance: number, reorderLevel: number) =>
  reorderLevel > 0 && balance <= reorderLevel;

/** The warranty ends within the next `days` days (and hasn't ended). */
export function warrantyEndingSoon(until: string | null, today: string, days = 30): boolean {
  if (!until || until < today) return false;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return until <= limit.toISOString().slice(0, 10);
}
