import { describe, expect, it } from 'vitest';
import { missingForUdise, parentName, type UdiseInput } from './udise.js';

const full: UdiseInput = {
  name: 'Synthetic Student',
  gender: 'female',
  dateOfBirth: '2016-04-02',
  classLabel: 'Class 4-A',
  pen: '20230101234',
  apaarStatus: 'present',
  guardians: [{ name: 'Synthetic Mother', relationship: 'mother' }],
};

describe('UDISE+ readiness', () => {
  it('a complete student misses nothing', () => {
    expect(missingForUdise(full)).toEqual([]);
  });

  it('lists what is missing, in fixing order; a refused APAAR is not missing', () => {
    expect(
      missingForUdise({
        ...full,
        gender: 'not_stated',
        dateOfBirth: null,
        pen: null,
        apaarStatus: 'not_generated',
        guardians: [{ name: 'Synthetic Uncle', relationship: 'other' }],
      }),
    ).toEqual(['gender', 'date_of_birth', 'parent_name', 'pen', 'apaar']);
    expect(missingForUdise({ ...full, apaarStatus: 'refused' })).toEqual([]);
  });

  it('finds the father’s, mother’s or guardian’s name', () => {
    expect(parentName(full, 'mother')).toBe('Synthetic Mother');
    expect(parentName(full, 'father')).toBeNull();
  });
});
