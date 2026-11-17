import { describe, expect, it } from 'vitest';
import { ageCheck, canMove, handover } from './pipeline.js';

const years = (dob: string, on: string) => {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};

describe('the admission pipeline', () => {
  it('allows only the forward moves, and closing needs a reason', () => {
    expect(canMove('enquiry', 'applied', null)).toBeNull();
    expect(canMove('enquiry', 'enrolled', null)).toBe('not_allowed'); // only through Enrol
    expect(canMove('applied', 'rejected', '')).toBe('reason_required');
    expect(canMove('applied', 'rejected', 'Age outside range')).toBeNull();
    expect(canMove('rejected', 'applied', null)).toBe('not_allowed');
    expect(canMove('enrolled', 'withdrawn', 'x')).toBe('not_allowed');
  });

  it('checks age on the cut-off date of the admission year', () => {
    const rule = { minYears: 6, maxYears: 8, cutOff: '03-31' };
    expect(ageCheck(rule, '2021-03-31', '2027-28', years)).toEqual({
      status: 'ok',
      years: 6,
      cutOffDate: '2027-03-31',
    });
    expect(ageCheck(rule, '2021-04-01', '2027-28', years)).toMatchObject({
      status: 'too_young',
      years: 5,
    });
    expect(ageCheck(rule, '2018-01-01', '2027-28', years)).toMatchObject({
      status: 'too_old',
      years: 9,
    });
    expect(ageCheck(null, '2021-01-01', '2027-28', years)).toEqual({ status: 'no_rule' });
    expect(ageCheck(rule, null, '2027-28', years)).toEqual({ status: 'no_date_of_birth' });
  });

  it('lists the handover tasks that apply', () => {
    expect(handover({ documentsPending: true, rte: true, sibling: false })).toEqual([
      'collect_documents',
      'request_rte_concession',
      'send_parent_invite',
      'issue_id_card',
    ]);
  });
});
