// Verse AI tools for fees. Totals by age only; who owes is never sent to the model.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { rupees } from '../domain/money.js';
import type { FinanceDeps } from './common.js';
import { dues, previewReminders, sendReminders } from './office.js';

export function financeTools(deps: FinanceDeps): VerseTool[] {
  return [
    defineTool({
      name: 'finance.reminders.send',
      description:
        'Prepare sending fee reminders to the guardians of every student whose fees are overdue by at ' +
        'least minDaysOverdue days (default 7). Shows how many students and how much. Guardians who ' +
        'turned fee messages off are skipped; each student gets one reminder a day at most. The ' +
        'person confirms on screen.',
      permission: ['finance.invoice.issue'],
      risk: 'act',
      dataClasses: ['operational'],
      input: z.object({ minDaysOverdue: z.number().int().min(1).max(365).default(7) }),
      handler: async (ctx, { minDaysOverdue }) => {
        const p = await previewReminders(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          minDaysOverdue,
        });
        if (p.students === 0)
          return { data: { error: `No fees are overdue by ${minDaysOverdue} days or more.` } };
        return {
          data: { prepared: true, students: p.students, overdue: rupees(p.overduePaise) },
          proposal: {
            title: `Send fee reminders for ${p.students} student${p.students === 1 ? '' : 's'}`,
            lines: [
              `${rupees(p.overduePaise)} overdue by ${minDaysOverdue} days or more`,
              'Guardians get the reminder in the app, then WhatsApp; those who turned fee messages off are skipped.',
              'Each student is reminded once a day at most.',
            ],
            confirm: 'Send reminders',
            tone: 'money',
          },
          sources: [{ label: 'Fees: dues', href: '/fees', asOf: ctx.today }],
        };
      },
      execute: async (ctx, { minDaysOverdue }) => {
        const r = await sendReminders(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          minDaysOverdue,
        });
        return {
          done: `Reminders sent for ${r.students} student${r.students === 1 ? '' : 's'} (${r.messages} message${r.messages === 1 ? '' : 's'}).`,
        };
      },
    }),
    defineTool({
      name: 'finance.dues.summary',
      description:
        'Overdue fees for the school today: number of students and amount in rupees, by how long overdue.',
      permission: ['finance.invoice.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const d = await dues(deps, ctx.actor, ctx.institutionId);
        const buckets = Object.entries(d.buckets).map(([age, b]) => ({
          overdue: age,
          students: b.students,
          amount: rupees(b.paise),
        }));
        const total = Object.values(d.buckets).reduce((n, b) => n + b.paise, 0);
        return {
          data: { date: d.onDate, totalOverdue: rupees(total), buckets },
          sources: [{ label: 'Fees: dues', href: '/fees', asOf: d.onDate }],
        };
      },
    }),
  ];
}
