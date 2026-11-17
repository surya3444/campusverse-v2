// Re-exams (rule book §13.2 Exams & Results › Re-exams: "revaluation, supplementary"; P0 item 12).
// A re-exam's new end-exam mark is graded on the term's frozen scale; approved outcomes override
// the published grade, and SGPA and CGPA are worked out again for the students they touch. The
// published (frozen) grades themselves never change.
import { courseGrade, gradePointAverage, type GradingRules } from '@campusverse/rules';
import type { StudentResult } from './results.js';

export type ReexamKind = 'revaluation' | 'supplementary';
type Graded = {
  see: number | null;
  absent: boolean;
  total: number;
  grade: string;
  point: number;
  passed: boolean;
};

/**
 * The grade after a re-exam. Supplementary: the internal marks carry over and the new end exam
 * stands. Revaluation: the revalued mark counts only if it does better; a grade never goes down.
 */
export function reexamGrade(
  grading: GradingRules,
  kind: ReexamKind,
  old: { cie: number | null } & Graded,
  next: { see: number | null; absent: boolean },
): Graded {
  const g = courseGrade(grading, {
    cie: old.cie ?? 0,
    see: next.absent ? 0 : (next.see ?? 0),
    absent: next.absent,
  });
  const graded = { see: next.absent ? null : next.see, absent: next.absent, ...g };
  if (
    kind === 'revaluation' &&
    (g.point < old.point || (g.point === old.point && g.total <= old.total))
  )
    return {
      see: old.see,
      absent: old.absent,
      total: old.total,
      grade: old.grade,
      point: old.point,
      passed: old.passed,
    };
  return graded;
}

export type Outcome = { term: number; studentId: string; courseId: string } & Graded;

/**
 * Published terms with approved re-exam outcomes applied (the latest per course wins). Students
 * with an outcome get SGPA and CGPA worked out again across their terms; others keep the frozen ones.
 */
export function withReexams(
  terms: { term: number; students: StudentResult[] }[],
  outcomes: Outcome[],
): { term: number; students: StudentResult[] }[] {
  const touched = new Set(outcomes.map((o) => o.studentId));
  const latest = new Map(outcomes.map((o) => [`${o.term}:${o.studentId}:${o.courseId}`, o]));
  const sorted = [...terms].sort((a, b) => a.term - b.term);
  const history = new Map<string, { credits: number; point: number }[]>();
  return sorted.map((t) => ({
    term: t.term,
    students: t.students.map((s) => {
      if (!touched.has(s.studentId)) return s;
      const courses = s.courses.map((c) => {
        const o = latest.get(`${t.term}:${s.studentId}:${c.courseId}`);
        return o
          ? {
              ...c,
              see: o.see,
              absent: o.absent,
              total: o.total,
              grade: o.grade,
              point: o.point,
              passed: o.passed,
            }
          : c;
      });
      const here = courses.map((c) => ({ credits: c.credits, point: c.point }));
      const all = [...(history.get(s.studentId) ?? []), ...here];
      history.set(s.studentId, all);
      return {
        ...s,
        courses,
        creditsEarned: courses.filter((c) => c.passed).reduce((n, c) => n + c.credits, 0),
        sgpa: gradePointAverage(here),
        cgpa: gradePointAverage(all),
      };
    }),
  }));
}
