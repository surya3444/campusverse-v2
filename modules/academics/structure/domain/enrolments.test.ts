import { describe, expect, it } from 'vitest';
import { isoDate, parseEnrolCsv } from './enrolments.js';

describe('enrolling a batch from a file', () => {
  it('reads dates in Indian and ISO order, and refuses impossible ones', () => {
    expect(isoDate('05/08/2008')).toBe('2008-08-05');
    expect(isoDate('2008-08-05')).toBe('2008-08-05');
    expect(isoDate('31/02/2008')).toBeNull();
    expect(isoDate('soon')).toBeNull();
  });

  it('matches headings loosely and gives each line its problem', () => {
    const r = parseEnrolCsv(
      [
        'Student Name,USN,Section,DOB',
        'Asha Rao,1BM26CS001,a,05/08/2008',
        '"Rao, Vikram",1BM26CS002,B,',
        'X,1BM26CS003,A,',
        'Meera Das,1BM26CS001,A,',
        'Kiran Shah,BAD REG,A,',
        'Nina Paul,1BM26CS006,,',
        'Omar Ali,1BM26CS007,A,31/02/2008',
        '',
      ].join('\n'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.line, l.problem])).toEqual([
      [2, null],
      [3, null],
      [4, 'name_missing'],
      [5, 'register_twice'],
      [6, 'register_invalid'],
      [7, 'section_missing'],
      [8, 'date_invalid'],
    ]);
    expect(r.lines[0]).toMatchObject({ name: 'Asha Rao', section: 'A', dateOfBirth: '2008-08-05' });
    expect(r.lines[1]).toMatchObject({ name: 'Rao, Vikram', section: 'B' });
    expect(parseEnrolCsv('Register,Section\n1,A').ok).toBe(false);
  });
});
