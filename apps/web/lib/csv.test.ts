import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes, keeps numbers and blanks, and defuses formulas', () => {
    expect(
      toCsv(
        ['Name', 'Amount'],
        [
          ['Rao, Anita', 1500],
          ['Says "hi"', null],
          ['=HYPERLINK("x")', 0],
          ['-5 dues', undefined],
          ['ಕವ್ಯ', 2],
        ],
      ),
    ).toBe(
      [
        'Name,Amount',
        '"Rao, Anita",1500',
        '"Says ""hi""",',
        `"'=HYPERLINK(""x"")",0`,
        "'-5 dues,",
        'ಕವ್ಯ,2',
      ].join('\r\n'),
    );
  });
});

describe('parseCsv', () => {
  it('reads quoted cells, tabs, CRLF and a BOM, and skips blank lines', () => {
    expect(parseCsv('\uFEFFa, b\r\n\r\n"Rao, Anita","say ""hi"""\nx\ty\n')).toEqual([
      ['a', 'b'],
      ['Rao, Anita', 'say "hi"'],
      ['x', 'y'],
    ]);
  });
  it('reads back what toCsv writes', () => {
    const rows = [['ADM-1', 'Route 3, East', 'both', 'Stop "A"']];
    expect(parseCsv(toCsv(['h1', 'h2', 'h3', 'h4'], rows)).slice(1)).toEqual(rows);
  });
});
