// Verse AI tools for attendance, through the module's own use cases, so a teacher's answer and
// actions cover only their own sections. Correcting a day and deciding a parent's leave request
// are prepared for the person to confirm (decision 0021); names only, never health details.
import { withTenant } from '@campusverse/db';
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CORRECTABLE } from '../domain/attendance.js';
import type { AttendanceDeps } from './common.js';
import { decideLeave, pendingLeave } from './leave.js';
import { attendanceDay, correctAttendance } from './marking.js';

const WORDS: Record<string, string> = {
  present: 'present',
  absent: 'absent',
  late: 'late',
  half_day: 'half day',
  school_duty: 'on school duty',
  approved_leave: 'on leave',
  medical_leave: 'on medical leave',
};

export function attendanceTools(deps: AttendanceDeps): VerseTool[] {
  const leaveList = (ctx: Parameters<VerseTool['handler']>[0]) =>
    pendingLeave(deps, ctx.actor, ctx.institutionId);
  return [
    defineTool({
      name: 'school.attendance.correct',
      description:
        "Prepare correcting one student's attendance on a day already marked (personId from " +
        'people_find; date defaults to today): present, absent, late, half_day, school_duty, ' +
        'approved_leave or medical_leave, with a short reason. The person confirms on screen.',
      permission: ['school.attendance.mark'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        personId: z.uuid(),
        date: z.iso.date().optional(),
        status: z.enum(CORRECTABLE as unknown as [string, ...string[]]),
        reason: z.string().max(300).default(''),
      }),
      handler: async (ctx, { personId, date, status, reason }) => {
        const onDate = date ?? ctx.today;
        if (reason.trim().length < 3)
          return { data: { error: 'Ask the person for a short reason for the correction.' } };
        const [day] = await withTenant(deps.db, ctx.actor.orgId, (tx) =>
          tx.execute<{ status: string; name: string }>(sql`
            select d.status, p.legal_name as name from school_attendance_day d
            join person p on p.org_id = d.org_id and p.id = d.person_id
            where d.org_id = app_current_org() and d.person_id = ${personId} and d.on_date = ${onDate}::date`),
        );
        if (!day)
          return { data: { error: `Attendance for that student isn't marked on ${onDate}.` } };
        if (day.status === status) return { data: { error: `They are already ${WORDS[status]}.` } };
        return {
          confirmInput: { personId, date: onDate, status, reason },
          data: { prepared: true, name: day.name, from: day.status, to: status, date: onDate },
          proposal: {
            title: `Mark ${day.name} ${WORDS[status] ?? status} on ${onDate}`,
            lines: [
              `Was ${WORDS[day.status] ?? day.status}`,
              `Reason: ${reason.trim()}`,
              'The original mark stays in the history.',
            ],
            confirm: 'Correct',
            tone: 'normal',
          },
          sources: [{ label: 'Attendance', href: '/attendance', asOf: onDate }],
        };
      },
      execute: async (ctx, { personId, date, status, reason }) => {
        await correctAttendance(deps, ctx.actor, {
          personId,
          onDate: date ?? ctx.today,
          status: status as (typeof CORRECTABLE)[number],
          reason,
        });
        return { done: 'Attendance corrected.' };
      },
    }),
    defineTool({
      name: 'school.leave.waiting',
      description:
        'Leave requests from parents for their children, waiting for a decision: leaveId, student, ' +
        'class, leave or medical, from and to dates.',
      permission: ['school.attendance.leave_decide'],
      risk: 'read',
      dataClasses: ['names'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: (await leaveList(ctx))
          .filter((l) => l.status === 'pending')
          .map((l) => ({
            leaveId: l.id,
            student: l.studentName,
            class: l.sectionLabel,
            kind: l.kind,
            from: l.from,
            to: l.to,
          })),
        sources: [{ label: 'Attendance', href: '/attendance', asOf: ctx.today }],
      }),
    }),
    defineTool({
      name: 'school.leave.decide',
      description:
        "Prepare approving or rejecting a parent's leave request for their child: give the leaveId " +
        "(from school_leave_waiting) or the student's name. A rejection needs a short note for the " +
        'parent. The person confirms on screen.',
      permission: ['school.attendance.leave_decide'],
      risk: 'act',
      dataClasses: ['names'],
      input: z.object({
        leaveId: z.string().max(64).optional(),
        student: z.string().max(200).optional(),
        approve: z.boolean(),
        note: z.string().max(300).default(''),
      }),
      handler: async (ctx, { leaveId, student, approve, note }) => {
        const list = (await leaveList(ctx)).filter((l) => l.status === 'pending');
        const found = pickOne(
          list,
          { id: leaveId, text: student },
          (l) => l.id,
          (l) => `${l.studentName} ${l.sectionLabel}`,
        );
        if ('error' in found)
          return {
            data: {
              error: found.error,
              waiting: list.map((l) => ({
                leaveId: l.id,
                student: l.studentName,
                from: l.from,
                to: l.to,
              })),
            },
          };
        if (!approve && note.trim().length < 3)
          return { data: { error: 'Ask the person for a short note for the parent.' } };
        const l = found.row;
        const dates = l.from === l.to ? l.from : `${l.from} to ${l.to}`;
        return {
          confirmInput: { leaveId: l.id, approve, note },
          data: { prepared: true, student: l.studentName, dates },
          proposal: {
            title: `${approve ? 'Approve' : 'Reject'} ${l.studentName}'s ${l.kind === 'medical' ? 'medical leave' : 'leave'}`,
            lines: [
              `${l.sectionLabel} · ${dates}`,
              approve
                ? 'Those days are marked on leave; the parent is told.'
                : `Note to the parent: ${note.trim()}`,
            ],
            confirm: approve ? 'Approve' : 'Reject',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, { leaveId, approve, note }) => {
        if (!leaveId) throw new Error('leave_not_found');
        await decideLeave(deps, ctx.actor, { leaveId, approve, note: note.trim() || null });
        return { done: approve ? 'Leave approved.' : 'Leave rejected.' };
      },
    }),
    defineTool({
      name: 'school.attendance.today',
      description:
        'Which sections have and have not marked attendance today (or on a given date), with absence counts and any holiday.',
      permission: ['school.attendance.read', 'school.attendance.mark'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ date: z.iso.date().optional() }),
      handler: async (ctx, { date }) => {
        const day = await attendanceDay(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          onDate: date,
        });
        const by = (state: string) =>
          day.sections.filter((s) => s.state === state).map((s) => s.label);
        return {
          data: {
            date: day.onDate,
            holiday: day.holiday,
            scope: day.seesAll ? 'whole school' : 'your sections only',
            notMarked: by('not_taken'),
            marked: [...by('submitted'), ...by('signed_off')],
            absentToday: day.sections.reduce((n, s) => n + s.absent, 0),
          },
          sources: [{ label: 'Attendance', href: '/attendance', asOf: day.onDate }],
        };
      },
    }),
  ];
}
