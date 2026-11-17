// Staff attendance (decision 0020): staff check themselves in and out (web or app, with where
// they were); the office keeps the register, which wins over check-ins, and every change to a
// day already marked needs a reason. Late and early leaving follow each institution's settings.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { staffAt, type StaffMember } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { campusGate, placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  istDate,
  monthTotals,
  onCampus,
  summariseDay,
  type DayStatus,
  type Settings,
  type Tap,
} from '../domain/day.js';

type Permissions = ReturnType<typeof createPermissions>;

export const STAFF_CHECKED = 'staff.attendance.checked.v1';
export const STAFF_DAY_MARKED = 'staff.attendance.marked.v1';

export class StaffAttendanceError extends Error {
  constructor(
    readonly code:
      'institution_not_found' | 'off_campus' | 'reason_required' | 'future_date' | 'not_on_staff',
  ) {
    super(`staff attendance: ${code}`);
    this.name = 'StaffAttendanceError';
  }
}

export type AttendanceSettings = Settings & { requireOnCampus: boolean };
export type Day = {
  personId: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  late: boolean;
  leftEarly: boolean;
  source: 'checkin' | 'register';
  markedBy: string | null;
  reason: string | null;
};

const DEFAULTS: AttendanceSettings = {
  startsAt: '08:30',
  endsAt: '15:30',
  lateAfterMinutes: 10,
  earlyBeforeMinutes: 10,
  fullDayMinutes: 300,
  requireOnCampus: false,
};

async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new StaffAttendanceError('institution_not_found');
  return p;
}

async function settingsOf(tx: Tx, institutionId: string): Promise<AttendanceSettings> {
  const [s] = await tx.execute<AttendanceSettings>(sql`
    select to_char(starts_at, 'HH24:MI') as "startsAt", to_char(ends_at, 'HH24:MI') as "endsAt",
      late_after_minutes as "lateAfterMinutes", early_before_minutes as "earlyBeforeMinutes",
      full_day_minutes as "fullDayMinutes", require_on_campus as "requireOnCampus"
    from staff_attendance_settings where org_id = app_current_org() and institution_id = ${institutionId}`);
  return s ?? DEFAULTS;
}

async function tapsOn(tx: Tx, personId: string, institutionId: string, onDate: string) {
  return tx.execute<Tap & { onCampus: boolean | null; distance: number | null }>(sql`
    select direction, at::text as at, on_campus as "onCampus", distance_metres as distance
    from staff_attendance_checkin
    where org_id = app_current_org() and person_id = ${personId} and institution_id = ${institutionId}
      and (at at time zone 'Asia/Kolkata')::date = ${onDate}::date
    order by at`);
}

/** Recomputes a day from its check-ins, unless the office has marked it (the register wins). */
async function refreshDay(tx: Tx, personId: string, institutionId: string, onDate: string) {
  const summary = summariseDay(
    [...(await tapsOn(tx, personId, institutionId, onDate))],
    await settingsOf(tx, institutionId),
  );
  if (!summary) return;
  await tx.execute(sql`
    insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, first_in, last_out,
      late, left_early, source)
    values (app_current_org(), ${personId}, ${institutionId}, ${onDate}::date, ${summary.status}, ${summary.firstIn},
      ${summary.lastOut}, ${summary.late}, ${summary.leftEarly}, 'checkin')
    on conflict (org_id, institution_id, on_date, person_id) do update set
      status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
      late = excluded.late, left_early = excluded.left_early, updated_at = now()
    where staff_attendance_day.source = 'checkin'`);
}

export type CheckIn = {
  institutionId: string;
  direction: 'in' | 'out';
  /** The device's id for this tap (UUIDv7), so an offline retry is never counted twice. */
  eventId: string;
  source: 'web' | 'app';
  at?: string | undefined;
  location?: { lat: number; lng: number; accuracyMetres?: number | undefined } | null | undefined;
};

