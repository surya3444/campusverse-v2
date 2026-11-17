import { describe, expect, it } from 'vitest';
import { staffCan } from './roles.js';

describe('staff roles', () => {
  it('support can look and ask, but never approve, flip switches or manage staff', () => {
    expect(staffCan('support', 'customers.read')).toBe(true);
    expect(staffCan('support', 'support.request')).toBe(true);
    for (const a of ['approvals.decide', 'switches.set', 'staff.manage', 'plans.manage'] as const)
      expect(staffCan('support', a)).toBe(false);
    expect(staffCan('owner', 'approvals.decide')).toBe(true);
  });
});
