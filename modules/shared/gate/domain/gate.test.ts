import { describe, expect, it } from 'vitest';
import { collectorCheck, mobile } from './gate.js';

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
