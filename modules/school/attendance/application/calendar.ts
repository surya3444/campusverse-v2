import { withTenant } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sectionRoster } from '@campusverse/school-enrolment';
import { sectionsOn, type SectionInfo } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import {
  AttendanceError,
  DATE,
  HOLIDAY_DECLARED,
  placeOf,
  today,
  type AttendanceDeps,
} from './common.js';

export type HolidayPreview = {
  onDate: string;
  name: string;
  sections: number;
  students: number;
  /** Sections that already marked that day: their marks become holiday. */
  alreadyMarked: number;
  /** Absences whose parents were already told; nothing undoes that, the notice explains. */
  absencesAlreadyAlerted: number;
};

async function sectionsFor(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
  onDate: string,
) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const sections = await sectionsOn(tx, institutionId, onDate);
    if (sections.length === 0) throw new AttendanceError('no_year_on_date');
    return sections;
  });
}

const checkHoliday = (input: { onDate: string; name: string }) => {
  if (!DATE.test(input.onDate)) throw new AttendanceError('bad_date');
  if (input.name.trim().length < 2) throw new AttendanceError('name_required');
};

/** What declaring a holiday would change, before anything is written. */
export async function previewHoliday(
  deps: AttendanceDeps,
  actor: Actor,
  input: { institutionId: string; onDate: string; name: string },
): Promise<HolidayPreview> {
  checkHoliday(input);
  const sections = await sectionsFor(deps, actor, input.institutionId, input.onDate);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.attendance.manage', {
      orgId: actor.orgId,
      place: placeOf(sections[0] as SectionInfo),
    });
    let students = 0;
    for (const s of sections)
      students += (await sectionRoster(tx, s.sectionId, input.onDate)).length;
    const ids = `{${sections.map((s) => s.sectionId).join(',')}}`;
    const [taken] = await tx.execute<{ sections: number; alerted: number }>(sql`
      select count(distinct section_id)::int as sections,
        count(*) filter (where absence_alerted_at is not null)::int as alerted
      from school_attendance_day
      where org_id = app_current_org() and on_date = ${input.onDate}::date and section_id = any(${ids}::uuid[])`);
    return {
      onDate: input.onDate,
      name: input.name.trim(),
      sections: sections.length,
      students,
      alreadyMarked: taken?.sections ?? 0,
      absencesAlreadyAlerted: taken?.alerted ?? 0,
    };
  });
}

/**
 * Declares a holiday for the whole school. Marks already taken that day become holiday (each as
 * a recorded event), pending absence alerts no longer fire, and parents get a notice.
 */
export async function declareHoliday(
  deps: AttendanceDeps,
  actor: Actor,
  input: { institutionId: string; onDate: string; name: string },
): Promise<{ id: string }> {
  checkHoliday(input);
  const sections = await sectionsFor(deps, actor, input.institutionId, input.onDate);
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.manage',
      resource: { orgId: actor.orgId, place: placeOf(sections[0] as SectionInfo) },
    },
    async (tx) => {
      if (input.onDate < (await today(tx))) throw new AttendanceError('past_date');
      const [holiday] = await tx.execute<{ id: string }>(sql`
        insert into school_holiday (org_id, institution_id, on_date, name, declared_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.onDate}::date, ${input.name.trim()}, ${actor.personId})
        on conflict do nothing returning id::text`);
      if (!holiday) throw new AttendanceError('already_holiday');
      const ids = `{${sections.map((s) => s.sectionId).join(',')}}`;
      const taken = await tx.execute<{ id: string }>(sql`
        select distinct section_id::text as id from school_attendance_day
        where org_id = app_current_org() and on_date = ${input.onDate}::date and section_id = any(${ids}::uuid[])`);
      for (const t of taken) {
        const [event] = await tx.execute<{ id: string }>(sql`
          insert into school_attendance_event (org_id, event_id, kind, section_id, on_date, actor_person_id,
            reason, occurred_at)
          values (app_current_org(), uuidv7(), 'holiday', ${t.id}, ${input.onDate}::date, ${actor.personId},
            ${input.name.trim()}, now())
          returning event_id::text as id`);
        await tx.execute(sql`
          update school_attendance_day set status = 'holiday', source_event_id = ${event?.id}, updated_at = now()
          where org_id = app_current_org() and section_id = ${t.id} and on_date = ${input.onDate}::date`);
      }
      return {
        result: holiday,
        audit: {
          action: 'school.attendance.manage',
          entityType: 'school_holiday',
          entityId: holiday.id,
          dataClass: 'operational',
          detail: { onDate: input.onDate, sectionsChanged: taken.length },
        },
        events: [
          {
            type: HOLIDAY_DECLARED,
            payload: {
              holidayId: holiday.id,
              institutionId: input.institutionId,
              onDate: input.onDate,
              name: input.name.trim(),
              sectionIds: sections.map((s) => s.sectionId),
            },
          },
        ],
      };
    },
  );
}

export type AttendanceSettings = { alertDelayMinutes: number; signOffRequired: boolean };

export async function attendanceSettings(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<AttendanceSettings> {
  const sections = await sectionsFor(
    deps,
    actor,
    institutionId,
    await withTenant(deps.db, actor.orgId, today),
  );
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      place: placeOf(sections[0] as SectionInfo),
    });
    const [row] = await tx.execute<AttendanceSettings>(sql`
      select alert_delay_minutes as "alertDelayMinutes", sign_off_required as "signOffRequired"
      from school_attendance_settings where org_id = app_current_org() and institution_id = ${institutionId}`);
    return row ?? { alertDelayMinutes: 30, signOffRequired: false };
  });
}

export async function updateAttendanceSettings(
  deps: AttendanceDeps,
  actor: Actor,
  input: { institutionId: string } & AttendanceSettings,
): Promise<void> {
  if (
    !Number.isInteger(input.alertDelayMinutes) ||
    input.alertDelayMinutes < 0 ||
    input.alertDelayMinutes > 480
  ) {
    throw new AttendanceError('bad_delay');
  }
  const sections = await sectionsFor(
    deps,
    actor,
    input.institutionId,
    await withTenant(deps.db, actor.orgId, today),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.manage',
      resource: { orgId: actor.orgId, place: placeOf(sections[0] as SectionInfo) },
    },
    async (tx) => {
      await tx.execute(sql`
        insert into school_attendance_settings (org_id, institution_id, alert_delay_minutes, sign_off_required)
        values (app_current_org(), ${input.institutionId}, ${input.alertDelayMinutes}, ${input.signOffRequired})
        on conflict (org_id, institution_id) do update set alert_delay_minutes = excluded.alert_delay_minutes,
          sign_off_required = excluded.sign_off_required, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.manage',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'operational',
          detail: {
            alertDelayMinutes: input.alertDelayMinutes,
            signOffRequired: input.signOffRequired,
          },
        },
      };
    },
  );
}
