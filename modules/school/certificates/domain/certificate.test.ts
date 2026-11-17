import { describe, expect, it } from 'vitest';
import {
  certificateNumber,
  clearance,
  dateFigures,
  dateInWords,
  yearLabelFrom,
} from './certificate.js';

describe('certificates', () => {
  it('numbers per kind and year', () => {
    expect(certificateNumber('tc', '2026-27', 7)).toBe('TC/2026-27/0007');
    expect(yearLabelFrom('2026-04-01')).toBe('2026-27');
    expect(yearLabelFrom('2099-06-01')).toBe('2099-00');
  });

  it('writes dates of birth in words, as a TC prints them', () => {
    expect(dateInWords('2019-03-14')).toBe('Fourteenth March Two Thousand Nineteen');
    expect(dateInWords('2020-12-01')).toBe('First December Two Thousand Twenty');
    expect(dateInWords('2018-07-22')).toBe('Twenty Second July Two Thousand Eighteen');
    expect(dateInWords('2016-01-30')).toBe('Thirtieth January Two Thousand Sixteen');
    expect(dateInWords('1999-10-31')).toBe(
      'Thirty First October One Thousand Nine Hundred Ninety Nine',
    );
    expect(dateFigures('2019-03-04')).toBe('04 Mar 2019');
  });

  it('dues warn up to Class 8 and block above it only when the school says so', () => {
    const base = { workingDays: 100, documentsPending: 0, blockDuesAboveClass8: true };
    expect(clearance({ ...base, duePaise: 500, classSequence: 9 })).toEqual([
      { code: 'dues', duePaise: 500, blocks: false },
    ]);
    expect(clearance({ ...base, duePaise: 500, classSequence: 10 })).toEqual([
      { code: 'dues', duePaise: 500, blocks: true },
    ]);
    expect(
      clearance({ ...base, duePaise: 500, classSequence: 10, blockDuesAboveClass8: false })[0],
    ).toMatchObject({ blocks: false });
    expect(
      clearance({ ...base, duePaise: 0, classSequence: 4, workingDays: 0, documentsPending: 2 }),
    ).toEqual([{ code: 'attendance_incomplete' }, { code: 'documents_pending', count: 2 }]);
  });
});
