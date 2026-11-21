import { withTenant, type Tx } from '@campusverse/db';
import { command, type EventInput } from '@campusverse/platform-events';
import { PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { sectionRoster } from '@campusverse/school-enrolment';
import { assertYearOpen, classTeacherSections, sectionsOn } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  CORRECTABLE,
  conflictsWith,
  daysFromSubmission,
  type DayStatus,
  type Leave,
  type Mark,
} from '../domain/attendance.js';
import {
  assertMarksThisSection,
  AttendanceError,
  CONFIRMED,
  DATE,
  marksThisSection,
  placeOf,
  section,
  setDay,
  SUBMITTED,
  today,
  type AttendanceDeps,
} from './common.js';

export type Submission = {
  /** Made on the device (UUIDv7), so a resend is recognised. */
  eventId: string;
  deviceId: string | null;
  occurredAt: string;
  sectionId: string;
  onDate: string;
  /** Only the students not present; everyone else is present. */
  marks: Mark[];
};
export type SubmitOutcome =
  { outcome: 'accepted' } | { outcome: 'duplicate' } | { outcome: 'conflict'; conflicts: number };

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === '23505';
};

/** Approved leave covering the date, for the roster's students. */
async function leaveOn(tx: Tx, personIds: string[], onDate: string): Promise<Map<string, Leave>> {
  if (personIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; kind: 'leave' | 'medical' }>(sql`
    select student_person_id::text as id, kind from school_leave_request
    where org_id = app_current_org() and status = 'approved' and valid_during @> ${onDate}::date
      and student_person_id = any(${`{${personIds.join(',')}}`}::uuid[])`);
  return new Map(
    rows.map((r) => [r.id, r.kind === 'medical' ? 'medical_leave' : 'approved_leave']),
  );
}

/** The school holiday on a date, by name, or null. For other school modules (timetable). */
export async function holidayOn(
  tx: Tx,
  institutionId: string,
  onDate: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ name: string }>(sql`
    select name from school_holiday
    where org_id = app_current_org() and institution_id = ${institutionId} and on_date = ${onDate}::date`);
  return row?.name ?? null;
}

/** The school's holidays between two dates (inclusive): staff leave's HolidaysPort. */
export async function holidaysBetween(
  tx: Tx,
  institutionId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await tx.execute<{ d: string }>(sql`
    select on_date::text as d from school_holiday
    where org_id = app_current_org() and institution_id = ${institutionId}
      and on_date between ${from}::date and ${to}::date`);
  return rows.map((r) => r.d);
}

/**
 * A teacher's submission for a section and day, online or synced from a device. Accepted once
 * per event id: a resend is a duplicate and changes nothing. The first submission takes the day;
 * a later one that disagrees (a second teacher, or a second device) becomes conflicts for review.
 */
