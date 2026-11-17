// Verse AI: who is in today, and staff leave, as counts (no names, decision 0015), for people
// who see the staff register or keep leave.
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import type { Db } from '@campusverse/db';
import type { createPermissions } from '@campusverse/platform-permissions';
import { register } from './attendance.js';
import { decideLeave, leaveRequests, type HolidaysPort } from './leave.js';

export function staffAttendanceTools(deps: {
  db: Db;
  permissions: ReturnType<typeof createPermissions>;
  /** School holidays, so approving leave writes the right days (school: holidaysBetween). */
  holidays?: HolidaysPort | undefined;
}): VerseTool[] {
  const waiting = async (ctx: Parameters<VerseTool['handler']>[0]) => {
    const r = await leaveRequests(deps.db, deps.permissions, ctx.actor, ctx.institutionId);
    return r.requests.filter((q) => q.state === 'pending');
  };
  return [
    defineTool({
      name: 'staff.leave.waiting',
      description:
        'Staff leave requests waiting for a decision: requestId, staff name, leave type, from and to ' +
        'dates, days and reason.',
      permission: ['staff.leave.approve'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: (await waiting(ctx)).map((q) => ({
          requestId: q.id,
          name: q.name,
          type: q.typeCode,
          from: q.from,
          to: q.to,
          days: q.days,
          reason: q.reason,
        })),
        sources: [{ label: 'Staff leave', href: '/staff-leave', asOf: ctx.today }],
      }),
    }),
    defineTool({
      name: 'staff.leave.decide',
      description:
        'Prepare approving or refusing a waiting staff leave request: give its requestId (from ' +
        "staff_leave_waiting) or the staff member's name. The person confirms on screen; a refusal " +
        'needs a short note.',
      permission: ['staff.leave.approve'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        requestId: z.string().max(64).optional(),
        name: z.string().max(200).optional(),
        approve: z.boolean(),
        note: z.string().max(300).default(''),
      }),
      handler: async (ctx, { requestId, name, approve, note }) => {
        const list = await waiting(ctx);
        const found = pickOne(
          list,
          { id: requestId, text: name },
          (x) => x.id,
          (x) => `${x.name} ${x.typeCode} ${x.reason}`,
        );
        if ('error' in found)
          return {
            data: {
              error: found.error,
              waiting: list.map((x) => ({ requestId: x.id, name: x.name, from: x.from, to: x.to })),
            },
          };
        const q = found.row;
        if (q.personId === ctx.actor.personId)
          return { data: { error: 'Nobody decides their own leave.' } };
        if (!approve && note.trim().length < 3)
          return { data: { error: 'Ask the person for a short reason for refusing.' } };
        const dates = q.from === q.to ? q.from : `${q.from} to ${q.to}`;
        return {
          confirmInput: { requestId: q.id, approve, note },
          data: { prepared: true, name: q.name, dates, days: q.days },
          proposal: {
            title: `${approve ? 'Approve' : 'Refuse'} ${q.name}'s ${q.typeCode} leave`,
            lines: [
              `${dates} · ${q.days} day${q.days === 1 ? '' : 's'}`,
              q.reason ? `Reason: ${q.reason}` : '',
              approve
                ? 'The staff register is marked on leave for these days.'
                : `Note to them: ${note.trim()}`,
            ].filter(Boolean),
            confirm: approve ? 'Approve' : 'Refuse',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, { requestId, approve, note }) => {
        if (!requestId) throw new Error('request_not_found');
        await decideLeave(deps.db, deps.permissions, deps.holidays ?? (async () => []), ctx.actor, {
          requestId,
          approve,
          note: note.trim() || null,
        });
        return { done: approve ? 'Leave approved.' : 'Leave refused.' };
      },
    }),
    defineTool({
      name: 'staff.attendance.today',
      description:
        'How many staff are in today (or on a date), late, absent, on leave or duty, and not in yet. Counts only.',
      permission: ['staff.attendance.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ date: z.iso.date().optional() }),
      handler: async (ctx, { date }) => {
        const on = date ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
        const r = await register(deps.db, deps.permissions, ctx.actor, ctx.institutionId, on);
        const n = (f: (s: (typeof r.staff)[number]) => boolean) => r.staff.filter(f).length;
        return {
          data: {
            date: on,
            staff: r.staff.length,
            present: n((s) => s.day?.status === 'present' || s.day?.status === 'half_day'),
            late: n((s) => !!s.day?.late),
            absent: n((s) => s.day?.status === 'absent'),
            onLeaveOrDuty: n((s) => s.day?.status === 'on_leave' || s.day?.status === 'on_duty'),
            notInYet: n((s) => !s.day),
            checkedInOffCampus: n((s) => s.offCampus),
          },
          sources: [{ label: 'Staff attendance', href: '/staff-attendance', asOf: on }],
        };
      },
    }),
    defineTool({
      name: 'staff.leave.today',
      description:
        'How many staff are on approved leave today (or on a date), how many will be in the next 7 days, and how many leave requests are waiting for a decision. Counts only.',
      permission: ['staff.leave.manage', 'staff.leave.approve'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ date: z.iso.date().optional() }),
      handler: async (ctx, { date }) => {
        const on = date ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
        const week = new Date(Date.parse(`${on}T00:00:00Z`) + 6 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const r = await leaveRequests(deps.db, deps.permissions, ctx.actor, ctx.institutionId);
        const approved = r.requests.filter((x) => x.state === 'approved');
        const people = (from: string, to: string) =>
          new Set(approved.filter((x) => x.from <= to && x.to >= from).map((x) => x.personId)).size;
        return {
          data: {
            date: on,
            onLeave: people(on, on),
            onLeaveNext7Days: people(on, week),
            waitingForDecision: r.requests.filter((x) => x.state === 'pending').length,
          },
          sources: [{ label: 'Staff leave', href: '/staff-leave', asOf: on }],
        };
      },
    }),
  ];
}
