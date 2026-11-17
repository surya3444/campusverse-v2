import { PACKS } from '@campusverse/rules';
import { describe, expect, it } from 'vitest';
import { reexamGrade, withReexams } from './reexam.js';
import type { StudentResult } from './results.js';

const grading = PACKS['ugc.credits'].builtin.payload.grading!;
const failed = { cie: 30, see: 15, absent: false, total: 45, grade: 'F', point: 0, passed: false };

describe('re-exams', () => {
  it('supplementary: internal marks carry over and the new end exam stands', () => {
    expect(reexamGrade(grading, 'supplementary', failed, { see: 40, absent: false })).toMatchObject(
      {
        see: 40,
        total: 70,
        grade: 'A',
        passed: true,
      },
    );
    expect(
      reexamGrade(grading, 'supplementary', failed, { see: null, absent: true }),
    ).toMatchObject({
      grade: 'F',
      absent: true,
    });
  });

  it('revaluation never lowers a grade', () => {
    const b = { cie: 30, see: 35, absent: false, total: 65, grade: 'B+', point: 7, passed: true };
    expect(reexamGrade(grading, 'revaluation', b, { see: 30, absent: false })).toMatchObject({
      see: 35,
      grade: 'B+',
    });
    expect(reexamGrade(grading, 'revaluation', b, { see: 41, absent: false })).toMatchObject({
      see: 41,
      total: 71,
      grade: 'A',
    });
  });

  it('applies outcomes and works SGPA and CGPA out again only for those students', () => {
    const r = (studentId: string, point: number, sgpa: number, cgpa: number): StudentResult => ({
      studentId,
      courses: [
        {
          courseId: 'c1',
          code: 'C1',
          title: 'One',
          credits: 4,
          cie: 30,
          see: 15,
          absent: false,
          total: 45,
          grade: point ? 'A' : 'F',
          point,
          passed: point > 0,
        },
        {
          courseId: 'c2',
          code: 'C2',
          title: 'Two',
          credits: 4,
          cie: 30,
          see: 40,
          absent: false,
          total: 70,
          grade: 'A',
          point: 8,
          passed: true,
        },
      ],
      credits: 8,
      creditsEarned: point ? 8 : 4,
      sgpa,
      cgpa,
    });
    const terms = [
      { term: 2, students: [r('s1', 8, 8, 8), r('s2', 8, 8, 8)] },
      { term: 1, students: [r('s1', 0, 4, 4), r('s2', 8, 8, 8)] },
    ];
    const out = withReexams(terms, [
      {
        term: 1,
        studentId: 's1',
        courseId: 'c1',
        see: 40,
        absent: false,
        total: 70,
        grade: 'A',
        point: 8,
        passed: true,
      },
    ]);
    expect(out.map((t) => t.term)).toEqual([1, 2]);
    expect(out[0]!.students[0]).toMatchObject({ creditsEarned: 8, sgpa: 8, cgpa: 8 });
    expect(out[1]!.students[0]).toMatchObject({ sgpa: 8, cgpa: 8 });
    expect(out[0]!.students[1]).toBe(terms[1]!.students[1]); // untouched student: frozen figures
  });
});
