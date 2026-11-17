// Verse AI (docs/specs/HOSTEL.md): the hostel today as counts. No names leave for the model
// (decision 0015); the Hostel page, linked as the source, has detail.
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { decideOutpass, hostelFigures, outpasses, type HostelDeps } from './hostel.js';

export function hostelTools(deps: HostelDeps): VerseTool[] {
  const requested = (ctx: Parameters<VerseTool['handler']>[0]) =>
    outpasses(deps, ctx.actor, { institutionId: ctx.institutionId, view: 'requested' });
  return [
    defineTool({
      name: 'hostel.outpasses.waiting',
      description:
        'Outpass requests waiting for the warden: outpassId, student, class, room, leaving and back-by ' +
        'dates, reason, who collects and whether a parent asked in the app.',
      permission: ['hostel.resident.read'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: (await requested(ctx)).map((o) => ({
          outpassId: o.outpassId,
          student: o.student,
          class: o.label,
          room: o.room,
          leavesOn: o.leavesOn,
          backBy: o.backBy,
          reason: o.reason,
          collector: `${o.collector} (${o.relation})`,
          askedByParent: o.byParent,
        })),
        sources: [{ label: 'Hostel', href: '/hostel', asOf: ctx.today }],
      }),
    }),
    defineTool({
      name: 'hostel.outpass.decide',
      description:
        'Prepare approving or rejecting an outpass request: give its outpassId (from ' +
        "hostel_outpasses_waiting) or the student's name. A rejection needs a short note for the " +
        'parent. The person confirms on screen.',
      permission: ['hostel.outpass.decide'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        outpassId: z.string().max(64).optional(),
        student: z.string().max(200).optional(),
        approve: z.boolean(),
        note: z.string().max(300).default(''),
      }),
      handler: async (ctx, { outpassId, student, approve, note }) => {
        const list = await requested(ctx);
        const found = pickOne(
          list,
          { id: outpassId, text: student },
          (x) => x.outpassId,
          (x) => `${x.student} ${x.reason} ${x.collector}`,
        );
        if ('error' in found)
          return {
            data: {
              error: found.error,
              waiting: list.map((x) => ({
                outpassId: x.outpassId,
                student: x.student,
                leavesOn: x.leavesOn,
                reason: x.reason,
              })),
            },
          };
        const o = found.row;
        if (!approve && note.trim().length < 3)
          return { data: { error: 'Ask the person for a short note for the parent.' } };
        const dates = o.leavesOn === o.backBy ? o.leavesOn : `${o.leavesOn} to ${o.backBy}`;
        return {
          confirmInput: { outpassId: o.outpassId, approve, note },
          data: { prepared: true, student: o.student, dates },
          proposal: {
            title: `${approve ? 'Approve' : 'Reject'} ${o.student}'s outpass`,
            lines: [
              `${dates} · ${o.reason}`,
              `Collected by ${o.collector} (${o.relation.toLowerCase()})`,
              approve ? 'The parent is told.' : `Note to the parent: ${note.trim()}`,
            ],
            confirm: approve ? 'Approve' : 'Reject',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, { outpassId, approve, note }) => {
        if (!outpassId) throw new Error('outpass_not_found');
        await decideOutpass(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          outpassId,
          approve,
          note,
        });
        return { done: approve ? 'Outpass approved; the parent is told.' : 'Outpass rejected.' };
      },
    }),
    defineTool({
      name: 'hostel.today',
      description:
        'The hostel today: residents, free beds, children out on an outpass and how many are overdue, ' +
        'outpass requests waiting, and how many were absent at the last roll call. Counts only.',
      permission: ['hostel.resident.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: await hostelFigures(deps, ctx.actor, ctx.institutionId),
        sources: [{ label: 'Hostel', href: '/hostel', asOf: ctx.today }],
      }),
    }),
  ];
}