export async function submitAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  input: Submission,
): Promise<SubmitOutcome> {
  if (!DATE.test(input.onDate)) throw new AttendanceError('bad_date');
  const place = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [seen] = await tx.execute(sql`
      select 1 from school_attendance_event where org_id = app_current_org() and event_id = ${input.eventId}`);
    return seen ? null : placeOf(await section(tx, input.sectionId, input.onDate));
  });
  if (!place) return { outcome: 'duplicate' };

  try {
    return await command(
      deps.db,
      deps.permissions,
      actor,
      { permission: 'school.attendance.mark', resource: { orgId: actor.orgId, place } },
      async (tx) => {
        const s = await section(tx, input.sectionId, input.onDate);
        await assertYearOpen(tx, s.yearId);
        await assertMarksThisSection(tx, deps, actor, s, input.onDate);
        if (input.onDate > (await today(tx))) throw new AttendanceError('future_date');
        if (input.onDate < s.yearStarts || input.onDate >= s.yearEnds) {
          throw new AttendanceError('outside_year');
        }
        if (await holidayOn(tx, s.institutionId, input.onDate))
          throw new AttendanceError('holiday');

        await tx.execute(sql`
          insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id,
            device_id, marks, occurred_at)
          values (app_current_org(), ${input.eventId}, 'submit', ${s.sectionId}, ${input.onDate}::date,
            ${actor.personId}, ${input.deviceId}, ${JSON.stringify(input.marks)}::jsonb, ${input.occurredAt}::timestamptz)`);

        const roster = (await sectionRoster(tx, s.sectionId, input.onDate)).map((r) => r.personId);
        const days = daysFromSubmission(
          roster,
          input.marks,
          await leaveOn(tx, roster, input.onDate),
        );
        if (typeof days === 'string') throw new AttendanceError(days);

        // A concurrent first submission waits here, then finds the day taken.
        const [first] = await tx.execute(sql`
          insert into school_attendance_session (org_id, section_id, on_date, first_event_id, submitted_by_person_id)
          values (app_current_org(), ${s.sectionId}, ${input.onDate}::date, ${input.eventId}, ${actor.personId})
          on conflict do nothing returning 1`);

        const audit = (detail: Record<string, string | number>) => ({
          action: 'school.attendance.mark',
          entityType: 'school_section',
          entityId: s.sectionId,
          dataClass: 'personal' as const,
          detail: { onDate: input.onDate, eventId: input.eventId, ...detail },
        });

        if (first) {
          // A student moved here today may already be marked in their old section: that mark is
          // kept (a day counts once), and everyone else's goes in.
          const written = new Map<string, DayStatus>();
          for (const [personId, status] of days) {
            const [row] = await tx.execute(sql`
              insert into school_attendance_day (org_id, person_id, on_date, section_id, status, source_event_id)
              values (app_current_org(), ${personId}, ${input.onDate}::date, ${s.sectionId}, ${status}, ${input.eventId})
              on conflict (org_id, person_id, on_date) do nothing
              returning 1`);
            if (row) written.set(personId, status);
          }
          const absent = [...written].filter(([, st]) => st === 'absent').map(([id]) => id);
          const events: EventInput[] = [
            {
              type: SUBMITTED,
              payload: {
                sectionId: s.sectionId,
                onDate: input.onDate,
                eventId: input.eventId,
                students: written.size,
                absent: absent.length,
              },
            },
          ];
          if (absent.length > 0) {
            events.push({
              type: CONFIRMED,
              payload: { sectionId: s.sectionId, onDate: input.onDate, personIds: absent },
            });
          }
          return {
            result: { outcome: 'accepted' as const },
            audit: audit({
              students: written.size,
              absent: absent.length,
              markedElsewhere: days.size - written.size,
            }),
            events,
          };
        }

        const current = new Map(
          (
            await tx.execute<{ id: string; status: DayStatus }>(sql`
              select person_id::text as id, status from school_attendance_day
              where org_id = app_current_org() and section_id = ${s.sectionId} and on_date = ${input.onDate}::date`)
          ).map((r) => [r.id, r.status]),
        );
        const conflicts = conflictsWith(current, days);
        for (const c of conflicts) {
          await tx.execute(sql`
            insert into school_attendance_conflict (org_id, section_id, on_date, person_id, current_status,
              incoming_status, incoming_event_id)
            values (app_current_org(), ${s.sectionId}, ${input.onDate}::date, ${c.personId}, ${c.current},
              ${c.incoming}, ${input.eventId})`);
        }
        return {
          result:
            conflicts.length > 0
              ? { outcome: 'conflict' as const, conflicts: conflicts.length }
              : { outcome: 'accepted' as const },
          audit: audit({ conflicts: conflicts.length }),
        };
      },
    );
  } catch (e) {
    // The same event arriving twice at once: the second insert loses the race and changes nothing.
    if (isUniqueViolation(e)) return { outcome: 'duplicate' };
    throw e;
  }
}

/**
 * Days on or after a date that any of the sections already took attendance: a section change must
 * start after them (school/enrolment asks through the API's wiring).
 */
export async function attendanceTaken(
  tx: Tx,
  sectionIds: string[],
  from: string,
): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const rows = await tx.execute<{ d: string }>(sql`
    select distinct on_date::text as d from school_attendance_session
    where org_id = app_current_org() and on_date >= ${from}::date
      and section_id = any(${`{${sectionIds.join(',')}}`}::uuid[])
    order by 1`);
  return rows.map((r) => r.d);
}

