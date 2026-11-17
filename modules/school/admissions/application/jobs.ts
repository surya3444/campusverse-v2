// Tells the family a child is enrolled (rule book §13.3 "Enrol … parent login"): where the child
// sits, the admission number, and that the parent signs in to the app with this mobile number.
// An account message: it goes whatever the guardian's message choices, once per enrolment.
import { displayNames } from '@campusverse/people-records';
import type { Consumer } from '@campusverse/platform-events';
import { institutionInfo } from '@campusverse/platform-organisation';
import { sectionInfo } from '@campusverse/school-setup';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { STUDENT_ENROLLED } from './admissions.js';

export function admissionsJobs(): Consumer[] {
  return [
    {
      name: 'school.admission.welcome-family',
      queue: 'notifications',
      events: [STUDENT_ENROLLED],
      handle: async (tx, e) => {
        const p = e.payload as {
          studentId: string;
          institutionId: string;
          sectionId: string;
          admissionNumber?: string;
        };
        const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
        const school = await institutionInfo(tx, p.institutionId);
        const section = await sectionInfo(tx, p.sectionId, d?.d ?? '');
        const child = (await displayNames(tx, [p.studentId]))[p.studentId];
        const row =
          school && child ? { child, school: school.name, section: section?.label ?? null } : null;
        if (!row) return;
        await notifyGuardians(tx, {
          studentId: p.studentId,
          flag: null,
          kind: 'account',
          language: 'en',
          title: `Welcome to ${row.school}`,
          body:
            `${row.child} is enrolled` +
            (row.section ? ` in ${row.section}` : '') +
            (p.admissionNumber ? `, admission no. ${p.admissionNumber}` : '') +
            `. Sign in to the Campusverse app with this mobile number to see attendance, fees, ` +
            `homework and notices.`,
          dedupeKey: `admission:welcome:${p.studentId}`,
        });
      },
    },
  ];
}
