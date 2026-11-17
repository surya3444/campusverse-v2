// A term's results, pure (rule book §13.2 Exams & Results: "SGPA/CGPA (UGC 10-point)"). Grades
// come from packages/rules on the credits pack's scale.
import { courseGrade, gradePointAverage, type GradingRules } from '@campusverse/rules';

export type Mark = { cie: number | null; see: number | null; absent: boolean };
export type CourseInfo = { courseId: string; code: string; title: string; credits: number };

export type StudentResult = {
  studentId: string;
  courses: (CourseInfo & {
    cie: number | null;
    see: number | null;
    absent: boolean;
    total: number;
    grade: string;
    point: number;
    passed: boolean;
  })[];
  credits: number;
  creditsEarned: number;
  sgpa: number | null;
  cgpa: number | null;
};

/** Marks are complete for a student and course: internal entered, and the end exam or absent. */
export const complete = (m: Mark | undefined) =>
  !!m && m.cie !== null && (m.absent || m.see !== null);

/**
 * Every student's grades for the term, SGPA over the term's credits, and CGPA with the credits and
 * points of earlier published terms. Courses without complete marks are left out (and the caller
 * refuses to publish then).
 */
export function termResults(input: {
  students: { studentId: string; courseIds: string[] }[];
  courses: Map<string, CourseInfo>;
  marks: Map<string, Mark>;
  grading: GradingRules;
  earlier: Map<string, { credits: number; point: number }[]>;
}): StudentResult[] {
  return input.students.map((s) => {
    const courses = s.courseIds.flatMap((id) => {
      const c = input.courses.get(id);
      const m = input.marks.get(`${id}:${s.studentId}`);
      if (!c || !m || !complete(m)) return [];
      const g = courseGrade(input.grading, {
        cie: m.cie ?? 0,
        see: m.absent ? 0 : (m.see ?? 0),
        absent: m.absent,
      });
      return [{ ...c, cie: m.cie, see: m.see, absent: m.absent, ...g }];
    });
    const here = courses.map((c) => ({ credits: c.credits, point: c.point }));
    return {
      studentId: s.studentId,
      courses,
      credits: courses.reduce((n, c) => n + c.credits, 0),
      creditsEarned: courses.filter((c) => c.passed).reduce((n, c) => n + c.credits, 0),
      sgpa: gradePointAverage(here),
      cgpa: gradePointAverage([...(input.earlier.get(s.studentId) ?? []), ...here]),
    };
  });
}

/**
 * The internal (CIE) mark from component scores (rule book §13.2 "CIE Plan: weighted components"):
 * each score as a share of its maximum, weighted, scaled to the internal maximum, to two decimals.
 * Null until every component has a score.
 */
export function cieFrom(
  plan: { maxMarks: number; weight: number }[],
  scores: (number | null)[],
  cieMax: number,
): number | null {
  if (scores.length !== plan.length || scores.some((s) => s === null)) return null;
  const share = plan.reduce((n, c, i) => n + (c.weight * (scores[i] ?? 0)) / c.maxMarks, 0) / 100;
  return Math.round(share * cieMax * 100) / 100;
}
