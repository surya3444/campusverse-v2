// Verse AI tools for exams: progress, and results as class and subject aggregates. No marks of
// any one student, and no names.
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { examAnalysis, listExams, type ExamDeps } from './exams.js';

export function examTools(deps: ExamDeps): VerseTool[] {
  return [
    defineTool({
      name: 'school.exams.progress',
      description:
        'Exams this school has set up: their state (marks open, locked, published) and how many papers are submitted.',
      permission: ['school.exam.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const exams = await listExams(deps, ctx.actor, ctx.institutionId);
        return {
          data: exams.map((e) => ({
            exam: e.name,
            year: e.yearLabel,
            state: e.state,
            papersSubmitted: `${e.submitted} of ${e.papers}`,
            published: e.publishedAt,
          })),
          sources: [{ label: 'Exams', href: '/exams', asOf: ctx.today }],
        };
      },
    }),
    defineTool({
      name: 'school.exams.results',
      description:
        'How an exam went, by class and subject: average percentage, pass rate, absentees and marks still blank. The latest exam unless one is named.',
      permission: ['school.exam.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({ exam: z.string().max(80).optional() }),
      handler: async (ctx, { exam }) => {
        const exams = await listExams(deps, ctx.actor, ctx.institutionId);
        const chosen =
          exams.find((e) => exam && e.name.toLowerCase().includes(exam.toLowerCase())) ?? exams[0];
        if (!chosen)
          return {
            data: { exams: 0 },
            sources: [{ label: 'Exams', href: '/exams', asOf: ctx.today }],
          };
        const a = await examAnalysis(deps, ctx.actor, chosen.id);
        const pct = (bp: number | null) =>
          bp === null ? null : `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;
        return {
          data: {
            exam: a.name,
            classes: a.classes.map((c) => ({
              class: c.name,
              students: c.students,
              subjects: c.papers.map((p) => ({
                subject: p.subject,
                average: pct(p.averageBp),
                passRate: pct(p.passRateBp),
                absent: p.absent,
                blank: p.blank,
              })),
            })),
          },
          sources: [{ label: a.name, href: `/exams/${a.examId}`, asOf: ctx.today }],
        };
      },
    }),
  ];
}
