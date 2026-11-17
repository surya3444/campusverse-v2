import { withTenant, type Tx } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { sectionOf } from '@campusverse/school-enrolment';
import { sql } from 'drizzle-orm';
import { attendancePercent, type DayStatus } from '../domain/attendance.js';
import { placeOf, section, today, type AttendanceDeps } from './common.js';
import type { LeaveItem } from './leave.js';

export type ChildDay = {
  onDate: string;
  /** Null until the class teacher marks the day. */
  status: DayStatus | null;
  holiday: string | null;
  /** Approved leave covering today, shown before the day is marked. */
  onLeave: 'leave' | 'medical' | null;
  leave: Omit<LeaveItem, 'studentName' | 'sectionLabel' | 'requestedBy'>[];
};

/**
 * One child's day and leave requests, for a guardian (or anyone who may read attendance there).
 * Checked with the guardian relation: a parent sees their own child only.
 */
export async function childDay(
  deps: AttendanceDeps,
  actor: Actor,
  studentId: string,
): Promise<ChildDay> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sectionId = await sectionOf(tx, studentId, d);
    const s = sectionId ? await section(tx, sectionId, d) : null;
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      ...(s ? { place: placeOf(s) } : {}),
      subjectPersonId: studentId,
    });
    const [day] = await tx.execute<{ status: DayStatus }>(sql`
      select status from school_attendance_day
      where org_id = app_current_org() and person_id = ${studentId} and on_date = ${d}::date`);
    const [holiday] = s
      ? await tx.execute<{ name: string }>(sql`
          select name from school_holiday
          where org_id = app_current_org() and institution_id = ${s.institutionId} and on_date = ${d}::date`)
      : [];
    const leave = await tx.execute<ChildDay['leave'][number]>(sql`
      select id::text, student_person_id::text as "studentId", kind, lower(valid_during)::text as from,
        (upper(valid_during) - 1)::text as to, reason, status
      from school_leave_request
      where org_id = app_current_org() and student_person_id = ${studentId}
        and upper(valid_during) > ${d}::date - 30
      order by lower(valid_during) desc limit 20`);
    const covering = leave.find((l) => l.status === 'approved' && l.from <= d && l.to >= d);
    return {
      onDate: d,
      status: day?.status ?? null,
      holiday: holiday?.name ?? null,
      onLeave: covering?.kind ?? null,
      leave: [...leave],
    };
  });
}

export type StudentAttendance = {
  /** Year so far; null before any working day is marked. */
  basisPoints: number | null;
  workingDays: number;
  /** In half-days, so a half day stays whole. */
  attendedHalves: number;
  /** The latest absences, newest first. */
  recentAbsences: string[];
};

/** One student's year so far, for their record. Same permission as the register. */
export async function studentAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  studentId: string,
): Promise<StudentAttendance | null> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sectionId = await sectionOf(tx, studentId, d);
    const s = sectionId ? await section(tx, sectionId, d) : null;
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      ...(s ? { place: placeOf(s) } : {}),
      subjectPersonId: studentId,
    });
    if (!s) return null;
    const days = await tx.execute<{ onDate: string; status: DayStatus }>(sql`
      select on_date::text as "onDate", status from school_attendance_day
      where org_id = app_current_org() and person_id = ${studentId}
        and on_date >= ${s.yearStarts}::date and on_date <= ${d}::date
      order by on_date desc`);
    return {
      ...attendancePercent(days.map((x) => x.status)),
      recentAbsences: days
        .filter((x) => x.status === 'absent')
        .slice(0, 5)
        .map((x) => x.onDate),
    };
  });
}

/**
 * Working days and days attended between two dates, for a TC. A half day counts half, so days
 * attended is reported in half-days to stay whole; holidays are not working days.
 */
export async function attendanceFigures(
  tx: Tx,
  input: { studentId: string; from: string; until: string },
): Promise<{ workingDays: number; attendedHalfDays: number }> {
  const rows = await tx.execute<{ status: DayStatus }>(sql`
    select status from school_attendance_day
    where org_id = app_current_org() and person_id = ${input.studentId}
      and on_date >= ${input.from}::date and on_date < ${input.until}::date`);
  const p = attendancePercent(rows.map((r) => r.status));
  return { workingDays: p.workingDays, attendedHalfDays: p.attendedHalves };
}

/** Whether any of these students has attendance on or after a date (a new year already in use). */
export async function anyAttendanceFrom(
  tx: Tx,
  studentIds: string[],
  from: string,
): Promise<boolean> {
  if (studentIds.length === 0) return false;
  const [row] = await tx.execute(sql`
    select 1 from school_attendance_day where org_id = app_current_org() and on_date >= ${from}::date
      and person_id = any(${`{${studentIds.join(',')}}`}::uuid[]) limit 1`);
  return !!row;
}
