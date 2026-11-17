// Pure rules for syllabus coverage (docs/specs/SYLLABUS.md). Dates are ISO days. No I/O.

export type UnitPlan = { id: string; plannedMonth: string | null };
export type Coverage = {
  total: number;
  done: number;
  /** Units planned for this month or earlier. */
  expected: number;
  /** Ticked fewer than expected. */
  behind: boolean;
  /** Whole percent of all units covered. */
  percent: number;
};

/** The first day of a date's month. */
export const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;

export function coverage(units: UnitPlan[], doneIds: ReadonlySet<string>, today: string): Coverage {
  const month = monthOf(today);
  const total = units.length;
  const done = units.filter((u) => doneIds.has(u.id)).length;
  const expected = units.filter((u) => u.plannedMonth !== null && u.plannedMonth <= month).length;
  return {
    total,
    done,
    expected,
    behind: done < expected,
    percent: total ? Math.floor((done * 100) / total) : 0,
  };
}

/** A planned month a year on, for copying last year's syllabus. */
export function nextYearMonth(month: string | null): string | null {
  if (!month) return null;
  return `${Number(month.slice(0, 4)) + 1}${month.slice(4)}`;
}

/** A lesson plan stays editable until the day after its date. */
export const planEditable = (onDate: string, today: string) => {
  const d = new Date(`${onDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return today <= d.toISOString().slice(0, 10);
};
