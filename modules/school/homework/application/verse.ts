// Verse AI (docs/specs/HOMEWORK.md, step 2): homework over the last week, as counts by class. No
// names leave for the model (decision 0015); the Homework page, linked as the source, has detail.
import { withTenant } from '@campusverse/db';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor } from '@campusverse/platform-permissions';
import { sectionRoster } from '@campusverse/school-enrolment';
import { sectionsOn } from '@campusverse/school-setup';
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { addDays } from '../domain/homework.js';
import { myClasses, setHomework, type HomeworkDeps } from './homework.js';

/** Homework set in the 7 days to `on`, by class, and how much of what fell due was ticked done. */
export async function homeworkSummary(
  deps: HomeworkDeps,
  ctx: { actor: Actor; institutionId: string },
  on: string,
) {
  return withTenant(deps.db, ctx.actor.orgId, async (tx) => {
    const where = await placeOf(tx, ctx.institutionId);
    await deps.permissions.assertCan(tx, ctx.actor, 'school.homework.read', {
      orgId: ctx.actor.orgId,
      ...(where ? { place: where } : {}),
    });
    const from = addDays(on, -6);
    const rows = await tx.execute<{
      id: string;
      sectionId: string;
      setOn: string;
      dueOn: string;
    }>(sql`
      select h.id::text, hs.section_id::text as "sectionId", h.set_on::text as "setOn", h.due_on::text as "dueOn"
      from school_homework h join school_homework_section hs on hs.org_id = h.org_id and hs.homework_id = h.id
      where h.org_id = app_current_org() and h.institution_id = ${ctx.institutionId} and h.state = 'open'
        and (h.set_on between ${from}::date and ${on}::date or h.due_on between ${from}::date and ${addDays(on, 7)}::date)`);
    const done = await tx.execute<{ id: string; studentId: string }>(sql`
      select homework_id::text as id, student_person_id::text as "studentId" from school_homework_done
      where org_id = app_current_org() and homework_id = any(${`{${[...new Set(rows.map((r) => r.id))].join(',')}}`}::uuid[])`);
    const sections = await sectionsOn(tx, ctx.institutionId, on);
    let due = 0;
    let ticked = 0;
    for (const r of rows.filter((x) => x.dueOn >= from && x.dueOn <= on)) {
      const roll = new Set((await sectionRoster(tx, r.sectionId, on)).map((x) => x.personId));
      due += roll.size;
      ticked += done.filter((d) => d.id === r.id && roll.has(d.studentId)).length;
    }
    const setIn = rows.filter((r) => r.setOn >= from && r.setOn <= on);
    return {
      from,
      to: on,
      homeworkSet: new Set(setIn.map((r) => r.id)).size,
      dueNext7Days: new Set(
        rows.filter((r) => r.dueOn > on && r.dueOn <= addDays(on, 7)).map((r) => r.id),
      ).size,
      byClass: sections
        .map((s) => ({
          class: s.label,
          set: setIn.filter((r) => r.sectionId === s.sectionId).length,
        }))
        .filter((c) => c.set > 0),
      classesWithNone: sections.filter((s) => !setIn.some((r) => r.sectionId === s.sectionId))
        .length,
      // Ticked done by parents, of homework that fell due this week (children times homework).
      donePercent: due ? Math.round((ticked / due) * 100) : null,
    };
  });
}

export function homeworkTools(deps: HomeworkDeps): VerseTool[] {
  return [
    defineTool({
      name: 'homework.set',
      description:
        'Prepare setting homework for one class the person teaches: the class (like "5-A"), the ' +
        'subject (like "Maths"), a short title, optional details and the due date (a school day, ' +
        'today or later). Guardians are told when it is set. The person confirms on screen.',
      permission: ['school.homework.set'],
      risk: 'act',
      dataClasses: ['operational'],
      input: z.object({
        section: z.string().max(40).optional(),
        sectionId: z.string().max(64).optional(),
        subject: z.string().max(80).optional(),
        subjectId: z.string().max(64).optional(),
        title: z.string().trim().min(1).max(120),
        details: z.string().max(2000).default(''),
        dueOn: z.iso.date(),
      }),
      handler: async (ctx, input) => {
        const { classes } = await myClasses(deps, ctx.actor, ctx.institutionId);
        const cls = pickOne(
          classes,
          { id: input.sectionId, text: input.section?.replace(/^class\s+/i, '') },
          (c) => c.sectionId,
          (c) => c.label,
        );
        if ('error' in cls)
          return {
            data: {
              error: `${cls.error} (class)`,
              classes: classes.map((c) => ({
                section: c.label,
                subjects: c.subjects.map((x) => x.name),
              })),
            },
          };
        const sub = pickOne(
          cls.row.subjects,
          { id: input.subjectId, text: input.subject },
          (x) => x.subjectId,
          (x) => x.name,
        );
        if ('error' in sub)
          return {
            data: {
              error: `${sub.error} (subject)`,
              subjects: cls.row.subjects.map((x) => x.name),
            },
          };
        if (input.dueOn < ctx.today) return { data: { error: 'The due date is in the past.' } };
        return {
          confirmInput: {
            sectionId: cls.row.sectionId,
            subjectId: sub.row.subjectId,
            title: input.title,
            details: input.details,
            dueOn: input.dueOn,
          },
          data: { prepared: true, class: cls.row.label, subject: sub.row.name, dueOn: input.dueOn },
          proposal: {
            title: `Set ${sub.row.name} homework for ${cls.row.label}`,
            lines: [
              input.title,
              ...(input.details.trim() ? [input.details.trim()] : []),
              `Due ${input.dueOn} · guardians are told`,
            ],
            confirm: 'Set homework',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, input) => {
        if (!input.sectionId || !input.subjectId) throw new Error('class_not_found');
        await setHomework(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          sectionIds: [input.sectionId],
          subjectId: input.subjectId,
          title: input.title,
          details: input.details,
          dueOn: input.dueOn,
          fileIds: [],
        });
        return { done: 'Homework set; guardians are being told.' };
      },
    }),
    defineTool({
      name: 'homework.summary',
      description:
        'Homework over the last 7 days: how much was set and by class, classes with none, what is due ' +
        'in the next 7 days, and the share ticked done by parents. Counts only.',
      permission: ['school.homework.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ date: z.iso.date().optional() }),
      handler: async (ctx, { date }) => {
        const on = date ?? ctx.today;
        return {
          data: await homeworkSummary(deps, ctx, on),
          sources: [{ label: 'Homework', href: '/homework', asOf: on }],
        };
      },
    }),
  ];
}
