// Course attendance, pure (rule book §13.2 Attendance: "Shortage & Condonation: threshold from
// rule pack, … feeds exam eligibility").
import type { CourseAttendanceRules } from '@campusverse/rules';

export type MarkStatus = 'present' | 'absent' | 'on_duty';
export type Standing = 'eligible' | 'condonable' | 'short' | 'condoned' | 'no_classes';

/** Attended share in basis points (on duty counts as attended), rounded down; null with no classes. */
export function attendedBasisPoints(statuses: MarkStatus[]): number | null {
  if (statuses.length === 0) return null;
  const attended = statuses.filter((s) => s !== 'absent').length;
  return Math.floor((attended * 10000) / statuses.length);
}

/** Where a student stands for a course: against the pack's thresholds, unless condoned. */
export function standing(
  basisPoints: number | null,
  rules: CourseAttendanceRules,
  condoned: boolean,
): Standing {
  if (basisPoints === null) return 'no_classes';
  if (basisPoints >= rules.minimumPercent * 100) return 'eligible';
  if (condoned) return 'condoned';
  return basisPoints >= rules.condonableFromPercent * 100 ? 'condonable' : 'short';
}

/** Standings that let a student sit the course's end exam. */
export const MAY_SIT: readonly Standing[] = ['eligible', 'condoned'];