export type SyncEvent = {
  eventId: string;
  deviceId: string;
  actorId: string;
  occurredAt: string;
  type: 'attendance.mark';
  payload: { sectionId: string; onDate: string; marks: Mark[] };
};
export type SyncResult = {
  eventId: string;
  outcome: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  code?: string;
  conflicts?: number;
};

/**
 * Applies a device's queued events in order. Each is final once answered (accepted, duplicate,
 * conflict or rejected), so the device can drop it. Only a crash or outage is left to retry.
 */
export async function acceptSyncEvents(
  deps: AttendanceDeps,
  actor: Actor,
  events: SyncEvent[],
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const e of events) {
    // The device says who marked; the session decides. A mismatch is someone else's queue.
    if (e.actorId !== actor.personId) {
      results.push({ eventId: e.eventId, outcome: 'rejected', code: 'other_actor' });
      continue;
    }
    try {
      const r = await submitAttendance(deps, actor, {
        eventId: e.eventId,
        deviceId: e.deviceId,
        occurredAt: e.occurredAt,
        ...e.payload,
      });
      results.push({ eventId: e.eventId, ...r });
    } catch (err) {
      if (err instanceof AttendanceError) {
        results.push({ eventId: e.eventId, outcome: 'rejected', code: err.code });
      } else if (err instanceof PermissionDenied) {
        results.push({ eventId: e.eventId, outcome: 'rejected', code: 'forbidden' });
      } else throw err;
    }
  }
  return results;
}

