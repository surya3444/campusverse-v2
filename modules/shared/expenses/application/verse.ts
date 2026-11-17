// Verse AI (docs/specs/EXPENSES.md): this year's spending by category against budget, and what
// waits for approval or payment. Amounts only; no vendor or person names leave for the model.
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { rupees } from '@campusverse/shared-finance';
import { bill, bills, decideBill, expenseSummary, type ExpenseDeps } from './expenses.js';

export function expenseTools(deps: ExpenseDeps): VerseTool[] {
  return [
    defineTool({
      name: 'expenses.bills.waiting',
      description:
        'Bills waiting for approval or approved and waiting to be paid: billId, who is paid, amount, ' +
        'category, what it was for, bill date and who recorded it. Use billId to approve or reject.',
      permission: ['expenses.bill.read'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({ which: z.enum(['waiting', 'to_pay']).default('waiting') }),
      handler: async (ctx, { which }) => ({
        data: (
          await bills(deps, ctx.actor, {
            institutionId: ctx.institutionId,
            view: which,
            search: '',
          })
        ).map((b) => ({
          billId: b.billId,
          payTo: b.payTo,
          amount: rupees(b.amountPaise),
          category: b.category,
          description: b.description,
          billDate: b.billDate,
          recordedBy: b.recordedBy,
        })),
        sources: [{ label: 'Expenses', href: '/expenses', asOf: ctx.today }],
      }),
    }),
    defineTool({
      name: 'expenses.bill.decide',
      description:
        'Prepare approving or rejecting a waiting bill: give its billId (from expenses_bills_waiting) ' +
        'or who is paid (payTo, like "Synthetic Plumber"). Shows the budget position. A rejection ' +
        'needs a short note. The person confirms on screen.',
      permission: ['expenses.bill.approve'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        billId: z.string().max(64).optional(),
        payTo: z.string().max(200).optional(),
        approve: z.boolean(),
        note: z.string().max(300).default(''),
      }),
      handler: async (ctx, { billId, payTo, approve, note }) => {
        const waiting = await bills(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          view: 'waiting',
          search: '',
        });
        const found = pickOne(
          waiting,
          { id: billId, text: payTo },
          (w) => w.billId,
          (w) => `${w.payTo} ${w.description} ${w.category} ${w.billNo}`,
        );
        if ('error' in found)
          return {
            data: {
              error: found.error,
              waiting: waiting.map((w) => ({
                billId: w.billId,
                payTo: w.payTo,
                amount: rupees(w.amountPaise),
                description: w.description,
              })),
            },
          };
        const b = await bill(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          billId: found.row.billId,
        });
        if (b.recordedById === ctx.actor.personId)
          return {
            data: { error: 'This person recorded the bill, so someone else must approve it.' },
          };
        if (!approve && note.trim().length < 3)
          return { data: { error: 'Ask the person why they are rejecting it.' } };
        const p = b.position;
        return {
          confirmInput: { billId: b.billId, approve, note },
          data: {
            prepared: true,
            payTo: b.payTo,
            amount: rupees(b.amountPaise),
            overBudget: p.over,
          },
          proposal: {
            title: `${approve ? 'Approve' : 'Reject'} ${rupees(b.amountPaise)} to ${b.payTo}`,
            lines: [
              `${b.category} · ${b.description}${b.billNo ? ` · bill ${b.billNo}` : ''}`,
              p.budgetPaise === null
                ? 'No budget set for this category'
                : p.over
                  ? `Goes over the ${b.category.toLowerCase()} budget by ${rupees(-(p.leftPaise ?? 0))}`
                  : `${rupees(p.leftPaise ?? 0)} of the budget left after this`,
              ...(approve ? [] : [`Note: ${note.trim()}`]),
            ],
            confirm: approve ? 'Approve' : 'Reject',
            tone: 'money',
          },
        };
      },
      execute: async (ctx, { billId, approve, note }) => {
        if (!billId) throw new Error('bill_not_found');
        await decideBill(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          billId,
          approve,
          note,
        });
        return { done: approve ? 'Bill approved; it waits to be paid.' : 'Bill rejected.' };
      },
    }),
    defineTool({
      name: 'expenses.summary',
      description:
        'School spending this financial year (April to March): committed and paid by category against ' +
        'budget, categories over budget, and bills waiting for approval or payment. Amounts in paise.',
      permission: ['expenses.bill.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: await expenseSummary(deps, ctx.actor, ctx.institutionId),
        sources: [{ label: 'Expenses', href: '/expenses', asOf: ctx.today }],
      }),
    }),
  ];
}
