// Health Connect's messages: whoever runs the privacy console (the Data Protection Officer) hears
// at once when a student's emergency health details are opened (rule book §10.3 break-glass).
// The message names who, whom, when and why; never any health detail.
import type { Consumer } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import { holdersAt } from '@campusverse/platform-permissions';
import { displayNames } from '@campusverse/people-records';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { HEALTH_BREAK_GLASS_OPENED } from './health.js';

export const COPY = {
  en: {
    breakGlassTitle: 'Emergency access to a health record',
    breakGlassBody: (who: string, whom: string, at: string, reason: string) =>
      `${who} opened ${whom}'s emergency health details at ${at}: "${reason}". Review it in the Activity Log.`,
  },
} as const;

export function healthJobs(): Consumer[] {
  return [
    {
      name: 'health.tell-dpo',
      queue: 'notifications',
      events: [HEALTH_BREAK_GLASS_OPENED],
      handle: async (tx, e) => {
        const p = e.payload as {
          breakGlassId: string;
          studentId: string;
          openedBy: string;
          institutionId: string;
        };
        const [b] = await tx.execute<{ reason: string; at: string }>(sql`
          select reason, to_char(opened_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, FMHH12:MI am') as at
          from health_break_glass where org_id = app_current_org() and id = ${p.breakGlassId}`);
        const place = await placeOf(tx, p.institutionId);
        if (!b || !place) return;
        const names = await displayNames(tx, [p.studentId, p.openedBy]);
        const body = COPY.en.breakGlassBody(
          names[p.openedBy] ?? 'Someone',
          names[p.studentId] ?? 'a student',
          b.at,
          b.reason,
        );
        for (const id of await holdersAt(tx, 'platform.privacy.manage', place.campusId))
          await requestMessage(tx, {
            recipientPersonId: id,
            kind: 'urgent',
            language: 'en',
            title: COPY.en.breakGlassTitle,
            body,
            dedupeKey: `health-break-glass:${e.id}:${id}`,
          });
      },
    },
  ];
}
