import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  finalResult,
  fromHundredths,
  hundredths,
  result,
  suggestRemark,
  type Mark,
  type Paper,
} from './results.js';

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

describe('a subject split into parts', () => {
  const split = [
    { paperId: 'sci-t', subjectId: 'sci', subject: 'Science', max: '80', part: 'Theory' },
    { paperId: 'sci-p', subjectId: 'sci', subject: 'Science', max: '20', part: 'Practical' },
  ];
  it('adds up the parts against their maximums', () => {
    const r = result(
      split,
      marks([
        ['sci-t', { value: '62', code: null }],
        ['sci-p', { value: '18.5', code: null }],
      ]),
      grade,
    );
    expect(r.subjects).toMatchObject([
      {
        subject: 'Science',
        marks: 8050,
        max: 10000,
        shown: '80.5',
        percentBp: 8050,
        parts: [
          { part: 'Theory', shown: '62', max: 8000 },
          { part: 'Practical', shown: '18.5', max: 2000 },
        ],
      },
    ]);
  });
  it('leaves out an exempt part, counts an absent one as zero, and lists a blank part', () => {
    const exempt = result(
      split,
      marks([
        ['sci-t', { value: '60', code: null }],
        ['sci-p', { value: null, code: 'EX' }],
      ]),
      grade,
    );
    expect(exempt.subjects[0]).toMatchObject({ marks: 6000, max: 8000, percentBp: 7500 });
    const absent = result(
      split,
      marks([
        ['sci-t', { value: '60', code: null }],
        ['sci-p', { value: null, code: 'AB' }],
      ]),
      grade,
    );
    expect(absent.subjects[0]).toMatchObject({ marks: 6000, max: 10000, percentBp: 6000 });
    const blank = result(split, marks([['sci-t', { value: '60', code: null }]]), grade);
    expect(blank.blanks).toEqual(['Science · Practical']);
  });
});

describe('the final result', () => {
  const pt = { weightBp: 1000, subjects: [{ subjectId: 'm', subject: 'Maths', percentBp: 9000 }] };
  const half = {
    weightBp: 3000,
    subjects: [
      { subjectId: 'm', subject: 'Maths', percentBp: 7000 },
      { subjectId: 'e', subject: 'English', percentBp: 8000 },
    ],
  };
  const annual = {
    weightBp: 6000,
    subjects: [
      { subjectId: 'm', subject: 'Maths', percentBp: 8000 },
      { subjectId: 'e', subject: 'English', percentBp: null },
    ],
  };
  it('weights each subject over the exams that count it, and averages the subjects', () => {
    const r = finalResult([pt, half, annual], grade);
    // Maths: (90×10 + 70×30 + 80×60) / 100 = 78; English only counts in the half-yearly: 80.
    expect(r.subjects.map((s) => [s.subject, s.byExam, s.percentBp])).toEqual([
      ['Maths', [9000, 7000, 8000], 7800],
      ['English', [null, 8000, null], 8000],
    ]);
    expect(r.percentBp).toBe(7900);
  });
});

describe('a suggested remark', () => {
  it('names strengths and the subject to work on, from marks and attendance', () => {
    expect(
      suggestRemark({
        firstName: 'Asha',
        subjects: [
          { subject: 'Maths', percentBp: 9200 },
          { subject: 'Hindi', percentBp: 5400 },
          { subject: 'English', percentBp: 7600 },
        ],
        attendanceBp: 7000,
      }),
    ).toBe(
      'Asha has done well, with strong work in Maths. More practice in Hindi will help. Attendance needs to improve.',
    );
    expect(
      suggestRemark({
        firstName: 'Ravi',
        subjects: [{ subject: 'Maths', percentBp: null }],
        attendanceBp: null,
      }),
    ).toBeNull();
  });
});
