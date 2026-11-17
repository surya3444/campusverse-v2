// TDS on salaries (rule book §13.7 "TDS (24Q), Form 16"): the quarter's months, when each month's
// tax had to be deposited, and the 24Q deductee rows linked to the challans that paid them.
import { TDS_SALARY } from '@campusverse/rules';

export type Quarter = 1 | 2 | 3 | 4;

/** The months (YYYY-MM) of a quarter of the financial year starting in April of `fy`. */
export function quarterMonths(fy: number, q: Quarter): string[] {
  return [0, 1, 2].map((i) => {
    const m = 3 + (q - 1) * 3 + i; // April = 3 (0-based)
    return `${fy + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
  });
}

/** The quarter (and its financial year) a date falls in. */
export function quarterOf(date: string): { fy: number; quarter: Quarter } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  return { fy, quarter: (Math.floor(((m + 8) % 12) / 3) + 1) as Quarter };
}

/** The last day to deposit a month's tax: the 7th of the next month; March's by 30 April. */
export function depositDue(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (m === 3) return `${y}-${TDS_SALARY.marchDeposit}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(TDS_SALARY.depositDay).padStart(2, '0')}`;
}

/** When a quarter's 24Q is due. */
export function statementDue(fy: number, q: Quarter): string {
  return `${q >= 3 ? fy + 1 : fy}-${TDS_SALARY.statementDue[q]}`;
}

export type Deduction = { key: string; month: string; tdsPaise: number };
export type Challan = { id: string; month: string; amountPaise: number };

/**
 * Links each deduction to a challan of its month, in order, while the challan has room (24Q
 * lists deductees under the challan that deposited their tax). What no challan covers is
 * returned as unlinked: the tax was deducted but not (yet) recorded as deposited.
 */
export function linkChallans(
  deductions: Deduction[],
  challans: Challan[],
): { links: Map<string, string>; unlinked: Deduction[] } {
  const links = new Map<string, string>();
  const unlinked: Deduction[] = [];
  const room = new Map(challans.map((c) => [c.id, c.amountPaise]));
  for (const d of deductions) {
    // ponytail: one deduction is never split across two challans; split if a school pays one month in parts that small.
    const c = challans.find((x) => x.month === d.month && (room.get(x.id) ?? 0) >= d.tdsPaise);
    if (!c) {
      unlinked.push(d);
      continue;
    }
    room.set(c.id, (room.get(c.id) ?? 0) - d.tdsPaise);
    links.set(d.key, c.id);
  }
  return { links, unlinked };
}

/** Plain CSV: quotes a value with a comma, quote or line break. */
export const csvLine = (values: (string | number | null)[]) =>
  values
    .map((v) => {
      const s = v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');

export const rupeesText = (paise: number) => (paise / 100).toFixed(2);
