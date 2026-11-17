// Verse AI: taught subjects with no teacher, by section (subject codes and section labels only).
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import type { Db } from '@campusverse/db';
import type { createPermissions } from '@campusverse/platform-permissions';
import { subjectsOverview } from './subjects.js';

export function setupTools(deps: {
  db: Db;
  permissions: ReturnType<typeof createPermissions>;
}): VerseTool[] {
  return [
    defineTool({
      name: 'school.subjects.gaps',
      description:
        'Subjects taught in a class this year that have no teacher in one or more sections, and sections with no class teacher.',
      permission: ['school.setup.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const v = await subjectsOverview(deps.db, deps.permissions, ctx.actor, ctx.institutionId);
        const code = new Map(v.subjects.map((s) => [s.subjectId, s.code]));
        const noTeacher = v.classes.flatMap((c) =>
          c.sections.flatMap((sec) =>
            c.offerings
              .filter((o) => !sec.teachers.some((x) => x.subjectId === o.subjectId))
              .map((o) => ({ section: sec.label, subject: code.get(o.subjectId) ?? '' })),
          ),
        );
        const noClassTeacher = v.classes.flatMap((c) =>
          c.sections.filter((s) => !s.classTeacher).map((s) => s.label),
        );
        return {
          data: {
            year: v.yearLabel,
            subjectsWithoutTeacher: noTeacher,
            sectionsWithoutClassTeacher: noClassTeacher,
          },
          sources: [
            {
              label: 'Subjects',
              href: '/subjects',
              asOf: v.yearLabel ?? new Date().toISOString().slice(0, 10),
            },
          ],
        };
      },
    }),
  ];
}
