// Rupees on screen, paise everywhere else. No floating point: amounts are parsed as text.

/** "₹1,23,456.50" from paise, with Indian digit grouping. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest ? `${rest},` : ''}${last3}.${String(abs % 100).padStart(2, '0')}`;
}

/** Paise from what someone typed ("1,234.5", "₹ 500", "500.05"), or null if it isn't an amount. */
export function parseRupees(input: string): number | null {
  const m = /^\s*₹?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m?.[1]) return null;
  const whole = m[1].replaceAll(',', '');
  if (!/^\d{1,9}$/.test(whole)) return null;
  return Number(whole) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * Rupees short enough for a key-figure strip: "₹20,000", "₹1.2 L", "₹3.45 Cr" (lakh and crore,
 * rounded down so it never overstates). Exact amounts stay in the tables beside it.
 */
export function shortRupees(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100);
  const sign = paise < 0 ? '-' : '';
  const scaled = (size: number, unit: string) =>
    `${sign}₹${(Math.floor((r / size) * 100) / 100).toFixed(2).replace(/\.?0+$/, '')} ${unit}`;
  if (r >= 1_00_00_000) return scaled(1_00_00_000, 'Cr');
  if (r >= 1_00_000) return scaled(1_00_000, 'L');
  return rupees(paise).replace(/\.\d\d$/, '');
}

/** Basis points as "33.34%". */
export const percent = (bp: number) =>
  `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;

const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  );
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tens = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} hundred` : '', r ? tens : ''].filter(Boolean).join(' ');
}

/** Indian words, as on a printed receipt: 1234550 paise → "Rupees Twelve Thousand Three Hundred Forty-five and Fifty Paise Only". */
export function rupeesInWords(paise: number): string {
  const abs = Math.abs(paise);
  let n = Math.floor(abs / 100);
  const parts: string[] = [];
  for (const [size, name] of [
    [1_00_00_000, 'crore'],
    [1_00_000, 'lakh'],
    [1_000, 'thousand'],
  ] as const) {
    const q = Math.floor(n / size);
    if (q) parts.push(`${under1000(q)} ${name}`); // amounts stop below ₹1,000 crore
    n %= size;
  }
  if (n) parts.push(under1000(n));
  if (parts.length === 0) parts.push('zero');
  const p = abs % 100;
  const text = `rupees ${parts.join(' ')}${p ? ` and ${under1000(p)} ${p === 1 ? 'paisa' : 'paise'}` : ''} only`;
  return text
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/-([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`)
    .replace(' And ', ' and ');
}
