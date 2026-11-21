import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkCode, codeHash, collectorCheck, mobile, pickupCode } from './gate.js';

describe('mobile', () => {
  it('reads what a guard types', () => {
    expect(mobile('98450 12345')).toBe('+919845012345');
    expect(mobile('+91 98450-12345')).toBe('+919845012345');
    expect(mobile('919845012345')).toBe('+919845012345');
    expect(mobile('09845012345')).toBe('+919845012345');
    expect(mobile('5845012345')).toBeNull();
    expect(mobile('984501234')).toBeNull();
    expect(mobile('phone')).toBeNull();
  });
});

describe('collectorCheck', () => {
  const guardians = [
    { personId: 'mum', phones: ['+919000000001'], restricted: false },
    { personId: 'dad', phones: ['+919000000002'], restricted: true },
  ];
  it('lets an unrestricted guardian collect', () => {
    expect(collectorCheck(guardians, { guardianId: 'mum' })).toBe('ok');
  });
  it('never a restricted guardian, picked or typed in as someone else', () => {
    expect(collectorCheck(guardians, { guardianId: 'dad' })).toBe('collector_restricted');
    expect(
      collectorCheck(guardians, { name: 'Uncle', relation: 'Uncle', phone: '+919000000002' }),
    ).toBe('collector_restricted');
  });
  it('someone else with their own phone, but not a stranger posing as a guardian id', () => {
    expect(
      collectorCheck(guardians, { name: 'Aunt', relation: 'Aunt', phone: '+919000000009' }),
    ).toBe('ok');
    expect(collectorCheck(guardians, { guardianId: 'nobody' })).toBe('collector_not_guardian');
  });
});

describe('pick-up codes', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const h = (c: string) => codeHash('pass-1', c, sha);
  it('makes six digits and binds the hash to the pass', () => {
    expect(pickupCode(42)).toBe('000042');
    expect(pickupCode(999_999)).toBe('999999');
    expect(codeHash('pass-2', '123456', sha)).not.toBe(h('123456'));
  });
  it('accepts the right code, refuses a wrong one, locks after five tries', () => {
    const stored = h('482913');
    expect(checkCode(stored, 0, '482 913', h)).toBe('ok');
    expect(checkCode(stored, 0, '000000', h)).toBe('wrong_code');
    expect(checkCode(stored, 0, undefined, h)).toBe('wrong_code');
    expect(checkCode(stored, 5, '482913', h)).toBe('code_locked');
    expect(checkCode(null, 0, undefined, h)).toBe('ok');
  });
});
