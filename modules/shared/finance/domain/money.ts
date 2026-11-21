// Pure money rules. Every amount is an integer number of paise; no floats anywhere. No I/O.

export type Paise = number;

export function assertPaise(n: number, what = 'amount'): Paise {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be whole paise`);
  return n;
}

/**
 * Splits a total into parts by basis-point shares (summing to 10,000), exactly: the parts add up
 * to the total, each within one paisa of its ideal share (largest remainder method).
 */
export function splitByShares(total: Paise, sharesBp: number[]): Paise[] {
  assertPaise(total);
  if (
    sharesBp.reduce((a, b) => a + b, 0) !== 10_000 ||
    sharesBp.some((s) => !Number.isInteger(s) || s < 0)
  ) {
    throw new RangeError('shares must be whole basis points adding up to 10,000');
  }
  const floors = sharesBp.map((s) => Math.floor((total * s) / 10_000));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const byRemainder = sharesBp
    .map((s, i) => ({ i, r: (total * s) % 10_000 }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

export type Line = { headId: string; amount: Paise };

/** Each head's annual amount split across instalments: instalment i gets one line per head. */
export function instalmentLines(lines: Line[], sharesBp: number[]): Line[][] {
  const perHead = lines.map((l) => splitByShares(l.amount, sharesBp));
  return sharesBp.map((_, i) =>
    lines
      .map((l, h) => ({ headId: l.headId, amount: perHead[h]?.[i] ?? 0 }))
      .filter((l) => l.amount > 0),
  );
}

export type Concession =
  { kind: 'percent'; basisPoints: number } | { kind: 'amount'; amount: Paise };

/** A concession on one charge: never more than the charge, percentages rounded down. */
export function concessionOn(charge: Paise, c: Concession): Paise {
  assertPaise(charge);
  const raw =
    c.kind === 'percent'
      ? Math.floor((charge * Math.min(Math.max(c.basisPoints, 0), 10_000)) / 10_000)
      : c.amount;
  return Math.max(0, Math.min(charge, assertPaise(raw)));
}

export type Allocation = { invoiceId: string; amount: Paise };

/**
 * Spreads a payment over invoices in the order given (the school's rule: oldest due first). Each
 * invoice gets at most its balance; whatever is left is a credit, never lost.
 */
export function allocate(
  amount: Paise,
  invoices: { invoiceId: string; balance: Paise }[],
): { allocations: Allocation[]; credit: Paise } {
  assertPaise(amount);
  let left = amount;
  const allocations: Allocation[] = [];
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, inv.balance));
    if (take > 0) {
      allocations.push({ invoiceId: inv.invoiceId, amount: take });
      left -= take;
    }
  }
  return { allocations, credit: left };
}

/**
 * Splits money paid into one invoice between the bodies it is collected for. Outside payees
 * (the university, a board) are filled first, in the order given, up to what they are still owed;
 * the institution (payeeId null) takes the rest. So the institution never spends money it owes on.
 */
export function splitByPayee(
  amount: Paise,
  unpaid: { payeeId: string; unpaid: Paise }[],
): { payeeId: string | null; amount: Paise }[] {
  assertPaise(amount);
  let left = amount;
  const out: { payeeId: string | null; amount: Paise }[] = [];
  for (const u of unpaid) {
    const take = Math.min(left, Math.max(0, u.unpaid));
    if (take > 0) {
      out.push({ payeeId: u.payeeId, amount: take });
      left -= take;
    }
  }
  if (left > 0) out.push({ payeeId: null, amount: left });
  return out;
}

/** The unused share of a charge, by days: rounded down, so a refund never exceeds what is owed back. */
export function prorate(total: Paise, daysUnused: number, daysTotal: number): Paise {
  assertPaise(total);
  if (daysTotal <= 0) return 0;
  const unused = Math.min(Math.max(daysUnused, 0), daysTotal);
  return Math.floor((total * unused) / daysTotal);
}

export type InvoiceState = 'issued' | 'part_paid' | 'paid' | 'overdue';

/** An issued invoice's state from its numbers and dates. Adjusted and written off are set explicitly. */
export function invoiceState(
  total: Paise,
  paid: Paise,
  dueOn: string,
  today: string,
): InvoiceState {
  if (paid >= total) return 'paid';
  if (dueOn < today) return 'overdue';
  return paid > 0 ? 'part_paid' : 'issued';
}

/** Indian financial year of a date: April to March, as "2026-27". Receipts are numbered per year. */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "₹1,23,456.50": Indian grouping, always two decimals, from paise without floating point. */
export function rupees(paise: Paise): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest ? `${rest},` : ''}${last3}.${String(abs % 100).padStart(2, '0')}`;
}

export type AgeBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';

/** Dues ageing by days past the due date. */
export function ageBucket(daysOverdue: number): AgeBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  if (daysOverdue <= 90) return '61_90';
  return '90_plus';
}
