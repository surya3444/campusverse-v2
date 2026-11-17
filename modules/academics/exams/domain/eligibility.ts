// Exam eligibility (rule book §13.2 Hall Tickets & Eligibility: "Attendance, fee and no-dues
// checks"; §16: "ineligibility notice with reason"), pure. A course may be sat when attendance is
// eligible or condoned (or none was taken); overdue fees hold the whole hall ticket back unless the
// exam office releases it with a reason.
import { MAY_SIT, type Standing } from '@campusverse/academics-attendance';

export type CourseEligibility = {
  courseId: string;
  code: string;
  standing: Standing;
  maySit: boolean;
};
export type Reason =
  { kind: 'attendance'; code: string; standing: Standing } | { kind: 'fees'; overduePaise: number };

export function eligibilityOf(
  courses: { courseId: string; code: string; standing: Standing }[],
  overduePaise: number,
): { courses: CourseEligibility[]; reasons: Reason[]; feesHold: boolean; anyCourse: boolean } {
  const out = courses.map((c) => ({
    ...c,
    // No attendance taken for a course yet: nothing to hold the student back on.
    maySit: MAY_SIT.includes(c.standing) || c.standing === 'no_classes',
  }));
  const reasons: Reason[] = [
    ...out
      .filter((c) => !c.maySit)
      .map((c) => ({ kind: 'attendance' as const, code: c.code, standing: c.standing })),
    ...(overduePaise > 0 ? [{ kind: 'fees' as const, overduePaise }] : []),
  ];
  return {
    courses: out,
    reasons,
    feesHold: overduePaise > 0,
    anyCourse: out.some((c) => c.maySit),
  };
}
