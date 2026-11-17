// Verse AI (Milestone 19 step 3): the asker's own lessons and the day's cover picture, and how
// many teachers are free in a period. No names leave for the model (decision 0015): the Cover
// tab, linked as the source, shows who.
import type { Db } from '@campusverse/db';
import type { createPermissions } from '@campusverse/platform-permissions';
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { freeTeachers } from './cover.js';
import { dayPlan } from './timetable.js';

export function timetableTools(deps: {
  db: Db;
  permissions: ReturnType<typeof createPermissions>;
}): VerseTool[] {
  return [
    defineTool({
      name: 'timetable.today',
      description:
        "A day's timetable (today unless a date is given): the asker's own lessons with period, time, " +
        'class, subject and room (including lessons they cover), and for the school: lessons that day ' +
        'and lessons of away teachers that are covered or still need cover.',
      permission: ['school.timetable.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ date: z.iso.date().optional() }),
      handler: async (ctx, { date }) => {
        const plan = await dayPlan(deps.db, deps.permissions, ctx.actor, {
          institutionId: ctx.institutionId,
          date: date ?? ctx.today,
        });
        const me = ctx.actor.personId;
        const mine = plan.lessons.filter((l) =>
          l.cover ? l.cover.personId === me : l.teacherPersonId === me,
        );
        return {
          data: {
            date: plan.date,
            holiday: plan.holiday,
            hasTimetable: !!plan.timetableId,
            myLessons: mine.map((l) => ({
              period: l.ordinal,
              time: `${l.startsAt}-${l.endsAt}`,
              class: l.section,
              subject: l.subject,
              room: l.room,
              covering: !!l.cover,
            })),
            school: {
              lessons: plan.lessons.length,
              covered: plan.lessons.filter((l) => l.cover).length,
            },
          },
          sources: [{ label: 'Timetable', href: '/timetable', asOf: plan.date }],
        };
      },
    }),
    defineTool({
      name: 'timetable.free_teachers',
      description:
        'How many teachers are free in a period (period 1 is the first class period; breaks are not ' +
        'counted) today or on a date, with the period time. Counts only; the Cover tab shows who.',
      permission: ['school.cover.manage'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ period: z.number().int().min(1).max(20), date: z.iso.date().optional() }),
      handler: async (ctx, { period, date }) => {
        const r = await freeTeachers(deps.db, deps.permissions, ctx.actor, {
          institutionId: ctx.institutionId,
          date: date ?? ctx.today,
          ordinal: period,
        });
        return {
          data: {
            date: r.date,
            period: r.period
              ? { number: period, time: `${r.period.startsAt}-${r.period.endsAt}` }
              : null,
            free: r.free.length,
            freeWithNoCoverThisWeek: r.free.filter((f) => f.coversThisWeek === 0).length,
          },
          sources: [{ label: 'Timetable · Cover', href: `/timetable?tab=cover`, asOf: r.date }],
        };
      },
    }),
  ];
}
