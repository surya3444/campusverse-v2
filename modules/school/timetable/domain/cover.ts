// Who should cover a lesson (decision 7): free teachers ranked by teaching the subject, then
// teaching that class, then fewest covers this week, then fewest lessons that day. Pure.

export type Candidate = {
  personId: string;
  name: string;
  teachesSubject: boolean;
  teachesSection: boolean;
  coversThisWeek: number;
  lessonsToday: number;
};

export function rankCover(free: readonly Candidate[]): Candidate[] {
  return [...free].sort(
    (a, b) =>
      Number(b.teachesSubject) - Number(a.teachesSubject) ||
      Number(b.teachesSection) - Number(a.teachesSection) ||
      a.coversThisWeek - b.coversThisWeek ||
      a.lessonsToday - b.lessonsToday ||
      a.name.localeCompare(b.name),
  );
}
