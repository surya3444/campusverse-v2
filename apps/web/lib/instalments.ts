// Ready-made instalment schedules for a yearly fee (docs/specs/CONNECTED_SCHOOL.md): due on the
// 10th, in the academic year (June to May) that holds today. Shares are basis points summing to
// 10,000; any remainder goes to the first instalment so the total is exact.

export type Schedule = 'annual' | 'two_terms' | 'three_terms' | 'monthly';
export const SCHEDULES: Schedule[] = ['annual', 'two_terms', 'three_terms', 'monthly'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PLAN: Record<Schedule, { months: number[]; labels: (m: number, i: number) => string }> = {
  annual: { months: [6], labels: () => 'Annual' },
  two_terms: { months: [6, 11], labels: (_m, i) => `Term ${i + 1}` },
  three_terms: { months: [6, 9, 12], labels: (_m, i) => `Term ${i + 1}` },
  monthly: { months: [6, 7, 8, 9, 10, 11, 12, 1, 2, 3], labels: (m) => MONTHS[m - 1] ?? '' },
};

export function instalmentsFor(
  schedule: Schedule,
  today: string,
): { label: string; dueOn: string; shareBp: number }[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const start = m >= 6 ? y : y - 1;
  const { months, labels } = PLAN[schedule];
  const each = Math.floor(10_000 / months.length);
  return months.map((month, i) => ({
    label: labels(month, i),
    dueOn: `${month >= 6 ? start : start + 1}-${String(month).padStart(2, '0')}-10`,
    shareBp: each + (i === 0 ? 10_000 - each * months.length : 0),
  }));
}

/** Each instalment's amount in paise, the remainder on the first, so they add up exactly. */
export function splitPaise(totalPaise: number, shares: number[]): number[] {
  const parts = shares.map((bp) => Math.floor((totalPaise * bp) / 10_000));
  const rest = totalPaise - parts.reduce((a, b) => a + b, 0);
  if (parts.length) parts[0] = (parts[0] ?? 0) + rest;
  return parts;
}