/** One's own check-in or check-out. Where it happened is kept, and flagged when off campus. */
export async function checkIn(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: CheckIn,
): Promise<{ onCampus: boolean | null; distance: number | null }> {
  const where = await withTenant(db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    db,
    permissions,
    actor,
    {
      permission: 'staff.attendance.check_in',
      resource: { orgId: actor.orgId, subjectPersonId: actor.personId, place: where },
    },
    async (tx) => {
      const staff = await staffAt(
        tx,
        input.institutionId,
        istDate(input.at ?? new Date().toISOString()),
      );
      if (!staff.some((s) => s.personId === actor.personId))
        throw new StaffAttendanceError('not_on_staff');
      const gate = await campusGate(tx, where.campusId);
      const at = input.at && new Date(input.at) < new Date() ? input.at : new Date().toISOString();
      const check =
        gate && input.location ? onCampus(input.location, gate, gate.radiusMetres) : null;
      const settings = await settingsOf(tx, input.institutionId);
      if (settings.requireOnCampus && gate && !check?.inside)
        throw new StaffAttendanceError('off_campus');
      await tx.execute(sql`
        insert into staff_attendance_checkin (org_id, id, person_id, institution_id, direction, at, source,
          latitude, longitude, accuracy_metres, distance_metres, on_campus)
        values (app_current_org(), ${input.eventId}, ${actor.personId}, ${input.institutionId}, ${input.direction},
          ${at}, ${input.source}, ${input.location?.lat ?? null}, ${input.location?.lng ?? null},
          ${input.location?.accuracyMetres ?? null}, ${check?.distance ?? null}, ${check?.inside ?? null})
        on conflict (org_id, id) do nothing`);
      await refreshDay(tx, actor.personId, input.institutionId, istDate(at));
      return {
        result: { onCampus: check?.inside ?? null, distance: check?.distance ?? null },
        audit: {
          action: `staff.attendance.check_${input.direction}`,
          entityType: 'person',
          entityId: actor.personId,
          dataClass: 'personal',
          detail: {
            institutionId: input.institutionId,
            onCampus: check?.inside ?? null,
            source: input.source,
          },
        },
        events: [
          {
            type: STAFF_CHECKED,
            payload: { personId: actor.personId, institutionId: input.institutionId },
          },
        ],
      };
    },
  );
}

export type MyDay = {
  taps: (Tap & { onCampus: boolean | null; distance: number | null })[];
  day: Day | null;
  settings: AttendanceSettings;
  hasGate: boolean;
  onStaff: boolean;
};

/** One's own day: taps, how it counts, and the settings (no permission needed for oneself). */
export async function myDay(
  db: Db,
  actor: Actor,
  institutionId: string,
  onDate: string,
): Promise<MyDay> {
  return withTenant(db, actor.orgId, async (tx) => {
    const p = await place(tx, institutionId);
    const [day] = await tx.execute<Day>(dayQuery(institutionId, onDate, actor.personId));
    return {
      taps: [...(await tapsOn(tx, actor.personId, institutionId, onDate))],
      day: day ?? null,
      settings: await settingsOf(tx, institutionId),
      hasGate: (await campusGate(tx, p.campusId)) !== null,
      onStaff: (await staffAt(tx, institutionId, onDate)).some(
        (s) => s.personId === actor.personId,
      ),
    };
  });
}

const dayQuery = (institutionId: string, onDate: string, personId?: string) => sql`
  select person_id::text as "personId", status, first_in::text as "firstIn", last_out::text as "lastOut", late,
    left_early as "leftEarly", source, marked_by_person_id::text as "markedBy", reason
  from staff_attendance_day
  where org_id = app_current_org() and institution_id = ${institutionId} and on_date = ${onDate}::date
    and (${personId ?? null}::uuid is null or person_id = ${personId ?? null}::uuid)`;

/** The day's register for an institution: every staff member and how their day counts so far. */
export async function register(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  onDate: string,
): Promise<{
  staff: (StaffMember & { day: Day | null; offCampus: boolean })[];
  settings: AttendanceSettings;
}> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await place(tx, institutionId);
    await permissions.assertCan(tx, actor, 'staff.attendance.read', {
      orgId: actor.orgId,
      place: where,
    });
    const days = new Map(
      (await tx.execute<Day>(dayQuery(institutionId, onDate))).map((d) => [d.personId, d]),
    );
    const off = new Set(
      (
        await tx.execute<{ p: string }>(sql`
          select distinct person_id::text as p from staff_attendance_checkin
          where org_id = app_current_org() and institution_id = ${institutionId} and on_campus = false
            and (at at time zone 'Asia/Kolkata')::date = ${onDate}::date`)
      ).map((r) => r.p),
    );
    return {
      staff: (await staffAt(tx, institutionId, onDate)).map((s) => ({
        ...s,
        day: days.get(s.personId) ?? null,
        offCampus: off.has(s.personId),
      })),
      settings: await settingsOf(tx, institutionId),
    };
  });
}

/**
 * The office marks or corrects a day. It then counts as marked, whatever check-ins say. A day
 * already marked differently needs a reason; future days can't be marked except leave and duty.
 */
