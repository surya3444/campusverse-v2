// Pure rules for expenses (docs/specs/EXPENSES.md). Money is integer paise. No I/O.

export const MODES = ['cash', 'bank_transfer', 'cheque', 'upi', 'card'] as const;
export type Mode = (typeof MODES)[number];

/** PV/2026-27/000001: per legal entity and financial year, no gaps. */
export const voucherNo = (financialYear: string, n: number) =>
  `PV/${financialYear}/${String(n).padStart(6, '0')}`;

/** Why a payment can't be recorded, or null. Anything but cash carries a reference. */
export function payProblem(input: {
  mode: Mode;
  reference: string;
  paidOn: string;
  billDate: string;
  today: string;
}): 'reference_needed' | 'paid_before_bill' | 'future_date' | null {
  if (input.mode !== 'cash' && !input.reference.trim()) return 'reference_needed';
  if (input.paidOn > input.today) return 'future_date';
  if (input.paidOn < input.billDate) return 'paid_before_bill';
  return null;
}

export type BudgetPosition = {
  /** Null: no budget set for the category. */
  budgetPaise: number | null;
  /** Approved and paid bills, not counting the one being looked at. */
  committedPaise: number;
  /** After the bill being looked at. */
  afterPaise: number;
  /** What's left after it; negative when over. Null without a budget. */
  leftPaise: number | null;
  over: boolean;
};

export function budgetPosition(
  budgetPaise: number | null,
  committedPaise: number,
  billPaise: number,
): BudgetPosition {
  const afterPaise = committedPaise + billPaise;
  const leftPaise = budgetPaise === null ? null : budgetPaise - afterPaise;
  return {
    budgetPaise,
    committedPaise,
    afterPaise,
    leftPaise,
    over: leftPaise !== null && leftPaise < 0,
  };
}
