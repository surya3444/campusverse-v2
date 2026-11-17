// Verse AI (docs/specs/HELPDESK.md): open requests as counts by category, and a reply to a request
// prepared for the person to confirm (decision 0021). Request text stays out of the model's view
// except the subject.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { helpdeskFigures, replyTicket, tickets, type HelpdeskDeps } from './helpdesk.js';

export function helpdeskTools(deps: HelpdeskDeps): VerseTool[] {
  return [
    defineTool({
      name: 'helpdesk.summary',
      description:
        'Help requests at this school: open, overdue, waiting on the requester, resolved this week, ' +
        'and open and overdue by category; plus the open requests with number, subject, category, ' +
        'state, who has it and whether overdue.',
      permission: ['helpdesk.ticket.handle'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({}),
      handler: async (ctx) => {
        const f = await helpdeskFigures(deps, ctx.actor, ctx.institutionId);
        const open = await tickets(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          view: 'open',
        });
        return {
          data: {
            ...f,
            requests: open.slice(0, 30).map((t) => ({
              number: t.number,
              subject: t.subject,
              category: t.category,
              state: t.state,
              assignee: t.assignee,
              overdue: t.overdue,
            })),
          },
          sources: [{ label: 'Helpdesk', href: '/helpdesk', asOf: ctx.today }],
        };
      },
    }),
    defineTool({
      name: 'helpdesk.ticket.reply',
      description:
        'Prepare a reply to an open help request by its number (from helpdesk_summary), optionally ' +
        'marking it resolved. Write the reply the person asked for, plainly. The person confirms on screen.',
      permission: ['helpdesk.ticket.handle'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        number: z.number().int().positive(),
        reply: z.string().trim().min(1).max(2000),
        resolve: z.boolean().default(false),
        ticketId: z.string().max(64).optional(),
      }),
      handler: async (ctx, input) => {
        const open = await tickets(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          view: 'open',
        });
        const t = open.find((x) => x.number === input.number);
        if (!t) return { data: { error: `No open request #${input.number}.` } };
        return {
          confirmInput: { ...input, ticketId: t.ticketId },
          data: { prepared: true, number: t.number, subject: t.subject },
          proposal: {
            title: `Reply to #${t.number}: ${t.subject}`,
            lines: [input.reply, ...(input.resolve ? ['…and mark it resolved'] : [])],
            confirm: input.resolve ? 'Send and resolve' : 'Send reply',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, input) => {
        if (!input.ticketId) throw new Error('ticket_not_found');
        await replyTicket(deps, ctx.actor, {
          ticketId: input.ticketId,
          body: input.reply,
          internal: false,
          state: input.resolve ? 'resolved' : null,
        });
        return { done: input.resolve ? 'Reply sent; resolved.' : 'Reply sent.' };
      },
    }),
  ];
}
