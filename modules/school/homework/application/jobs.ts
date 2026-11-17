// Tells guardians about homework (docs/specs/HOMEWORK.md, decision 4): once per child when it's
// set, and once more if the due date moves. App only (kind 'homework', no fallback).
import type { Consumer } from '@campusverse/platform-events';
import { sectionRoster } from '@campusverse/school-enrolment';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { COPY } from '../copy.js';
import { HOMEWORK_DUE_CHANGED, HOMEWORK_SET } from './homework.js';

export function homeworkJobs(): Consumer[] {
  return [
    {
      name: 'school.homework.tell-guardians',
      queue: 'notifications',
      events: [HOMEWORK_SET, HOMEWORK_DUE_CHANGED],
      handle: async (tx, e) => {
        const { homeworkId } = e.payload as { homeworkId: string };
        const [h] = await tx.execute<{
          title: string;
          dueOn: string;
          subject: string;
          state: string;
        }>(sql`
          select h.title, h.due_on::text as "dueOn", s.name as subject, h.state
          from school_homework h join school_subject s on s.org_id = h.org_id and s.id = h.subject_id
          where h.org_id = app_current_org() and h.id = ${homeworkId}`);
        if (!h || h.state !== 'open') return;
        const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
        const sections = await tx.execute<{ id: string }>(sql`
          select section_id::text as id from school_homework_section
          where org_id = app_current_org() and homework_id = ${homeworkId}`);
        const moved = e.type === HOMEWORK_DUE_CHANGED;
        for (const s of sections)
          for (const child of await sectionRoster(tx, s.id, d?.d ?? h.dueOn))
            await notifyGuardians(tx, {
              studentId: child.personId,
              flag: 'academic_messages',
              kind: 'homework',
              language: 'en',
              title: moved ? COPY.en.movedTitle(h.subject) : COPY.en.setTitle(h.subject),
              body: (moved ? COPY.en.movedBody : COPY.en.setBody)(child.name, h.title, h.dueOn),
              dedupeKey: `homework:${homeworkId}:${h.dueOn}:${child.personId}`,
            });
      },
    },
  ];
}
