import { PACKS } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import { cieFrom, complete, termResults } from './results.js';

const grading = PACKS['ugc.credits'].builtin.payload.grading!;
const courses = new Map([
  ['c1', { courseId: 'c1', code: 'CS301', title: 'Algorithms', credits: 4 }],
  ['c2', { courseId: 'c2', code: 'CS302', title: 'Databases', credits: 3 }],
  ['e1', { courseId: 'e1', code: 'CS351', title: 'Elective', credits: 3 }],
]);

describe('term results', () => {
  it('grades each course, weights SGPA by credits and carries CGPA from earlier terms', () => {
    const [a] = termResults({
      students: [{ studentId: 's1', courseIds: ['c1', 'c2'] }],
      courses,
      marks: new Map([
        ['c1:s1', { cie: 36, see: 55, absent: false }], // 91 → O 10
        ['c2:s1', { cie: 30, see: 35, absent: false }], // 65 → B+ 7
      ]),
      grading,
      earlier: new Map([['s1', [{ credits: 20, point: 8 }]]]),
    });
    expect(a!.courses.map((c) => [c.code, c.grade])).toEqual([
      ['CS301', 'O'],
      ['CS302', 'B+'],
    ]);
    // (4×10 + 3×7) ÷ 7 = 8.71; with 20 earlier credits at 8: (160 + 61) ÷ 27 = 8.19.
    expect(a).toMatchObject({ credits: 7, creditsEarned: 7, sgpa: 8.71, cgpa: 8.19 });
  });

  it('counts a failed course in the average but not in credits earned', () => {
    const [a] = termResults({
      students: [{ studentId: 's1', courseIds: ['c1', 'e1'] }],
      courses,
      marks: new Map([
        ['c1:s1', { cie: 30, see: 40, absent: false }], // 70 → A 8
        ['e1:s1', { cie: 35, see: null, absent: true }], // absent → F
      ]),
      grading,
      earlier: new Map(),
    });
    expect(a).toMatchObject({ credits: 7, creditsEarned: 4, sgpa: 4.57 });
  });

  it('knows complete marks', () => {
    expect(complete({ cie: 30, see: null, absent: true })).toBe(true);
    expect(complete({ cie: 30, see: null, absent: false })).toBe(false);
    expect(complete(undefined)).toBe(false);
  });

  it('works the internal mark out from weighted components', () => {
    const plan = [
      { maxMarks: 50, weight: 40 },
      { maxMarks: 50, weight: 40 },
      { maxMarks: 10, weight: 20 },
    ];
    // (40×45/50 + 40×30/50 + 20×8/10) ÷ 100 = 0.76 of 40 = 30.4.
    expect(cieFrom(plan, [45, 30, 8], 40)).toBe(30.4);
    expect(cieFrom(plan, [45, null, 8], 40)).toBeNull();
    expect(cieFrom(plan, [50, 50, 10], 40)).toBe(40);
  });
});
