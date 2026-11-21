// Health Connect's messages: whoever runs the privacy console (the Data Protection Officer) hears
// at once when a student's emergency health details are opened (rule book §10.3 break-glass).
// The message names who, whom, when and why; never any health detail.
import type { Consumer } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import { holdersAt } from '@campusverse/platform-permissions';
import { displayNames, pickupGuardians } from '@campusverse/people-records';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { HEALTH_SOS_RAISED } from './emergency.js';
import { HEALTH_BREAK_GLASS_OPENED } from './health.js';

export const COPY = {
  en: {
    breakGlassTitle: 'Emergency access to a health record',
    breakGlassBody: (who: string, whom: string, at: string, reason: string) =>
      `${who} opened ${whom}'s emergency health details at ${at}: "${reason}". Review it in the Activity Log.`,
    sosTitle: 'SOS: emergency on campus',
    sosBody: (who: string, kind: string, where: string, whom: string | null) =>
      `${who} raised an SOS (${kind}) at ${where}${whom ? ` for ${whom}` : ''}. Open Health › Emergencies.`,
    familyTitle: 'The school is responding to an emergency',
    familyBody: (child: string) =>
      `An emergency involving ${child} is being handled at school right now. Staff will call you shortly.`,
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
    {
      // Leaders and the nurse hear at once; the family hears that the school is responding,
      // never a health detail. Restricted guardians hear nothing (rule book §16.5 step 3).
      name: 'health.sos-alert',
      queue: 'notifications',
      events: [HEALTH_SOS_RAISED],
      handle: async (tx, e) => {
        const p = e.payload as {
          incidentId: string;
          institutionId: string;
          studentId: string | null;
          raisedBy: string;
        };
        const [i] = await tx.execute<{ kind: string; location: string }>(sql`
          select kind, location from health_incident where org_id = app_current_org() and id = ${p.incidentId}`);
        const place = await placeOf(tx, p.institutionId);
        if (!i || !place) return;
        const names = await displayNames(tx, [p.raisedBy, ...(p.studentId ? [p.studentId] : [])]);
        const body = COPY.en.sosBody(
          names[p.raisedBy] ?? 'A staff member',
          i.kind.replace('_', ' '),
          i.location,
          p.studentId ? (names[p.studentId] ?? null) : null,
        );
        for (const id of await holdersAt(tx, 'health.emergency.manage', place.campusId))
          if (id !== p.raisedBy)
            await requestMessage(tx, {
              recipientPersonId: id,
              kind: 'urgent',
              language: 'en',
              title: COPY.en.sosTitle,
              body,
              dedupeKey: `health-sos:${p.incidentId}:${id}`,
            });
        if (!p.studentId) return;
        for (const g of await pickupGuardians(tx, p.studentId))
          if (!g.restricted)
            await requestMessage(tx, {
              recipientPersonId: g.personId,
              kind: 'urgent',
              language: 'en',
              title: COPY.en.familyTitle,
              body: COPY.en.familyBody(names[p.studentId] ?? 'your child'),
              dedupeKey: `health-sos-family:${p.incidentId}:${g.personId}`,
              aboutPersonId: p.studentId,
            });
      },
    },
  ];
}
