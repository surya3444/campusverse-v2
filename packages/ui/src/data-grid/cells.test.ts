import { describe, expect, it } from 'vitest';
import { checkMark, normaliseMark, parseClipboard, pasteTargets } from './cells.js';

describe('checkMark', () => {
  it('accepts blank, codes and numbers within the maximum', () => {
    for (const ok of ['', '  ', '0', '17', '20', '18.5', '18.25', 'ab', 'ML', 'EX']) {
      expect(checkMark(ok, 20)).toBeNull();
    }
  });

  it('flags text, negatives, too many decimals and marks over the maximum', () => {
    expect(checkMark('seventeen', 20)).toBe('not_a_mark');
    expect(checkMark('-1', 20)).toBe('not_a_mark');
    expect(checkMark('18.125', 20)).toBe('too_precise');
    expect(checkMark('21', 20)).toBe('over_max');
    expect(checkMark('20.01', 20)).toBe('over_max');
  });

  it('stores codes upper-case and never turns blank into zero', () => {
    expect(normaliseMark(' ab ')).toBe('AB');
    expect(normaliseMark('')).toBe('');
  });
});

describe('clipboard', () => {
  it('reads an Excel block, ignoring the trailing newline', () => {
    expect(parseClipboard('12\t15\r\n18\t\r\n')).toEqual([
      ['12', '15'],
      ['18', ''],
    ]);
  });

  it('clips a paste to the grid', () => {
    const targets = pasteTargets(
      { row: 2, col: 1 },
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      { rows: 3, cols: 2 },
    );
    expect(targets).toEqual([{ row: 2, col: 1, value: 'a' }]);
  });
});
