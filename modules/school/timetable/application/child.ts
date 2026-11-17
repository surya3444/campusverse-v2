// The child's timetable for parents (Milestone 19 step 3): the coming school days of the child's
// section, with who teaches each lesson (or that it's covered). Guardian relation only.
import { withTenant, type Db } from '@campusverse/db';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sectionOf } from '@campusverse/school-enrolment';
import { sectionInfo } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import type { CoverKind } from './cover.js';
import { planIn } from './timetable.js';

type Permissions = ReturnType<typeof createPermissions>;

export type ChildLesson = {
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  subject: string;
  /** The covering teacher when someone covers it; null for combined or supervised. */
  teacher: string | null;
  room: string | null;
  cover: CoverKind | null;
};
export type ChildExam = {
  exam: string;
  subject: string;
  startsAt: string | null;
  endsAt: string | null;
};
export type ChildTimetableDay = {
  date: string;
  holiday: string | null;
  lessons: ChildLesson[];
  /** Papers the child's class sits that day; lessons give way to them. */
  exams: ChildExam[];
};
export type ChildWeek = { section: string | null; days: ChildTimetableDay[] };

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Today and the next six days; days off (Sundays, unticked days) are left out. */
export async function childWeek(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  studentId: string,
): Promise<ChildWeek> {
  return withTenant(db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = row?.d ?? '';
    const sectionId = await sectionOf(tx, studentId, today);
    const s = sectionId ? await sectionInfo(tx, sectionId, today) : null;
    await permissions.assertCan(tx, actor, 'school.timetable.read', {
      orgId: actor.orgId,
      ...(s ? { place: { campusId: s.campusId, institutionId: s.institutionId } } : {}),
      subjectPersonId: studentId,
    });
    if (!s) return { section: null, days: [] };
    const days: ChildTimetableDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      // ponytail: the section as of today; a section change mid-week shows from the next visit.
      if (date >= s.yearEnds) break;
      const plan = await planIn(tx, s.institutionId, date);
      if (plan.holiday) {
        days.push({ date, holiday: plan.holiday, lessons: [], exams: [] });
        continue;
      }
      const lessons = plan.lessons
        .filter((l) => l.sectionIds.includes(s.sectionId))
        .map((l) => ({
          ordinal: l.ordinal,
          startsAt: l.startsAt,
          endsAt: l.endsAt,
          subject: l.subject,
          teacher: l.cover ? l.cover.name : l.teacher,
          room: l.room,
          cover: l.cover?.kind ?? null,
        }));
      const exams = plan.exams
        .filter((e) => e.classId === s.classId)
        .map((e) => ({ exam: e.exam, subject: e.subject, startsAt: e.startsAt, endsAt: e.endsAt }));
      if (lessons.length || exams.length) days.push({ date, holiday: null, lessons, exams });
    }
    return { section: s.label, days };
  });
}
