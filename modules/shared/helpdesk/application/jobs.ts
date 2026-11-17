// The helpdesk's messages (docs/specs/HELPDESK.md): the assignee hears of new and assigned
// requests and the requester's replies; the requester hears every public reply and the resolution.
// Internal notes are never sent.
import type { Tx } from '@campusverse/db';
import type { Consumer } from '@campusverse/platform-events';
import { requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { TICKET_ASSIGNED, TICKET_RAISED, TICKET_REPLIED, TICKET_RESOLVED } from './helpdesk.js';

export const COPY = {
  en: {
    newTitle: (n: number) => `New help request #${n}`,
    assignedTitle: (n: number) => `Help request #${n} is yours`,
    replyTitle: (n: number) => `Reply to your request #${n}`,
    answerTitle: (n: number) => `The requester replied on #${n}`,
    resolvedTitle: (n: number) => `Request #${n} is resolved`,
    resolvedBody: (subject: string) => `"${subject}" is resolved. Reply within 7 days if it isn't.`,
  },
} as const;

async function about(tx: Tx, ticketId: string) {
  const [t] = await tx.execute<{
    number: number;
    subject: string;
    raisedBy: string;
    assignee: string | null;
    student: string | null;
    last: string | null;
  }>(sql`
    select t.number, t.subject, t.raised_by_person_id::text as "raisedBy",
      t.assignee_person_id::text as assignee, t.student_person_id::text as student,
      (select body from helpdesk_message m where m.org_id = t.org_id and m.ticket_id = t.id and not m.internal
        order by created_at desc limit 1) as last
    from helpdesk_ticket t where t.org_id = app_current_org() and t.id = ${ticketId}`);
  return t;
}
const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 297)}…` : s);

export function helpdeskJobs(): Consumer[] {
  return [
    {
      name: 'helpdesk.tell-people',
      queue: 'notifications',
      events: [TICKET_RAISED, TICKET_ASSIGNED, TICKET_REPLIED, TICKET_RESOLVED],
      handle: async (tx, e) => {
        const p = e.payload as { ticketId: string; byRequester?: boolean; personId?: string };
        const t = await about(tx, p.ticketId);
        if (!t) return;
        const send = (to: string | null, title: string, body: string) =>
          to
            ? requestMessage(tx, {
                recipientPersonId: to,
                kind: 'helpdesk',
                language: 'en',
                title,
                body,
                aboutPersonId: to === t.raisedBy ? t.student : null,
                dedupeKey: `helpdesk:${e.id}:${to}`,
              })
            : null;
        if (e.type === TICKET_RAISED) await send(t.assignee, COPY.en.newTitle(t.number), t.subject);
        if (e.type === TICKET_ASSIGNED)
          await send(p.personId ?? t.assignee, COPY.en.assignedTitle(t.number), t.subject);
        if (e.type === TICKET_REPLIED)
          await (p.byRequester
            ? send(t.assignee, COPY.en.answerTitle(t.number), clip(t.last ?? t.subject))
            : send(t.raisedBy, COPY.en.replyTitle(t.number), clip(t.last ?? t.subject)));
        if (e.type === TICKET_RESOLVED)
          await send(t.raisedBy, COPY.en.resolvedTitle(t.number), COPY.en.resolvedBody(t.subject));
      },
    },
  ];
}