/** The original stays; the correction is a new event with its reason and editor. */
export async function correctAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  input: { personId: string; onDate: string; status: DayStatus; reason: string },
): Promise<void> {
  if (!DATE.test(input.onDate)) throw new AttendanceError('bad_date');
  if (!(CORRECTABLE as readonly string[]).includes(input.status)) {
    throw new AttendanceError('bad_status');
  }
  if (input.reason.trim().length < 3) throw new AttendanceError('reason_required');
  const sectionId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      select section_id::text as id from school_attendance_day
      where org_id = app_current_org() and person_id = ${input.personId} and on_date = ${input.onDate}::date`);
    if (!row) throw new AttendanceError('not_taken');
    return row.id;
  });
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await section(tx, sectionId, input.onDate)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.mark',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.personId },
    },
    async (tx) => {
      const s = await section(tx, sectionId, input.onDate);
      await assertMarksThisSection(tx, deps, actor, s, input.onDate);
      const [event] = await tx.execute<{ id: string }>(sql`
        insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id,
          marks, reason, occurred_at)
        values (app_current_org(), uuidv7(), 'correction', ${sectionId}, ${input.onDate}::date, ${actor.personId},
          ${JSON.stringify([{ personId: input.personId, status: input.status }])}::jsonb, ${input.reason.trim()}, now())
        returning event_id::text as id`);
      if (!event) throw new Error('correction: no event');
      const { from, events } = await setDay(tx, {
        ...input,
        eventId: event.id,
        sectionId,
      });
      if (from === input.status) throw new AttendanceError('no_change');
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.correct',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: { onDate: input.onDate, from, to: input.status, eventId: event.id },
        },
        events,
      };
    },
  );
}

export type OpenConflict = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  onDate: string;
  personId: string;
  name: string;
  current: DayStatus;
  incoming: DayStatus;
  incomingBy: string;
};

/** Disagreeing submissions waiting for review, for one institution. */
export async function openConflicts(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<OpenConflict[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sections = await sectionsOn(tx, institutionId, d);
    const first = sections[0];
    if (!first) return [];
    await deps.permissions.assertCan(tx, actor, 'school.attendance.manage', {
      orgId: actor.orgId,
      place: placeOf(first),
    });
    const labels = new Map(sections.map((s) => [s.sectionId, s.label]));
    const rows = await tx.execute<Omit<OpenConflict, 'sectionLabel'>>(sql`
      select c.id::text, c.section_id::text as "sectionId", c.on_date::text as "onDate",
        c.person_id::text as "personId", p.legal_name as name, c.current_status as current,
        c.incoming_status as incoming, a.legal_name as "incomingBy"
      from school_attendance_conflict c
      join person p on p.org_id = c.org_id and p.id = c.person_id
      join school_attendance_event e on e.org_id = c.org_id and e.event_id = c.incoming_event_id
      join person a on a.org_id = e.org_id and a.id = e.actor_person_id
      where c.org_id = app_current_org() and c.resolution is null
      order by c.on_date desc, c.created_at`);
    return rows
      .filter((r) => labels.has(r.sectionId))
      .map((r) => ({ ...r, sectionLabel: labels.get(r.sectionId) ?? '' }));
  });
}

/** Keep what was recorded first, or apply the later submission's status (as a correction). */
export async function resolveConflict(
  deps: AttendanceDeps,
  actor: Actor,
  input: { conflictId: string; apply: boolean },
): Promise<void> {
  const found = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{ sectionId: string; onDate: string }>(sql`
      select section_id::text as "sectionId", on_date::text as "onDate" from school_attendance_conflict
      where org_id = app_current_org() and id = ${input.conflictId} and resolution is null`);
    if (!c) throw new AttendanceError('conflict_not_found');
    return { ...c, place: placeOf(await section(tx, c.sectionId, c.onDate)) };
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.manage',
      resource: { orgId: actor.orgId, place: found.place },
    },
    async (tx) => {
      const [c] = await tx.execute<{ personId: string; incoming: DayStatus }>(sql`
        update school_attendance_conflict set resolution = ${input.apply ? 'applied' : 'kept'},
          resolved_by_person_id = ${actor.personId}, resolved_at = now()
        where org_id = app_current_org() and id = ${input.conflictId} and resolution is null
        returning person_id::text as "personId", incoming_status as incoming`);
      if (!c) throw new AttendanceError('conflict_not_found');
      let events: EventInput[] = [];
      if (input.apply) {
        const [event] = await tx.execute<{ id: string }>(sql`
          insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id,
            marks, reason, occurred_at)
          values (app_current_org(), uuidv7(), 'conflict_resolution', ${found.sectionId}, ${found.onDate}::date,
            ${actor.personId}, ${JSON.stringify([{ personId: c.personId, status: c.incoming }])}::jsonb,
            'Later submission applied after review', now())
          returning event_id::text as id`);
        if (!event) throw new Error('resolve: no event');
        ({ events } = await setDay(tx, {
          personId: c.personId,
          onDate: found.onDate,
          status: c.incoming,
          eventId: event.id,
          sectionId: found.sectionId,
        }));
      }
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.manage',
          entityType: 'school_attendance_conflict',
          entityId: input.conflictId,
          dataClass: 'personal',
          detail: { resolution: input.apply ? 'applied' : 'kept', onDate: found.onDate },
        },
        events,
      };
    },
  );
}

/** The competent authority's sign-off, after the teacher's submission. */
export async function signOff(
  deps: AttendanceDeps,
  actor: Actor,
  input: { sectionId: string; onDate: string },
): Promise<void> {
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await section(tx, input.sectionId, input.onDate)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.attendance.sign_off', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [row] = await tx.execute(sql`
        update school_attendance_session set signed_off_by_person_id = ${actor.personId}, signed_off_at = now()
        where org_id = app_current_org() and section_id = ${input.sectionId} and on_date = ${input.onDate}::date
          and signed_off_at is null
        returning 1`);
      if (!row) throw new AttendanceError('not_awaiting_sign_off');
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.sign_off',
          entityType: 'school_section',
          entityId: input.sectionId,
          dataClass: 'operational',
          detail: { onDate: input.onDate },
        },
      };
    },
  );
}

/** Temporary permission for another teacher to mark a section on one day. */
export async function assignSubstitute(
  deps: AttendanceDeps,
  actor: Actor,
  input: { sectionId: string; onDate: string; personId: string },
): Promise<void> {
  if (!DATE.test(input.onDate)) throw new AttendanceError('bad_date');
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await section(tx, input.sectionId, input.onDate)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.attendance.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      await tx.execute(sql`
        insert into school_attendance_substitute (org_id, section_id, on_date, person_id, granted_by_person_id)
        values (app_current_org(), ${input.sectionId}, ${input.onDate}::date, ${input.personId}, ${actor.personId})
        on conflict do nothing`);
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.manage',
          entityType: 'school_section',
          entityId: input.sectionId,
          dataClass: 'operational',
          detail: { substitute: input.personId, onDate: input.onDate },
        },
      };
    },
  );
}

export type SheetStudent = {
  personId: string;
  name: string;
  rollNumber: number | null;
  /** Recorded status once taken; before that, leave if any, else null (present by default). */
  status: DayStatus | null;
  onLeave: Leave | null;
  /** Already marked that day in another section (they moved here): that section's label. */
  markedIn: string | null;
};
export type MarkingSheet = {
  sectionId: string;
  label: string;
  onDate: string;
  today: string;
  holiday: string | null;
  session: {
    submittedAt: string;
    submittedBy: string;
    signedOffAt: string | null;
    signOffRequired: boolean;
  } | null;
  students: SheetStudent[];
  canMark: boolean;
  canSignOff: boolean;
  openConflicts: number;
};

/** What the marking screen needs: the roster with leave, and the day if already taken. */
export async function markingSheet(
  deps: AttendanceDeps,
  actor: Actor,
  input: { sectionId: string; onDate?: string | undefined },
): Promise<MarkingSheet> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const onDate = input.onDate ?? d;
    if (!DATE.test(onDate)) throw new AttendanceError('bad_date');
    const s = await section(tx, input.sectionId, onDate);
    const canMark =
      (
        await deps.permissions.can(tx, actor, 'school.attendance.mark', {
          orgId: actor.orgId,
          place: placeOf(s),
        })
      ).allowed && (await marksThisSection(tx, deps, actor, s, onDate));
    if (!canMark) {
      await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
        orgId: actor.orgId,
        place: placeOf(s),
      });
    }
    const roster = await sectionRoster(tx, s.sectionId, onDate);
    const leave = await leaveOn(
      tx,
      roster.map((r) => r.personId),
      onDate,
    );
    // Each student's mark for the day wherever it was taken: here, or in a section they left today.
    const marks = await tx.execute<{ id: string; status: DayStatus; elsewhere: string | null }>(sql`
      select d.person_id::text as id, d.status,
        case when d.section_id <> ${s.sectionId} then c.name || '-' || x.name end as elsewhere
      from school_attendance_day d
      join school_section x on x.org_id = d.org_id and x.id = d.section_id
      join school_class c on c.org_id = x.org_id and c.id = x.class_id
      where d.org_id = app_current_org() and d.on_date = ${onDate}::date
        and d.person_id = any(${`{${roster.map((r) => r.personId).join(',')}}`}::uuid[])`);
    const days = new Map(marks.map((r) => [r.id, r.status]));
    const elsewhere = new Map(marks.map((r) => [r.id, r.elsewhere]));
    const [session] = await tx.execute<{
      submittedAt: string;
      submittedBy: string;
      signedOffAt: string | null;
      signOffRequired: boolean;
    }>(sql`
      select x.submitted_at::text as "submittedAt", p.legal_name as "submittedBy",
        x.signed_off_at::text as "signedOffAt", coalesce(st.sign_off_required, false) as "signOffRequired"
      from school_attendance_session x
      join person p on p.org_id = x.org_id and p.id = x.submitted_by_person_id
      left join school_attendance_settings st on st.org_id = x.org_id and st.institution_id = ${s.institutionId}
      where x.org_id = app_current_org() and x.section_id = ${s.sectionId} and x.on_date = ${onDate}::date`);
    const [open] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_attendance_conflict
      where org_id = app_current_org() and section_id = ${s.sectionId} and on_date = ${onDate}::date
        and resolution is null`);
    return {
      sectionId: s.sectionId,
      label: s.label,
      onDate,
      today: d,
      holiday: await holidayOn(tx, s.institutionId, onDate),
      session: session ?? null,
      students: roster.map((r) => ({
        ...r,
        status: days.get(r.personId) ?? leave.get(r.personId) ?? null,
        onLeave: leave.get(r.personId) ?? null,
        markedIn: elsewhere.get(r.personId) ?? null,
      })),
      canMark,
      canSignOff: (
        await deps.permissions.can(tx, actor, 'school.attendance.sign_off', {
          orgId: actor.orgId,
          place: placeOf(s),
        })
      ).allowed,
      openConflicts: open?.n ?? 0,
    };
  });
}

