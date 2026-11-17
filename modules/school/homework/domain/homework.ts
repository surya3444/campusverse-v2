// Homework dates with no I/O (docs/specs/HOMEWORK.md, decision 3).

export const MAX_DAYS_AHEAD = 60;

export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const isSunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

/** What's wrong with a due date set today, if anything. */
export function dueProblem(today: string, dueOn: string): 'due_in_past' | 'due_too_far' | null {
  if (dueOn < today) return 'due_in_past';
  if (dueOn > addDays(today, MAX_DAYS_AHEAD)) return 'due_too_far';
  return null;
}

/** The first school day after a date: not a Sunday, not a day off. Gives up after two weeks. */
export function nextSchoolDay(from: string, off: (d: string) => boolean): string {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    if (!isSunday(d) && !off(d)) return d;
  }
  return addDays(from, 1);
}
