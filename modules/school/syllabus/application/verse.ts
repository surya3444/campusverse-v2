// Verse AI (docs/specs/SYLLABUS.md): coverage against the plan as counts, and ticking a unit done
// for a section, prepared for the person to confirm (decision 0021).
import { defineTool, pickOne, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import {
  classSubjects,
  schoolCoverage,
  syllabusPlan,
  tickUnit,
  type SyllabusDeps,
} from './syllabus.js';

export function syllabusTools(deps: SyllabusDeps): VerseTool[] {
  return [
    defineTool({
      name: 'syllabus.coverage',
      description:
        'Syllabus covered this year by class and subject: units, units expected by now from the ' +
        'planned months, and per section units done, percent and whether it is behind.',
      permission: ['school.syllabus.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const c = await schoolCoverage(deps, ctx.actor, ctx.institutionId);
        return {
          data: c.rows.map((r) => ({
            class: r.className,
            subject: r.subject,
            units: r.units,
            expectedByNow: r.expected,
            sections: r.sections.map((s) => ({
              section: s.label,
              done: s.done,
              percent: s.percent,
              behind: s.behind,
            })),
          })),
          sources: [{ label: 'Syllabus', href: '/syllabus', asOf: c.today }],
        };
      },
    }),
    defineTool({
      name: 'syllabus.unit.complete',
      description:
        'Prepare ticking a syllabus unit (chapter) done for a section the person teaches: the ' +
        'section (like "5-A"), the subject (like "English") and the unit\'s title words or ' +
        'number. The person confirms on screen.',
      permission: ['school.syllabus.teach'],
      risk: 'act',
      dataClasses: ['operational'],
      input: z.object({
        section: z.string().max(40),
        subject: z.string().max(80),
        unit: z.string().max(200),
        unitId: z.string().max(64).optional(),
        sectionId: z.string().max(64).optional(),
      }),
      handler: async (ctx, input) => {
        const classes = await classSubjects(deps, ctx.actor, ctx.institutionId);
        const label = input.section
          .replace(/^class\s+/i, '')
          .trim()
          .toLowerCase();
        const cls = classes.find((c) =>
          label.startsWith(c.className.replace(/^class\s+/i, '').toLowerCase()),
        );
        if (!cls)
          return {
            data: { error: 'No such class this year.', classes: classes.map((c) => c.className) },
          };
        const sub = pickOne(
          cls.subjects,
          { text: input.subject },
          (s) => s.subjectId,
          (s) => s.name,
        );
        if ('error' in sub)
          return {
            data: { error: `${sub.error} (subject)`, subjects: cls.subjects.map((s) => s.name) },
          };
        const p = await syllabusPlan(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          classId: cls.classId,
          subjectId: sub.row.subjectId,
        });
        const sec = pickOne(
          p.sections,
          { id: input.sectionId, text: input.section.replace(/^class\s+/i, '') },
          (s) => s.sectionId,
          (s) => s.label,
        );
        if ('error' in sec)
          return {
            data: { error: `${sec.error} (section)`, sections: p.sections.map((s) => s.label) },
          };
        if (!sec.row.canTick)
          return { data: { error: 'This person does not teach that subject there.' } };
        const byNumber = /^\d+$/.test(input.unit.trim())
          ? p.units.find((u) => u.position === Number(input.unit.trim()))
          : undefined;
        const unit = byNumber
          ? { row: byNumber }
          : pickOne(
              p.units,
              { id: input.unitId, text: input.unit },
              (u) => u.unitId,
              (u) => `${u.position} ${u.title}`,
            );
        if ('error' in unit)
          return {
            data: {
              error: `${unit.error} (unit)`,
              units: p.units.map((u) => `${u.position}. ${u.title}`),
            },
          };
        if (unit.row.done.some((d) => d.sectionId === sec.row.sectionId))
          return { data: { error: 'That unit is already ticked done for this section.' } };
        return {
          confirmInput: { ...input, unitId: unit.row.unitId, sectionId: sec.row.sectionId },
          data: { prepared: true, section: sec.row.label, unit: unit.row.title },
          proposal: {
            title: `Mark "${unit.row.title}" done for ${sec.row.label}`,
            lines: [
              `${sub.row.name} · unit ${unit.row.position} of ${p.units.length}`,
              `${sec.row.label} will have ${sec.row.done + 1} of ${sec.row.total} units covered`,
            ],
            confirm: 'Mark done',
            tone: 'normal',
          },
        };
      },
      execute: async (ctx, input) => {
        if (!input.unitId || !input.sectionId) throw new Error('unit_not_found');
        await tickUnit(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          unitId: input.unitId,
          sectionId: input.sectionId,
          done: true,
        });
        return { done: 'Unit marked done.' };
      },
    }),
  ];
}
