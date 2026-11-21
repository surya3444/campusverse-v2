// Seat draws (rule book §13.1 Merit & Seat Allocation, §16.2). Pure: the hash is passed in.

export type DrawMethod = 'lottery' | 'first_come';
export type DrawEntry = { id: string; sibling: boolean; appliedAt: string };

/**
 * The order of a draw. Lottery: by SHA-256 of `seed:id` (hex), so the same seed and applicants
 * always give the same order and nobody can steer it without changing the recorded seed. First
 * come: by when they applied, then id. With sibling priority, siblings come first, each group in
 * that order.
 */
export function drawOrder(
  entries: DrawEntry[],
  opts: { method: DrawMethod; siblingFirst: boolean; seed: string },
  sha256: (s: string) => string,
): string[] {
  const key = new Map(
    entries.map((e) => [
      e.id,
      opts.method === 'lottery' ? sha256(`${opts.seed}:${e.id}`) : `${e.appliedAt}|${e.id}`,
    ]),
  );
  return [...entries]
    .sort((a, b) => {
      if (opts.siblingFirst && a.sibling !== b.sibling) return a.sibling ? -1 : 1;
      const ka = key.get(a.id) ?? '';
      const kb = key.get(b.id) ?? '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((e) => e.id);
}

/** True when running the draw again from its recorded inputs gives the recorded order. */
export function reproduces(
  recorded: string[],
  entries: DrawEntry[],
  opts: { method: DrawMethod; siblingFirst: boolean; seed: string },
  sha256: (s: string) => string,
): boolean {
  const again = drawOrder(entries, opts, sha256);
  return again.length === recorded.length && again.every((id, i) => id === recorded[i]);
}
