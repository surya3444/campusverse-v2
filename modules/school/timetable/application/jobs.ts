// Tells the covering teacher (and the absent one, when the class is combined or supervised
// there's nobody to tell). Runs once per cover.
import type { Consumer } from '@campusverse/platform-events';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { COVER_ASSIGNED } from './cover.js';

export function coverJobs(): Consumer[] {
  return [
    {
      name: 'school.cover.tell-teacher',
      queue: 'notifications',
      events: [COVER_ASSIGNED],
      handle: async (tx, e) => {
        const p = e.payload as { coverId: string };
        const [c] = await tx.execute<{
          personId: string | null;
          section: string;
          subject: string;
          ordinal: number;
          startsAt: string;
          date: string;
          absent: string;
          note: string | null;
        }>(sql`
          select c.covering_person_id::text as "personId", coalesce(cl.name || '-' || sec.name, g.name) as section,
            sub.name as subject,
            (select count(*)::int from school_timetable_period x where x.org_id = c.org_id
              and x.timetable_id = s.timetable_id and x.kind = 'class' and x.number <= s.period) as ordinal,
            to_char(per.starts_at, 'FMHH12:MI am') as "startsAt",
            to_char(c.cover_date, 'FMDD Mon') as date, ab.legal_name as absent, c.note
          from school_cover c
          join school_timetable_slot s on s.org_id = c.org_id and s.id = c.slot_id
          join school_timetable_period per on per.org_id = s.org_id and per.timetable_id = s.timetable_id
            and per.number = s.period
          left join school_section sec on sec.org_id = s.org_id and sec.id = s.section_id
          left join school_class cl on cl.org_id = sec.org_id and cl.id = sec.class_id
          left join school_timetable_group g on g.org_id = s.org_id and g.id = s.group_id
          join school_subject sub on sub.org_id = s.org_id and sub.id = s.subject_id
          join person ab on ab.org_id = c.org_id and ab.id = c.absent_person_id
          where c.org_id = app_current_org() and c.id = ${p.coverId} and c.cancelled_at is null`);
        if (!c?.personId) return;
        await requestMessage(tx, {
          recipientPersonId: c.personId,
          kind: 'notice',
          language: 'en',
          title: `Cover: ${c.section} ${c.subject}, period ${c.ordinal}`,
          body: `Please take ${c.section} for ${c.subject} on ${c.date}, period ${c.ordinal} (${c.startsAt}), for ${c.absent}.${c.note ? ` ${c.note}` : ''}`,
          dedupeKey: `cover:${p.coverId}`,
        });
      },
    },
  ];
}
