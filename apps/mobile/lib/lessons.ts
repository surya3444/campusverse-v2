// The teacher's lessons of a day and the child's week, from the API (school timetable).
import type { Messages } from './messages';

export type DayLesson = {
  slotId: string;
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  section: string;
  subject: string;
  teacherPersonId: string | null;
  room: string | null;
  cover: { kind: string; personId: string | null } | null;
};
export type ChildLesson = {
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  subject: string;
  teacher: string | null;
  room: string | null;
  cover: 'teacher' | 'combined' | 'supervised' | null;
};
export type ChildWeek = {
  section: string | null;
  days: {
    date: string;
    holiday: string | null;
    lessons: ChildLesson[];
    /** Papers the class sits that day; its lessons give way to them. */
    exams: { exam: string; subject: string; startsAt: string | null; endsAt: string | null }[];
  }[];
};

/** Mine: my own lessons unless someone covers them, and the lessons I cover. */
export const myLessons = (lessons: DayLesson[], me: string) =>
  lessons.filter((l) => (l.cover ? l.cover.personId === me : l.teacherPersonId === me));

/** "Today" or "Tuesday 10". */
export function dayLabel(t: Messages, date: string, today: string) {
  if (date === today) return t.today;
  const d = new Date(`${date}T00:00:00Z`);
  return `${t.weekdays[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
}
