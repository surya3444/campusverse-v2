import { withTenant } from '@campusverse/db';
import { command, type EventInput } from '@campusverse/platform-events';
import { PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { sectionOf, sectionRoster } from '@campusverse/school-enrolment';
import { sectionsOn } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  AttendanceError,
  DATE,
  marksThisSection,
  placeOf,
  section,
  setDay,
  today,
  type AttendanceDeps,
} from './common.js';

const MAX_DAYS = 60;

/** Where a student sits on a date: their section, and its place for permission checks. */
async function studentSection(
  deps: AttendanceDeps,
  actor: Actor,
  personId: string,
  onDate: string,
) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const sectionId = await sectionOf(tx, personId, onDate);
    if (!sectionId) throw new AttendanceError('not_enrolled_then');
    return section(tx, sectionId, onDate);
  });
}

/** A parent (or the office) asks for leave or medical leave; the class teacher decides. */
export async function requestLeave(
  deps: AttendanceDeps,
  actor: Actor,
  input: { studentId: string; kind: 'leave' | 'medical'; from: string; to: string; reason: string },
): Promise<{ id: string }> {
  if (!DATE.test(input.from) || !DATE.test(input.to) || input.to < input.from) {
    throw new AttendanceError('bad_dates');
  }
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 864e5 + 1;
  if (days > MAX_DAYS) throw new AttendanceError('too_long');
  if (input.reason.trim().length < 3) throw new AttendanceError('reason_required');
  const s = await studentSection(deps, actor, input.studentId, input.from);
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.leave_request',
      resource: { orgId: actor.orgId, place: placeOf(s), subjectPersonId: input.studentId },
    },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_leave_request (org_id, student_person_id, requested_by_person_id, kind, valid_during, reason)
        values (app_current_org(), ${input.studentId}, ${actor.personId}, ${input.kind},
          daterange(${input.from}::date, ${input.to}::date, '[]'), ${input.reason.trim()})
        returning id::text`);
      if (!row) throw new Error('requestLeave: no row');
      return {
        result: row,
        audit: {
          action: 'school.attendance.leave_request',
          entityType: 'school_leave_request',
          entityId: row.id,
          dataClass: input.kind === 'medical' ? 'sensitive' : 'personal',
          detail: { studentId: input.studentId, from: input.from, to: input.to, kind: input.kind },
        },
      };
    },
  );
}

/**
 * Approves or rejects a pending request. On approval, days already marked absent in the range
 * become leave (as corrections), so the register and the percentage agree with the decision.
 */
export async function decideLeave(
  deps: AttendanceDeps,
  actor: Actor,
  input: { leaveId: string; approve: boolean; note?: string | null | undefined },
): Promise<void> {
  if (!input.approve && (input.note ?? '').trim().length < 3) {
    throw new AttendanceError('note_required');
  }
  const leave = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{
      studentId: string;
      from: string;
      kind: 'leave' | 'medical';
    }>(sql`
      select student_person_id::text as "studentId", lower(valid_during)::text as from, kind
      from school_leave_request where org_id = app_current_org() and id = ${input.leaveId} and status = 'pending'`);
    if (!row) throw new AttendanceError('leave_not_found');
    return row;
  });
  const s = await studentSection(deps, actor, leave.studentId, leave.from);
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.leave_decide',
      resource: { orgId: actor.orgId, place: placeOf(s), subjectPersonId: leave.studentId },
    },
    async (tx) => {
      if (!(await marksThisSection(tx, deps, actor, s, await today(tx)))) {
        throw new PermissionDenied('school.attendance.leave_decide', 'no_relationship');
      }
      const [row] = await tx.execute<{ from: string; until: string }>(sql`
        update school_leave_request set status = ${input.approve ? 'approved' : 'rejected'},
          decided_by_person_id = ${actor.personId}, decided_at = now(), note = ${input.note?.trim() || null}
        where org_id = app_current_org() and id = ${input.leaveId} and status = 'pending'
        returning lower(valid_during)::text as from, upper(valid_during)::text as until`);
      if (!row) throw new AttendanceError('leave_not_found');

      const events: EventInput[] = [];
      if (input.approve) {
        const status = leave.kind === 'medical' ? 'medical_leave' : 'approved_leave';
        const absent = await tx.execute<{ on: string; sectionId: string }>(sql`
          select on_date::text as on, section_id::text as "sectionId" from school_attendance_day
          where org_id = app_current_org() and person_id = ${leave.studentId} and status = 'absent'
            and on_date >= ${row.from}::date and on_date < ${row.until}::date`);
        for (const d of absent) {
          const [event] = await tx.execute<{ id: string }>(sql`
            insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id,
              marks, reason, occurred_at)
            values (app_current_org(), uuidv7(), 'correction', ${d.sectionId}, ${d.on}::date, ${actor.personId},
              ${JSON.stringify([{ personId: leave.studentId, status }])}::jsonb, 'Leave approved', now())
            returning event_id::text as id`);
          if (!event) throw new Error('decideLeave: no event');
          const r = await setDay(tx, {
            personId: leave.studentId,
            onDate: d.on,
            status,
            eventId: event.id,
            sectionId: d.sectionId,
          });
          events.push(...r.events);
        }
      }
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.leave_decide',
          entityType: 'school_leave_request',
          entityId: input.leaveId,
          dataClass: leave.kind === 'medical' ? 'sensitive' : 'personal',
          ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
          detail: { decision: input.approve ? 'approved' : 'rejected', studentId: leave.studentId },
        },
        events,
      };
    },
  );
}

export type LeaveItem = {
  id: string;
  studentId: string;
  studentName: string;
  sectionLabel: string;
  kind: 'leave' | 'medical';
  from: string;
  to: string;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
};

/** Pending requests for the sections this person decides on (all sections for a coordinator). */
export async function pendingLeave(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<LeaveItem[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sections = await sectionsOn(tx, institutionId, d);
    const first = sections[0];
    if (!first) return [];
    await deps.permissions.assertCan(tx, actor, 'school.attendance.leave_decide', {
      orgId: actor.orgId,
      place: placeOf(first),
    });
    const bySection = new Map<string, string>();
    for (const s of sections) {
      if (!(await marksThisSection(tx, deps, actor, s, d))) continue;
      for (const r of await sectionRoster(tx, s.sectionId, d)) bySection.set(r.personId, s.label);
    }
    if (bySection.size === 0) return [];
    const rows = await tx.execute<Omit<LeaveItem, 'sectionLabel'>>(sql`
      select l.id::text, l.student_person_id::text as "studentId", p.legal_name as "studentName", l.kind,
        lower(l.valid_during)::text as from, (upper(l.valid_during) - 1)::text as to, l.reason,
        r.legal_name as "requestedBy", l.status
      from school_leave_request l
      join person p on p.org_id = l.org_id and p.id = l.student_person_id
      join person r on r.org_id = l.org_id and r.id = l.requested_by_person_id
      where l.org_id = app_current_org() and l.status = 'pending'
        and l.student_person_id = any(${`{${[...bySection.keys()].join(',')}}`}::uuid[])
      order by lower(l.valid_during)`);
    return rows.map((r) => ({ ...r, sectionLabel: bySection.get(r.studentId) ?? '' }));
  });
}
