// Verse AI (decision 0021): return and issue books by accession number, prepared for the person
// to confirm. Names of borrowers only; the Library page, linked as the source, has detail.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { issueBook, issuePreview, returnBook, returnPreview, type LibraryDeps } from './library.js';

const rupees = (p: number) => `₹${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
const PROBLEM: Record<string, string> = {
  copy_not_found: 'No copy with that accession number here.',
  not_on_loan: 'That copy is not on loan.',
  copy_not_available: 'That copy is not on the shelf.',
  not_a_member: 'That person is not a student or staff member of this school.',
  limit_reached: 'They already have as many books as they may borrow.',
};
const Accession = z.string().regex(/^[A-Za-z0-9/-]{1,20}$/);

export function libraryTools(deps: LibraryDeps): VerseTool[] {
  return [
    defineTool({
      name: 'library.loan.return',
      description:
        'Prepare taking a library book back by its accession number (like ACC-0042). Shows who has ' +
        'it and any fine for returning late. The person confirms on screen.',
      permission: ['library.book.manage'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({ accessionNo: Accession }),
      handler: async (ctx, { accessionNo }) => {
        const p = await returnPreview(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          accessionNo,
        });
        if (!p.ok) return { data: { error: PROBLEM[p.problem] } };
        return {
          data: { prepared: true, title: p.title, borrower: p.borrower, daysLate: p.daysLate },
          proposal: {
            title: `Return ${p.title}`,
            lines: [
              `${accessionNo.toUpperCase()} from ${p.borrower}`,
              p.daysLate > 0
                ? `${p.daysLate} day${p.daysLate === 1 ? '' : 's'} late${p.finePaise ? ` · fine ${rupees(p.finePaise)} recorded` : ''}`
                : 'On time',
            ],
            confirm: 'Return',
            tone: p.finePaise ? 'money' : 'normal',
          },
          sources: [{ label: 'Library', href: '/library', asOf: ctx.today }],
        };
      },
      execute: async (ctx, { accessionNo }) => {
        const r = await returnBook(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          accessionNo,
        });
        return {
          done: `${r.title} returned by ${r.borrower}.${r.finePaise ? ` Fine ${rupees(r.finePaise)} recorded.` : ''}`,
        };
      },
    }),
    defineTool({
      name: 'library.loan.issue',
      description:
        'Prepare issuing a library book by accession number to a student or staff member (personId ' +
        'from people_find). Shows the due date. The person confirms on screen.',
      permission: ['library.book.manage'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({ accessionNo: Accession, personId: z.uuid() }),
      handler: async (ctx, input) => {
        const p = await issuePreview(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          ...input,
        });
        if (!p.ok) return { data: { error: PROBLEM[p.problem] } };
        return {
          data: { prepared: true, title: p.title, borrower: p.borrower, dueOn: p.dueOn },
          proposal: {
            title: `Issue ${p.title} to ${p.borrower}`,
            lines: [
              `${input.accessionNo.toUpperCase()} · due back ${p.dueOn}`,
              ...(p.overdue
                ? [`They already have ${p.overdue} overdue book${p.overdue === 1 ? '' : 's'}.`]
                : []),
            ],
            confirm: 'Issue',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, input) => {
        const r = await issueBook(deps, ctx.actor, { institutionId: ctx.institutionId, ...input });
        return { done: `${r.title} issued to ${r.borrower}, due ${r.dueOn}.` };
      },
    }),
  ];
}
