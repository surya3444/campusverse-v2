// Verse AI draft tool for notices. It saves nothing: the draft opens the notice screen pre-filled,
// and the person edits, sends for approval and sends it the normal way.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';

export function noticeTools(): VerseTool[] {
  return [
    defineTool({
      name: 'communications.notice.draft',
      description:
        'Prepare a notice to parents for the person to review. Give a short title and a clear, polite body. Nothing is sent.',
      permission: ['communications.notice.compose'],
      risk: 'draft',
      dataClasses: ['operational'],
      input: z.object({
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(2000),
      }),
      handler: async (_ctx, { title, body }) => {
        const q = new URLSearchParams({ title, body });
        return {
          data: { drafted: true, sent: false, note: 'Shown to the person to review and send.' },
          draft: { kind: 'notice', title, body, href: `/notices/new?${q.toString()}` },
        };
      },
    }),
  ];
}