export type SectionDay = {
  sectionId: string;
  label: string;
  classTeacherName: string | null;
  mine: boolean;
  state: 'not_taken' | 'submitted' | 'signed_off' | 'holiday';
  students: number;
  absent: number;
  /** When the register was first submitted today. */
  submittedAt: string | null;
};
export type AttendanceDay = {
  onDate: string;
  holiday: string | null;
  sections: SectionDay[];
  /** False for a teacher, who sees only their own sections. */
  seesAll: boolean;
  openConflicts: number;
  pendingLeave: number;
};

/**
 * The day for one institution: which sections have marked and which haven't. A coordinator sees
 * every section; a teacher sees their own (class teacher or substitute).
 */
export async function attendanceDay(
  deps: AttendanceDeps,
  actor: Actor,
  input: { institutionId: string; onDate?: string | undefined },
): Promise<AttendanceDay> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const onDate = input.onDate ?? (await today(tx));
    if (!DATE.test(onDate)) throw new AttendanceError('bad_date');
    const all = await sectionsOn(tx, input.institutionId, onDate);
    const first = all[0];
    const [holiday] = await tx.execute<{ name: string }>(sql`
      select name from school_holiday
      where org_id = app_current_org() and institution_id = ${input.institutionId} and on_date = ${onDate}::date`);
    if (!first) {
      return {
        onDate,
        holiday: holiday?.name ?? null,
        sections: [],
        seesAll: false,
        openConflicts: 0,
        pendingLeave: 0,
      };
    }
    const resource = { orgId: actor.orgId, place: placeOf(first) };
    const seesAll = (await deps.permissions.can(tx, actor, 'school.attendance.read', resource))
      .allowed;
    if (!seesAll) await deps.permissions.assertCan(tx, actor, 'school.attendance.mark', resource);

    const own = new Set(await classTeacherSections(tx, actor.personId, onDate));
    for (const r of await tx.execute<{ id: string }>(sql`
      select section_id::text as id from school_attendance_substitute
      where org_id = app_current_org() and person_id = ${actor.personId} and on_date = ${onDate}::date`)) {
      own.add(r.id);
    }
    const visible = seesAll ? all : all.filter((s) => own.has(s.sectionId));
    const ids = `{${visible.map((s) => s.sectionId).join(',')}}`;
    const counts = new Map(
      (
        await tx.execute<{
          id: string;
          students: number;
          absent: number;
          signed: boolean;
          submittedAt: string;
        }>(sql`
          select d.section_id::text as id, count(*)::int as students,
            count(*) filter (where d.status = 'absent')::int as absent,
            bool_or(x.signed_off_at is not null) as signed,
            min(x.submitted_at)::text as "submittedAt"
          from school_attendance_day d
          join school_attendance_session x on x.org_id = d.org_id and x.section_id = d.section_id and x.on_date = d.on_date
          where d.org_id = app_current_org() and d.on_date = ${onDate}::date and d.section_id = any(${ids}::uuid[])
          group by d.section_id`)
      ).map((r) => [r.id, r]),
    );
    const rosterSizes = new Map<string, number>();
    const students: string[] = [];
    for (const s of visible) {
      const roster = await sectionRoster(tx, s.sectionId, onDate);
      rosterSizes.set(s.sectionId, roster.length);
      students.push(...roster.map((r) => r.personId));
    }
    const [conflicts] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_attendance_conflict
      where org_id = app_current_org() and resolution is null and section_id = any(${ids}::uuid[])`);
    const [leave] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from school_leave_request
      where org_id = app_current_org() and status = 'pending'
        and student_person_id = any(${`{${students.join(',')}}`}::uuid[])`);

    return {
      onDate,
      holiday: holiday?.name ?? null,
      seesAll,
      openConflicts: seesAll ? (conflicts?.n ?? 0) : 0,
      pendingLeave: leave?.n ?? 0,
      sections: visible.map((s) => {
        const c = counts.get(s.sectionId);
        return {
          sectionId: s.sectionId,
          label: s.label,
          classTeacherName: s.classTeacherName,
          mine: own.has(s.sectionId),
          state: holiday ? 'holiday' : !c ? 'not_taken' : c.signed ? 'signed_off' : 'submitted',
          students: c?.students ?? rosterSizes.get(s.sectionId) ?? 0,
          absent: c?.absent ?? 0,
          submittedAt: c?.submittedAt ?? null,
        };
      }),
    };
  });
}

