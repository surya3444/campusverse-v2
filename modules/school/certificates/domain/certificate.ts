// Pure certificate rules: numbers, dates in words, and the TC's clearance warnings. No I/O.

export const KINDS = ['tc', 'bonafide', 'fee_paid'] as const;
export type Kind = (typeof KINDS)[number];

const PREFIX: Record<Kind, string> = { tc: 'TC', bonafide: 'BC', fee_paid: 'FC' };

/** "TC/2026-27/0001": per institution, by kind and academic year; never reused. */
export const certificateNumber = (kind: Kind, yearLabel: string, n: number) =>
  `${PREFIX[kind]}/${yearLabel}/${String(n).padStart(4, '0')}`;

/** The academic year a date falls in, from the year's first day ("2026-04-01" → "2026-27"). */
export const yearLabelFrom = (yearStarts: string) => {
  const y = Number(yearStarts.slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORDINAL_ONES = [
  '',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
];
const ORDINAL_TENS: Record<number, string> = { 2: 'Twentieth', 3: 'Thirtieth' };
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function yearWords(y: number): string {
  const thousands = Math.floor(y / 1000);
  const hundreds = Math.floor((y % 1000) / 100);
  const rest = y % 100;
  return [
    thousands ? `${ONES[thousands]} Thousand` : '',
    hundreds ? `${ONES[hundreds]} Hundred` : '',
    rest ? under100(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function dayOrdinal(d: number): string {
  if (d < 20) return ORDINAL_ONES[d] ?? '';
  const tens = Math.floor(d / 10);
  return d % 10 ? `${TENS[tens]} ${ORDINAL_ONES[d % 10]}` : (ORDINAL_TENS[tens] ?? '');
}

/** "2019-03-14" → "Fourteenth March Two Thousand Nineteen", as a TC prints the date of birth. */
export function dateInWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${dayOrdinal(d)} ${MONTHS[m - 1]} ${yearWords(y)}`;
}

/** "14 Mar 2019" for printed figures. */
export function dateFigures(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]?.slice(0, 3)} ${y}`;
}

export type Warning =
  | { code: 'dues'; duePaise: number; blocks: boolean }
  | { code: 'attendance_incomplete' }
  | { code: 'documents_pending'; count: number }
  | { code: 'deadline'; dueBy: string };

/**
 * TC clearance: dues are a warning up to Class 8 and, above it, a block only if the school set
 * one (legal advice first). Missing attendance and pending documents are warnings.
 */
export function clearance(input: {
  duePaise: number;
  classSequence: number;
  blockDuesAboveClass8: boolean;
  workingDays: number;
  documentsPending: number;
}): Warning[] {
  const out: Warning[] = [];
  // Class sequence: LKG 0, UKG 1, Class 1 is 2 … Class 8 is 9.
  if (input.duePaise > 0)
    out.push({
      code: 'dues',
      duePaise: input.duePaise,
      blocks: input.blockDuesAboveClass8 && input.classSequence > 9,
    });
  if (input.workingDays === 0) out.push({ code: 'attendance_incomplete' });
  if (input.documentsPending > 0)
    out.push({ code: 'documents_pending', count: input.documentsPending });
  return out;
}