export async function markDay(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    onDate: string;
    personId: string;
    status: DayStatus;
    reason?: string | null;
  },
): Promise<void> {
  const where = await withTenant(db, actor.orgId, (tx) => place(tx, input.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'staff.attendance.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [today] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
      if (input.onDate > (today?.d ?? '') && !['on_leave', 'on_duty'].includes(input.status))
        throw new StaffAttendanceError('future_date');
      if (
        !(await staffAt(tx, input.institutionId, input.onDate)).some(
          (s) => s.personId === input.personId,
        )
      )
        throw new StaffAttendanceError('not_on_staff');
      const [current] = await tx.execute<{ status: string }>(sql`
        select status from staff_attendance_day where org_id = app_current_org()
          and institution_id = ${input.institutionId} and on_date = ${input.onDate}::date and person_id = ${input.personId}`);
      const reason = input.reason?.trim() || null;
      if (current && current.status !== input.status && !reason)
        throw new StaffAttendanceError('reason_required');
      await tx.execute(sql`
        insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, source,
          marked_by_person_id, reason)
        values (app_current_org(), ${input.personId}, ${input.institutionId}, ${input.onDate}::date, ${input.status},
          'register', ${actor.personId}, ${reason})
        on conflict (org_id, institution_id, on_date, person_id) do update set
          status = excluded.status, source = 'register', marked_by_person_id = excluded.marked_by_person_id,
          reason = excluded.reason, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          action: 'staff.attendance.mark',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          ...(reason ? { reason } : {}),
          detail: {
            institutionId: input.institutionId,
            onDate: input.onDate,
            status: input.status,
            was: current?.status ?? null,
          },
        },
        events: [
          {
            type: STAFF_DAY_MARKED,
            payload: {
              personId: input.personId,
              institutionId: input.institutionId,
              onDate: input.onDate,
            },
          },
        ],
      };
    },
  );
}

export async function attendanceSettings(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<AttendanceSettings> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await place(tx, institutionId);
    await permissions.assertCan(tx, actor, 'staff.attendance.read', {
      orgId: actor.orgId,
      place: where,
    });
    return settingsOf(tx, institutionId);
  });
}

export async function updateAttendanceSettings(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  s: AttendanceSettings,
): Promise<void> {
  const where = await withTenant(db, actor.orgId, (tx) => place(tx, institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'staff.attendance.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      await tx.execute(sql`
        insert into staff_attendance_settings (org_id, institution_id, starts_at, ends_at, late_after_minutes,
          early_before_minutes, full_day_minutes, require_on_campus)
        values (app_current_org(), ${institutionId}, ${s.startsAt}::time, ${s.endsAt}::time, ${s.lateAfterMinutes},
          ${s.earlyBeforeMinutes}, ${s.fullDayMinutes}, ${s.requireOnCampus})
        on conflict (org_id, institution_id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          late_after_minutes = excluded.late_after_minutes, early_before_minutes = excluded.early_before_minutes,
          full_day_minutes = excluded.full_day_minutes, require_on_campus = excluded.require_on_campus,
          updated_at = now()`);
      return {
        result: undefined,
        audit: {
          action: 'staff.attendance.settings',
          entityType: 'institution',
          entityId: institutionId,
          dataClass: 'operational',
          detail: { ...s },
        },
      };
    },
  );
}

/** A month (YYYY-MM): each staff member's days and totals. Unmarked past days are listed as missing. */
export async function monthReport(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  month: string,
) {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await place(tx, institutionId);
    await permissions.assertCan(tx, actor, 'staff.attendance.read', {
      orgId: actor.orgId,
      place: where,
    });
    const first = `${month}-01`;
    const rows = await tx.execute<Day & { onDate: string }>(sql`
      select person_id::text as "personId", on_date::text as "onDate", status, first_in::text as "firstIn",
        last_out::text as "lastOut", late, left_early as "leftEarly", source, marked_by_person_id::text as "markedBy", reason
      from staff_attendance_day
      where org_id = app_current_org() and institution_id = ${institutionId}
        and on_date >= ${first}::date and on_date < (${first}::date + interval '1 month')`);
    const [last] = await tx.execute<{ d: string }>(sql`
      select least((${first}::date + interval '1 month' - interval '1 day')::date, app_today())::text as d`);
    const staff = await staffAt(tx, institutionId, last?.d ?? first);
    return {
      month,
      staff: staff.map((s) => {
        const days = rows.filter((r) => r.personId === s.personId);
        return { ...s, days, totals: monthTotals(days) };
      }),
    };
  });
}

/**
 * Staff away on a date (absent, on leave or on duty), as the register says. For other modules
 * (timetable cover); the caller checks its own permission.
 */
export async function awayOn(
  tx: Tx,
  institutionId: string,
  onDate: string,
): Promise<
  { personId: string; status: 'absent' | 'on_leave' | 'on_duty'; reason: string | null }[]
> {
  return [
    ...(await tx.execute<{
      personId: string;
      status: 'absent' | 'on_leave' | 'on_duty';
      reason: string | null;
    }>(sql`
      select person_id::text as "personId", status, reason from staff_attendance_day
      where org_id = app_current_org() and institution_id = ${institutionId} and on_date = ${onDate}::date
        and status in ('absent', 'on_leave', 'on_duty')`)),
  ];
}
