// Grievances' messages: committee members hear a case number arrived (never its subject or
// details); the raiser hears when it is decided or closed and where to read the outcome.
import type { Consumer } from '@campusverse/platform-events';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { CASE_DECIDED, CASE_RAISED } from './grievances.js';

export const COPY = {
  en: {
    newTitle: (committee: string, n: number) => `New case ${n}: ${committee}`,
    newBody: (committee: string, n: number) =>
      `Case ${n} has been raised with the ${committee}. Open Grievances to read it.`,
    decidedTitle: (committee: string, n: number) => `Your case ${n} has an outcome`,
    decidedBody: (committee: string, n: number) =>
      `The ${committee} has recorded an outcome for your case ${n}. Read it in Grievances; you may appeal within 30 days.`,
  },
} as const;

export function grievanceJobs(): Consumer[] {
  return [
    {
      name: 'grievance.case.tell',
      queue: 'notifications',
      events: [CASE_RAISED, CASE_DECIDED],
      handle: async (tx, e) => {
        const { caseId } = e.payload as { caseId: string };
        const [c] = await tx.execute<{
          committeeId: string;
          committee: string;
          n: number;
          by: string;
        }>(sql`
          select c.committee_id::text as "committeeId", g.name as committee, c.number as n,
            c.raised_by_person_id::text as by
          from grievance_case c join grievance_committee g on g.org_id = c.org_id and g.id = c.committee_id
          where c.org_id = app_current_org() and c.id = ${caseId}`);
        if (!c) return;
        if (e.type === CASE_RAISED) {
          const members = await tx.execute<{ id: string }>(sql`
            select person_id::text as id from grievance_member
            where org_id = app_current_org() and committee_id = ${c.committeeId} and active and person_id is not null`);
          for (const m of members)
            if (m.id !== c.by)
              await requestMessage(tx, {
                recipientPersonId: m.id,
                kind: 'notice',
                language: 'en',
                title: COPY.en.newTitle(c.committee, c.n),
                body: COPY.en.newBody(c.committee, c.n),
                dedupeKey: `grievance-new:${caseId}:${m.id}`,
              });
          return;
        }
        await requestMessage(tx, {
          recipientPersonId: c.by,
          kind: 'notice',
          language: 'en',
          title: COPY.en.decidedTitle(c.committee, c.n),
          body: COPY.en.decidedBody(c.committee, c.n),
          dedupeKey: `grievance-decided:${caseId}:${e.id}`,
        });
      },
    },
  ];
}
