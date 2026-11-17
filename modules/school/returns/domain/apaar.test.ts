import { describe, expect, it } from 'vitest';
import { namesAgree, parseApaarCsv } from './apaar.js';

describe('APAAR reconciliation file', () => {
  it('reads the columns in any order and flags malformed numbers', () => {
    const r = parseApaarCsv(
      'Student Name,APAAR ID,PEN\n"Rao, Asha",1234 5678 9012,20230101234\nRavi Kumar,123,20230101235\n',
    );
    expect(r).toEqual({
      ok: true,
      lines: [
        { line: 2, pen: '20230101234', apaar: '123456789012', name: 'Rao, Asha', problem: null },
        { line: 3, pen: '20230101235', apaar: '123', name: 'Ravi Kumar', problem: 'invalid_apaar' },
      ],
    });
    expect(parseApaarCsv('Name,PEN\nX,1')).toEqual({ ok: false, missing: ['apaar'] });
  });

  it('matches names word for word, whatever the order or case', () => {
    expect(namesAgree('ASHA RAO', 'Synthetic Asha Rao')).toBe(true);
    expect(namesAgree('Rao, Asha', 'asha rao')).toBe(true);
    expect(namesAgree('Ravi Kumar', 'Asha Rao')).toBe(false);
    expect(namesAgree('', 'Asha')).toBe(false);
  });
});