export type Register = {
  sectionId: string;
  label: string;
  month: string;
  /** Every date in the month. */
  dates: string[];
  holidays: Record<string, string>;
  students: {
    personId: string;
    name: string;
    rollNumber: number | null;
    days: Record<string, DayStatus>;
  }[];
};

/** The monthly register for a section, printable. */
export async function monthlyRegister(
  deps: AttendanceDeps,
  actor: Actor,
  input: { sectionId: string; month: string },
): Promise<Register> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new AttendanceError('bad_month');
  const firstDay = `${input.month}-01`;
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [range] = await tx.execute<{ last: string }>(sql`
      select (date_trunc('month', ${firstDay}::date) + interval '1 month - 1 day')::date::text as last`);
    const lastDay = range?.last ?? firstDay;
    const d = await today(tx);
    const s = await section(tx, input.sectionId, d);
    if (!(await marksThisSection(tx, deps, actor, s, d))) {
      await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
        orgId: actor.orgId,
        place: placeOf(s),
      });
    }
    const dates: string[] = [];
    for (let d = new Date(`${firstDay}T00:00:00Z`); d.toISOString().slice(0, 10) <= lastDay;) {
      dates.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 864e5);
    }
    const rows = await tx.execute<{ id: string; on: string; status: DayStatus }>(sql`
      select person_id::text as id, on_date::text as on, status from school_attendance_day
      where org_id = app_current_org() and section_id = ${s.sectionId}
        and on_date between ${firstDay}::date and ${lastDay}::date`);
    const holidays = await tx.execute<{ on: string; name: string }>(sql`
      select on_date::text as on, name from school_holiday
      where org_id = app_current_org() and institution_id = ${s.institutionId}
        and on_date between ${firstDay}::date and ${lastDay}::date`);
    // Everyone enrolled at any point in the month, in roll order.
    const people = await sectionRoster(tx, s.sectionId, firstDay, lastDay);
    const byPerson = new Map<string, Record<string, DayStatus>>();
    for (const r of rows) byPerson.set(r.id, { ...byPerson.get(r.id), [r.on]: r.status });
    return {
      sectionId: s.sectionId,
      label: s.label,
      month: input.month,
      dates,
      holidays: Object.fromEntries(holidays.map((h) => [h.on, h.name])),
      students: people.map((p) => ({ ...p, days: byPerson.get(p.personId) ?? {} })),
    };
  });
}

export type TrendDay = { onDate: string; present: number; absent: number; leave: number };

/**
 * The last seven days of marks for the school's sections today, for the dashboard's weekly chart.
 * Present counts present, late, half day and school duty; leave counts approved and medical leave.
 */
export async function attendanceTrend(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<TrendDay[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const onDate = await today(tx);
    const all = await sectionsOn(tx, institutionId, onDate);
    const first = all[0];
    if (!first) return [];
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      place: placeOf(first),
    });
    const ids = `{${all.map((s) => s.sectionId).join(',')}}`;
    const rows = await tx.execute<TrendDay>(sql`
      select d::date::text as "onDate",
        count(a.*) filter (where a.status in ('present', 'late', 'half_day', 'school_duty'))::int as present,
        count(a.*) filter (where a.status = 'absent')::int as absent,
        count(a.*) filter (where a.status in ('approved_leave', 'medical_leave'))::int as leave
      from generate_series(${onDate}::date - 6, ${onDate}::date, interval '1 day') d
      left join school_attendance_day a on a.org_id = app_current_org() and a.on_date = d::date
        and a.section_id = any(${ids}::uuid[])
      group by d order by d`);
    return [...rows];
  });
}
