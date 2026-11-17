// Verse AI (docs/specs/APPRAISALS.md): how far the open appraisal cycles have got, as counts.
// Ratings, scores and comments never reach the model.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { appraisalProgress, type AppraisalDeps } from './appraisals.js';

export function appraisalTools(deps: AppraisalDeps): VerseTool[] {
  return [
    defineTool({
      name: 'appraisal.progress',
      description:
        'Open staff appraisal cycles: how many reviews wait for the self-rating, for the reviewer, are ' +
        'done, and acknowledged, and when each cycle closes. Counts only.',
      permission: ['people.appraisal.manage'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => ({
        data: await appraisalProgress(deps, ctx.actor, ctx.institutionId),
        sources: [{ label: 'Appraisals', href: '/appraisals', asOf: ctx.today }],
      }),
    }),
  ];
}
