import type { Db, Tx } from '@campusverse/db';
import type { EventInput } from '@campusverse/platform-events';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { assertYearOpen, sectionInfo, type SectionInfo } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import type { DayStatus } from '../domain/attendance.js';

export type Permissions = ReturnType<typeof createPermissions>;
export type AttendanceDeps = { db: Db; permissions: Permissions };

export const SUBMITTED = 'school.attendance.submitted.v1';
/** Students confirmed absent: parents are told after the school's delay. */
export const CONFIRMED = 'school.attendance.confirmed.v1';
/** A student told of as absent turned out not to be: parents get a correction. */
export const CORRECTED = 'school.attendance.corrected.v1';
export const SHORTAGE_REACHED = 'school.attendance.shortage_reached.v1';
export const HOLIDAY_DECLARED = 'school.attendance.holiday_declared.v1';

export class AttendanceError extends Error {
  constructor(readonly code: string) {
    super(`Attendance: ${code}`);
    this.name = 'AttendanceError';
  }
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function today(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return row?.d ?? '';
}

export async function section(tx: Tx, sectionId: string, onDate: string): Promise<SectionInfo> {
  const s = await sectionInfo(tx, sectionId, onDate);
  if (!s) throw new AttendanceError('section_not_found');
  return s;
}

export const placeOf = (s: { campusId: string; institutionId: string }) => ({
  campusId: s.campusId,
  institutionId: s.institutionId,
});

/** Class teacher, that day's substitute, or someone who manages attendance for the school. */
export async function marksThisSection(
  tx: Tx,
  deps: AttendanceDeps,
  actor: Actor,
  s: SectionInfo,
  onDate: string,
): Promise<boolean> {
  if (s.classTeacherPersonId === actor.personId) return true;
  const [sub] = await tx.execute(sql`
    select 1 from school_attendance_substitute
    where org_id = app_current_org() and section_id = ${s.sectionId} and on_date = ${onDate}::date
      and person_id = ${actor.personId}`);
  if (sub) return true;
  const manage = await deps.permissions.can(tx, actor, 'school.attendance.manage', {
    orgId: actor.orgId,
    place: placeOf(s),
  });
  return manage.allowed;
}

export async function assertMarksThisSection(
  tx: Tx,
  deps: AttendanceDeps,
  actor: Actor,
  s: SectionInfo,
  onDate: string,
): Promise<void> {
  if (!(await marksThisSection(tx, deps, actor, s, onDate))) {
    throw new PermissionDenied('school.attendance.mark', 'no_relationship');
  }
}

/**
 * Sets one student's day from an event that is already recorded, and says which messages follow:
 * a newly absent student is confirmed (alert after the delay); a student whose parents were told
 * of an absence that turned out wrong gets a correction.
 */
export async function setDay(
  tx: Tx,
  input: {
    personId: string;
    onDate: string;
    status: DayStatus;
    eventId: string;
    sectionId: string;
  },
): Promise<{ from: DayStatus; events: EventInput[] }> {
  // Corrections and approved leave can't change a closed year's register.
  const s = await sectionInfo(tx, input.sectionId, input.onDate);
  if (s) await assertYearOpen(tx, s.yearId);
  const [day] = await tx.execute<{ status: DayStatus; alerted: boolean }>(sql`
    select status, absence_alerted_at is not null as alerted from school_attendance_day
    where org_id = app_current_org() and person_id = ${input.personId} and on_date = ${input.onDate}::date
    for update`);
  if (!day) throw new AttendanceError('not_taken');
  await tx.execute(sql`
    update school_attendance_day set status = ${input.status}, source_event_id = ${input.eventId},
      updated_at = now()
    where org_id = app_current_org() and person_id = ${input.personId} and on_date = ${input.onDate}::date`);
  const events: EventInput[] = [];
  if (input.status === 'absent' && day.status !== 'absent') {
    events.push({
      type: CONFIRMED,
      payload: { sectionId: input.sectionId, onDate: input.onDate, personIds: [input.personId] },
    });
  } else if (day.status === 'absent' && day.alerted) {
    events.push({
      type: CORRECTED,
      payload: { personId: input.personId, onDate: input.onDate, status: input.status },
    });
  }
  return { from: day.status, events };
}
