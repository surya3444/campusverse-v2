import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromHundredths, hundredths, result, type Mark, type Paper } from './results.js';

const grade = (bp: number) => (bp >= 9100 ? 'A1' : bp >= 3300 ? 'D' : 'E');
const papers: Paper[] = [
  { paperId: 'eng', subjectId: 'e', subject: 'English', max: '80' },
  { paperId: 'mat', subjectId: 'm', subject: 'Maths', max: '80' },
  { paperId: 'hin', subjectId: 'h', subject: 'Hindi', max: '80' },
];
const marks = (entries: [string, Mark][]) => new Map(entries);

describe('exam results', () => {
  it('a blank is never zero: it is listed and the totals ignore it', () => {
    const r = result(papers, marks([['eng', { value: '72.5', code: null }]]), grade);
    expect(r.blanks).toEqual(['Maths', 'Hindi']);
    expect([r.marks, r.max]).toEqual([7250, 8000]);
  });

  it('absent counts as zero; medical, exempt and not applicable are left out', () => {
    const r = result(
      papers,
      marks([
        ['eng', { value: '80', code: null }],
        ['mat', { value: null, code: 'AB' }],
        ['hin', { value: null, code: 'EX' }],
      ]),
      grade,
    );
    expect(r.blanks).toEqual([]);
    expect([r.marks, r.max, r.percentBp]).toEqual([8000, 16_000, 5000]);
    expect(r.subjects.map((s) => [s.shown, s.grade])).toEqual([
      ['80', 'A1'],
      ['AB', 'E'],
      ['EX', null],
    ]);
  });

  it('percentages round down, so nobody is shown passing a mark they did not reach', () => {
    // 26.39 of 80 is 32.9875%: below 33, so E.
    const r = result([papers[0]!], marks([['eng', { value: '26.39', code: null }]]), grade);
    expect([r.percentBp, r.subjects[0]?.grade]).toEqual([3298, 'E']);
  });

  it('reads and writes marks exactly, in hundredths', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999_999 }), (h) => {
        expect(hundredths(fromHundredths(h))).toBe(h);
      }),
    );
    for (const bad of ['', '-1', '1.234', 'abc', '1e2']) expect(hundredths(bad)).toBeNull();
  });
});
