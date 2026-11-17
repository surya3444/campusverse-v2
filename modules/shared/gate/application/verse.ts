// Verse AI (docs/specs/VISITORS_GATE.md): the gate's day as counts. No names or phones leave for
// the model (decision 0015); the Gate page, linked as the source, has detail.
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { checkOut, gateFigures, gateToday, type GateDeps } from './gate.js';

const time = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

export function gateTools(deps: GateDeps): VerseTool[] {
  const inside = async (ctx: Parameters<VerseTool['handler']>[0]) =>
    (await gateToday(deps, ctx.actor, ctx.institutionId)).inside;
  return [
    defineTool({
      name: 'gate.inside',
      description:
        'Visitors inside the school now: visitId, name, purpose, whom they came to meet, how many ' +
        'people, and since when. Use visitId to check someone out.',
      permission: ['gate.visitor.read'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: (await inside(ctx)).map((v) => ({
          visitId: v.visitId,
          name: v.name,
          purpose: v.purpose,
          meeting: v.host,
          people: v.partySize,
          since: v.inAt ? time(v.inAt) : null,
        })),
        sources: [{ label: 'Gate', href: '/gate', asOf: ctx.today }],
      }),
    }),
    defineTool({
      name: 'gate.visitor.check_out',
      description:
        'Prepare checking a visitor out: give their visitId (from gate_inside) or their name. The ' +
        'person confirms on screen.',
      permission: ['gate.visitor.manage'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        visitId: z.string().max(64).optional(),
        name: z.string().max(200).optional(),
      }),
      handler: async (ctx, { visitId, name }) => {
        const list = await inside(ctx);
        const found = pickOne(
          list,
          { id: visitId, text: name },
          (x) => x.visitId,
          (x) => x.name,
        );
        if ('error' in found)
          return {
            data: {
              error: found.error,
              inside: list.map((x) => ({ visitId: x.visitId, name: x.name, purpose: x.purpose })),
            },
          };
        const v = found.row;
        return {
          confirmInput: { visitId: v.visitId },
          data: { prepared: true, name: v.name },
          proposal: {
            title: `Check out ${v.name}`,
            lines: [
              [v.host ? `Came to see ${v.host}` : null, v.inAt ? `in since ${time(v.inAt)}` : null]
                .filter(Boolean)
                .join(', '),
            ].filter(Boolean),
            confirm: 'Check out',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, { visitId }) => {
        if (!visitId) throw new Error('visit_not_found');
        await checkOut(deps, ctx.actor, { institutionId: ctx.institutionId, visitId });
        return { done: 'Checked out.' };
      },
    }),
    defineTool({
      name: 'gate.today',
      description:
        'Today at the gate: visits and people inside now, visitors so far today, visitors still ' +
        'expected today, and early-leave gate passes issued today. Counts only.',
      permission: ['gate.visitor.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: await gateFigures(deps, ctx.actor, ctx.institutionId),
        sources: [{ label: 'Gate', href: '/gate', asOf: ctx.today }],
      }),
    }),
  ];
}
