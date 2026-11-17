import { describe, expect, it } from 'vitest';
import { depositDue, linkChallans, quarterMonths, quarterOf, statementDue } from './tds.js';

describe('TDS on salaries', () => {
  it('maps quarters of the financial year to months and back', () => {
    expect(quarterMonths(2026, 1)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(quarterMonths(2026, 4)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(quarterOf('2027-02-10')).toEqual({ fy: 2026, quarter: 4 });
    expect(quarterOf('2026-12-31')).toEqual({ fy: 2026, quarter: 3 });
    expect(quarterOf('2026-04-01')).toEqual({ fy: 2026, quarter: 1 });
  });

  it('gives deposit and statement due dates', () => {
    expect(depositDue('2026-06')).toBe('2026-07-07');
    expect(depositDue('2026-12')).toBe('2027-01-07');
    expect(depositDue('2027-03')).toBe('2027-04-30');
    expect(statementDue(2026, 1)).toBe('2026-07-31');
    expect(statementDue(2026, 4)).toBe('2027-05-31');
  });

  it('links deductions to their month’s challans while they have room', () => {
    const { links, unlinked } = linkChallans(
      [
        { key: 'a', month: '2026-06', tdsPaise: 500 },
        { key: 'b', month: '2026-06', tdsPaise: 400 },
        { key: 'c', month: '2026-06', tdsPaise: 300 },
        { key: 'd', month: '2026-05', tdsPaise: 100 },
      ],
      [
        { id: 'x', month: '2026-06', amountPaise: 800 },
        { id: 'y', month: '2026-06', amountPaise: 400 },
      ],
    );
    expect(Object.fromEntries(links)).toEqual({ a: 'x', b: 'y', c: 'x' });
    expect(unlinked.map((d) => d.key)).toEqual(['d']);
  });
});
