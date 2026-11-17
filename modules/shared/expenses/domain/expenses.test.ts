import { describe, expect, it } from 'vitest';
import { budgetPosition, payProblem, voucherNo } from './expenses.js';

describe('voucherNo', () => {
  it('numbers per year with six digits', () => {
    expect(voucherNo('2026-27', 1)).toBe('PV/2026-27/000001');
    expect(voucherNo('2026-27', 123456)).toBe('PV/2026-27/123456');
  });
});

describe('payProblem', () => {
  const ok = {
    mode: 'cash' as const,
    reference: '',
    paidOn: '2026-11-10',
    billDate: '2026-11-01',
    today: '2026-11-10',
  };
  it('cash needs no reference; everything else does', () => {
    expect(payProblem(ok)).toBeNull();
    expect(payProblem({ ...ok, mode: 'cheque' })).toBe('reference_needed');
    expect(payProblem({ ...ok, mode: 'upi', reference: ' ' })).toBe('reference_needed');
    expect(payProblem({ ...ok, mode: 'bank_transfer', reference: 'UTR123' })).toBeNull();
  });
  it('not before the bill, not in the future', () => {
    expect(payProblem({ ...ok, paidOn: '2026-10-31' })).toBe('paid_before_bill');
    expect(payProblem({ ...ok, paidOn: '2026-11-11' })).toBe('future_date');
  });
});

describe('budgetPosition', () => {
  it('shows what is left after the bill, and flags going over', () => {
    expect(budgetPosition(100_000_00, 60_000_00, 30_000_00)).toEqual({
      budgetPaise: 100_000_00,
      committedPaise: 60_000_00,
      afterPaise: 90_000_00,
      leftPaise: 10_000_00,
      over: false,
    });
    expect(budgetPosition(100_000_00, 90_000_00, 10_000_01)).toMatchObject({
      leftPaise: -1,
      over: true,
    });
  });
  it('without a budget, never over', () => {
    expect(budgetPosition(null, 5, 5)).toMatchObject({
      leftPaise: null,
      over: false,
      afterPaise: 10,
    });
  });
});
