// Mentoring's messages (rule book §16.4 step 5): an escalation reaches the head of department or
// the counsellor with the mentor's reason; a parent hears only a template asking them to talk to
// the mentor, never the notes or the reason. Restricted guardians hear nothing.
import type { Consumer } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import { holdersAt } from '@campusverse/platform-permissions';
import { displayNames } from '@campusverse/people-records';
import { notifyGuardians, requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { ESCALATION_RAISED } from './mentoring.js';

export const COPY = {
  en: {
    staffTitle: (student: string) => `Mentor concern: ${student}`,
    staffBody: (mentor: string, student: string, reason: string) =>
      `${mentor} raised a concern about ${student}: "${reason}". Open Mentoring › Escalations.`,
    parentTitle: (student: string) => `Please talk to ${student}'s mentor`,
    parentBody: (mentor: string, student: string) =>
      `${mentor}, ${student}'s mentor at school, would like to talk with you. Please call the school or reply in the app to set a time.`,
  },
} as const;

export function mentoringJobs(): Consumer[] {
  return [
    {
      name: 'mentoring.escalation.tell',
      queue: 'notifications',
      events: [ESCALATION_RAISED],
      handle: async (tx, e) => {
        const p = e.payload as {
          escalationId: string;
          institutionId: string;
          studentId: string;
          to: 'hod' | 'counsellor' | 'parent';
          raisedBy: string;
        };
        const [row] = await tx.execute<{ reason: string }>(sql`
          select reason from mentor_escalation where org_id = app_current_org() and id = ${p.escalationId}`);
        const place = await placeOf(tx, p.institutionId);
        if (!row || !place) return;
        const names = await displayNames(tx, [p.studentId, p.raisedBy]);
        const student = names[p.studentId] ?? 'a student';
        const mentor = names[p.raisedBy] ?? 'The mentor';
        if (p.to === 'parent') {
          await notifyGuardians(tx, {
            studentId: p.studentId,
            flag: null,
            kind: 'notice',
            language: 'en',
            title: COPY.en.parentTitle(student),
            body: COPY.en.parentBody(mentor, student),
            dedupeKey: `mentoring-escalation:${p.escalationId}`,
          });
          return;
        }
        const permission =
          p.to === 'counsellor' ? 'mentoring.escalation.counsel' : 'mentoring.allocation.manage';
        for (const id of await holdersAt(tx, permission, place.campusId))
          if (id !== p.raisedBy)
            await requestMessage(tx, {
              recipientPersonId: id,
              kind: 'notice',
              language: 'en',
              title: COPY.en.staffTitle(student),
              body: COPY.en.staffBody(mentor, student, row.reason),
              dedupeKey: `mentoring-escalation:${p.escalationId}:${id}`,
            });
      },
    },
  ];
}
