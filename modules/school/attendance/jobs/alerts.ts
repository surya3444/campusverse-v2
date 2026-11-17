import { withTenant, type Db } from '@campusverse/db';
import type { Consumer, Schedule, Task } from '@campusverse/platform-events';
import { sectionRoster } from '@campusverse/school-enrolment';
import { sectionInfo } from '@campusverse/school-setup';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { CONFIRMED, CORRECTED, HOLIDAY_DECLARED } from '../application/common.js';
import { COPY } from '../copy.js';

export const ABSENCE_ALERT = 'school.attendance.absence-alert';

type AlertData = { orgId: string; sectionId: string; onDate: string; personIds: string[] };

/**
 * Tells guardians of students still absent once the school's delay has passed. Runs on every
 * delivery: a student is alerted once (absence_alerted_at, and the message dedupe key), and a
 * student corrected to present in the meantime is never alerted.
 */
export async function sendAbsenceAlerts(db: Db, data: AlertData): Promise<void> {
  await withTenant(db, data.orgId, async (tx) => {
    const names = new Map(
      (await sectionRoster(tx, data.sectionId, data.onDate)).map((r) => [r.personId, r.name]),
    );
    for (const personId of data.personIds) {
      const [day] = await tx.execute(sql`
        select 1 from school_attendance_day
        where org_id = app_current_org() and person_id = ${personId} and on_date = ${data.onDate}::date
          and status = 'absent' and absence_alerted_at is null
        for update`);
      if (!day) continue;
      await notifyGuardians(tx, {
        studentId: personId,
        flag: 'academic_messages',
        kind: 'absence',
        language: 'en',
        title: COPY.en.absenceTitle,
        body: COPY.en.absenceBody(names.get(personId) ?? 'Your child', data.onDate),
        dedupeKey: `absence:${personId}:${data.onDate}`,
      });
      await tx.execute(sql`
        update school_attendance_day set absence_alerted_at = now()
        where org_id = app_current_org() and person_id = ${personId} and on_date = ${data.onDate}::date`);
    }
  });
}

/** Consumers and the delayed alert task. deps.schedule may be bound after the runtime exists. */
export function attendanceJobs(deps: { schedule: Schedule }): {
  consumers: Consumer[];
  tasks: Task[];
} {
  return {
    consumers: [
      {
        // Repeat-safe: a second schedule only re-checks, and the task alerts each student once.
        name: 'school.attendance.schedule-alerts',
        queue: 'notifications',
        events: [CONFIRMED],
        afterCommit: async (db, e) => {
          const p = e.payload as Omit<AlertData, 'orgId'>;
          const delay = await withTenant(db, e.orgId, async (tx) => {
            const s = await sectionInfo(tx, p.sectionId, p.onDate);
            const [row] = await tx.execute<{ minutes: number }>(sql`
              select alert_delay_minutes as minutes from school_attendance_settings
              where org_id = app_current_org() and institution_id = ${s?.institutionId ?? null}`);
            return row?.minutes ?? 30;
          });
          await deps.schedule(ABSENCE_ALERT, { ...p, orgId: e.orgId }, delay * 60_000);
        },
      },
      {
        name: 'school.attendance.correction-notice',
        queue: 'notifications',
        events: [CORRECTED],
        handle: async (tx, e) => {
          const p = e.payload as { personId: string; onDate: string; sectionId?: string };
          const [student] = await tx.execute<{ name: string }>(sql`
            select legal_name as name from person where org_id = app_current_org() and id = ${p.personId}`);
          await notifyGuardians(tx, {
            studentId: p.personId,
            flag: 'academic_messages',
            kind: 'absence',
            language: 'en',
            title: COPY.en.correctionTitle,
            body: COPY.en.correctionBody(student?.name ?? 'Your child', p.onDate),
            dedupeKey: `absence-correction:${e.id}`,
          });
        },
      },
      {
        name: 'school.attendance.holiday-notice',
        queue: 'notifications',
        events: [HOLIDAY_DECLARED],
        handle: async (tx, e) => {
          const p = e.payload as {
            holidayId: string;
            onDate: string;
            name: string;
            sectionIds: string[];
          };
          for (const sectionId of p.sectionIds) {
            for (const r of await sectionRoster(tx, sectionId, p.onDate)) {
              await notifyGuardians(tx, {
                studentId: r.personId,
                flag: 'academic_messages',
                kind: 'notice',
                language: 'en',
                title: COPY.en.holidayTitle,
                body: COPY.en.holidayBody(p.name, p.onDate),
                dedupeKey: `holiday:${p.holidayId}:${r.personId}`,
              });
            }
          }
        },
      },
    ],
    tasks: [
      {
        name: ABSENCE_ALERT,
        queue: 'notifications',
        run: (db, data) => sendAbsenceAlerts(db, data as AlertData),
      },
    ],
  };
}
