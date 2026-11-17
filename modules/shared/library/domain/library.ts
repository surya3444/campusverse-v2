// Library rules with no I/O (docs/specs/LIBRARY.md): due dates, fines, accession numbers.

export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Today plus the loan days; a Sunday moves to Monday. */
export function dueDate(from: string, loanDays: number): string {
  const d = addDays(from, loanDays);
  return isSunday(d) ? addDays(d, 1) : d;
}

/** Days late on the return date, and the fine in paise (never negative). */
export function fineFor(dueOn: string, returnedOn: string, perDayPaise: number) {
  const late = Math.max(0, daysBetween(dueOn, returnedOn));
  return { daysLate: late, finePaise: late * perDayPaise };
}

/**
 * The next `count` accession numbers after the highest one in use: the same prefix and padding,
 * such as ACC-0099 then ACC-0100. With none in use, 1, 2, 3…
 */
export function nextAccessions(existing: string[], count: number): string[] {
  let best: { prefix: string; n: number; width: number } | null = null;
  for (const a of existing) {
    const m = /^(.*?)(\d+)$/.exec(a);
    if (!m) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) best = { prefix: m[1] ?? '', n, width: m[2]?.length ?? 1 };
  }
  const { prefix, n, width } = best ?? { prefix: '', n: 0, width: 1 };
  return Array.from(
    { length: count },
    (_, i) => `${prefix}${String(n + i + 1).padStart(width, '0')}`,
  );
}
