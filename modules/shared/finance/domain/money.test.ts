// Money rules, with property-based tests: thousands of random cases per property.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  splitByPayee,
  ageBucket,
  allocate,
  concessionOn,
  financialYear,
  instalmentLines,
  invoiceState,
  prorate,
  rupees,
  splitByShares,
} from './money.js';

const paise = fc.integer({ min: 0, max: 10_000_000_00 });
/** Random basis-point shares adding up to exactly 10,000. */
const shares = fc
  .array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 12 })
  .map((w) => {
    const sum = w.reduce((a, b) => a + b, 0);
    const bp = w.map((x) => Math.floor((x * 10_000) / sum));
    bp[0] = (bp[0] ?? 0) + 10_000 - bp.reduce((a, b) => a + b, 0);
    return bp;
  });

describe('splitting into instalments', () => {
  it('always adds up exactly, each part within a paisa of its share', () => {
    fc.assert(
      fc.property(paise, shares, (total, bp) => {
        const parts = splitByShares(total, bp);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        parts.forEach((p, i) => {
          expect(Number.isInteger(p)).toBe(true);
          expect(Math.abs(p * 10_000 - total * (bp[i] ?? 0))).toBeLessThan(10_000);
        });
      }),
    );
  });

  it('per-head instalment lines add back up to each head and to the plan total', () => {
    fc.assert(
      fc.property(fc.array(paise, { minLength: 1, maxLength: 6 }), shares, (amounts, bp) => {
        const lines = amounts.map((amount, i) => ({ headId: `h${i}`, amount }));
        const split = instalmentLines(lines, bp);
        for (const l of lines) {
          const back = split
            .flat()
            .filter((x) => x.headId === l.headId)
            .reduce((a, b) => a + b.amount, 0);
          expect(back).toBe(l.amount);
        }
      }),
    );
  });

  it('refuses shares that do not add up to 100%, and amounts that are not whole paise', () => {
    expect(() => splitByShares(100, [5000, 4000])).toThrow(/10,000/);
    expect(() => splitByShares(10.5, [10_000])).toThrow(/whole paise/);
  });

  it('a ₹1,000.00 fee in three instalments: 333.34, 333.33, 333.33', () => {
    expect(splitByShares(100_000, [3334, 3333, 3333])).toEqual([33_340, 33_330, 33_330]);
    expect(splitByShares(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
  });
});

describe('allocating a payment', () => {
  const invoices = fc.array(
    fc.record({ invoiceId: fc.uuid(), balance: fc.integer({ min: 0, max: 5_000_000 }) }),
    { maxLength: 8 },
  );
  it('never loses or invents money, and never overpays an invoice', () => {
    fc.assert(
      fc.property(paise, invoices, (amount, list) => {
        const { allocations, credit } = allocate(amount, list);
        expect(allocations.reduce((a, b) => a + b.amount, 0) + credit).toBe(amount);
        expect(credit).toBeGreaterThanOrEqual(0);
        for (const a of allocations) {
          expect(a.amount).toBeGreaterThan(0);
          expect(a.amount).toBeLessThanOrEqual(
            list.find((i) => i.invoiceId === a.invoiceId)?.balance ?? 0,
          );
        }
      }),
    );
  });

  it('pays the oldest first, and only leaves credit once everything is paid', () => {
    expect(
      allocate(15_000, [
        { invoiceId: 'april', balance: 10_000 },
        { invoiceId: 'july', balance: 10_000 },
      ]),
    ).toEqual({
      allocations: [
        { invoiceId: 'april', amount: 10_000 },
        { invoiceId: 'july', amount: 5_000 },
      ],
      credit: 0,
    });
    expect(allocate(25_000, [{ invoiceId: 'april', balance: 10_000 }]).credit).toBe(15_000);
  });
});

describe('splitting a payment by payee', () => {
  it('fills the university first, then the college', () => {
    const owed = [{ payeeId: 'vtu', unpaid: 2_000_000 }];
    expect(splitByPayee(500_000, owed)).toEqual([{ payeeId: 'vtu', amount: 500_000 }]);
    expect(splitByPayee(12_000_000, owed)).toEqual([
      { payeeId: 'vtu', amount: 2_000_000 },
      { payeeId: null, amount: 10_000_000 },
    ]);
    // Already settled (or over-settled after a later concession): all to the college.
    expect(splitByPayee(300, [{ payeeId: 'vtu', unpaid: -50 }])).toEqual([
      { payeeId: null, amount: 300 },
    ]);
  });

  it('never loses or makes up a paisa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 ** 9 }),
        fc.array(fc.integer({ min: -(10 ** 6), max: 10 ** 8 }), { maxLength: 4 }),
        (amount, owed) => {
          const parts = splitByPayee(
            amount,
            owed.map((u, i) => ({ payeeId: `p${i}`, unpaid: u })),
          );
          expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(amount);
          parts.forEach((p) => expect(p.amount).toBeGreaterThan(0));
          parts
            .filter((p) => p.payeeId !== null)
            .forEach((p) =>
              expect(p.amount).toBeLessThanOrEqual(owed[Number(p.payeeId?.slice(1))] ?? 0),
            );
        },
      ),
    );
  });
});

describe('concessions and proration', () => {
  it('a concession is never negative and never more than the charge', () => {
    fc.assert(
      fc.property(paise, fc.integer({ min: -5000, max: 20_000 }), paise, (charge, bp, amount) => {
        for (const c of [
          concessionOn(charge, { kind: 'percent', basisPoints: bp }),
          concessionOn(charge, { kind: 'amount', amount }),
        ]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(charge);
        }
      }),
    );
    expect(concessionOn(33_333, { kind: 'percent', basisPoints: 5000 })).toBe(16_666);
  });

  it('proration stays between zero and the total, and grows with the days unused', () => {
    fc.assert(
      fc.property(
        paise,
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (total, of, used) => {
          const a = prorate(total, used, of);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(total);
          expect(prorate(total, used + 1, of)).toBeGreaterThanOrEqual(a);
        },
      ),
    );
  });
});

describe('dates, states and display', () => {
  it('works out the invoice state from its numbers', () => {
    expect(invoiceState(100, 100, '2026-06-01', '2026-11-05')).toBe('paid');
    expect(invoiceState(100, 40, '2026-12-01', '2026-11-05')).toBe('part_paid');
    expect(invoiceState(100, 40, '2026-06-01', '2026-11-05')).toBe('overdue');
    expect(invoiceState(100, 0, '2026-12-01', '2026-11-05')).toBe('issued');
  });

  it('uses the Indian financial year, April to March', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });

  it('shows rupees with Indian grouping and exact paise', () => {
    expect(rupees(12_345_650)).toBe('₹1,23,456.50');
    expect(rupees(5)).toBe('₹0.05');
    expect(rupees(-150_000)).toBe('-₹1,500.00');
    expect(rupees(100_000_000_00)).toBe('₹10,00,00,000.00'); // ten crore
  });

  it('ages dues into buckets', () => {
    expect([0, 1, 30, 31, 61, 91].map(ageBucket)).toEqual([
      'current',
      '1_30',
      '1_30',
      '31_60',
      '61_90',
      '90_plus',
    ]);
  });
});
