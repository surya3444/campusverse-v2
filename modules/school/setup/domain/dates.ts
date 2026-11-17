// Reads dates as schools type them in Excel. Pure.
//
// Indian files use day/month/year, but some are exported month/day/year. A column is read as a
// whole: a first part above 12 proves day/month, a second part above 12 proves month/day. If the
// column never proves either, day/month is assumed and any date where day and month could swap
// is flagged as ambiguous, never silently guessed.

export type DateResult =
  { iso: string; ambiguous: boolean } | { error: 'not_a_date' | 'mixed_formats' };

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

type Parts = { a: number; b: number; y: number; numeric: true } | { iso: string; numeric: false };

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 February and friends
  return dt.toISOString().slice(0, 10);
}

function split(value: unknown): Parts | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel date cell: already unambiguous. Use the calendar date as written.
    return { iso: value.toISOString().slice(0, 10), numeric: false };
  }
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [, y = '', mo = '', d = ''] = m;
    const iso = valid(+y, +mo, +d);
    return iso ? { iso, numeric: false } : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const [, a = '', b = '', y = ''] = m;
    return { a: +a, b: +b, y: +y, numeric: true };
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(s);
  if (m) {
    const [, d = '', name = '', y = ''] = m;
    const lower = name.toLowerCase();
    const month = MONTHS[lower.slice(0, lower.startsWith('sept') ? 4 : 3)];
    const iso = month ? valid(+y, month, +d) : null;
    return iso ? { iso, numeric: false } : null;
  }
  return null;
}

/** Parses one column of dates together, so the day/month order is decided once per file. */
export function parseDateColumn(values: unknown[]): DateResult[] {
  const parts = values.map(split);
  const numeric = parts.filter((p): p is Extract<Parts, { numeric: true }> => !!p && p.numeric);
  const provesDayMonth = numeric.some((p) => p.a > 12);
  const provesMonthDay = numeric.some((p) => p.b > 12);

  return parts.map((p) => {
    if (!p) return { error: 'not_a_date' };
    if (!p.numeric) return { iso: p.iso, ambiguous: false };
    if (provesDayMonth && provesMonthDay) return { error: 'mixed_formats' };
    const monthFirst = provesMonthDay && !provesDayMonth;
    const iso = monthFirst ? valid(p.y, p.a, p.b) : valid(p.y, p.b, p.a);
    if (!iso) return { error: 'not_a_date' };
    const couldSwap = !provesDayMonth && !provesMonthDay && p.a !== p.b && p.a <= 12 && p.b <= 12;
    return { iso, ambiguous: couldSwap };
  });
}
