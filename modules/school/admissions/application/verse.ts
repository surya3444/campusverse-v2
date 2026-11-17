// Verse AI: the admissions funnel for a year, as counts (no names), for admissions managers.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { pipeline, type AdmissionsDeps } from './admissions.js';

/** The admission year starting this April (or last April before it). */
const thisYear = () => {
  const d = new Date();
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export function admissionTools(deps: AdmissionsDeps): VerseTool[] {
  return [
    defineTool({
      name: 'school.admissions.summary',
      description:
        'The admissions funnel for an admission year (like 2026-27): how many families are at each stage, enrolled and lost, and seats taken per class.',
      permission: ['school.admission.manage'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({
        yearLabel: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      }),
      handler: async (ctx, { yearLabel }) => {
        const year = yearLabel ?? thisYear();
        const p = await pipeline(deps, ctx.actor, {
          institutionId: ctx.institutionId,
          yearLabel: year,
        });
        return {
          data: {
            year,
            byStage: p.counts,
            seats: p.classes
              .filter((c) => c.seats !== null || c.held > 0)
              .map((c) => ({ class: c.name, taken: c.held, seats: c.seats })),
          },
          sources: [{ label: 'Admissions', href: '/admissions', asOf: year }],
        };
      },
    }),
  ];
}
