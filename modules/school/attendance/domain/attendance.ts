// Pure attendance rules: day states, submissions, conflicts and the running percentage. No I/O.

export const DAY_STATUSES = [
  'present',
  'absent',
  'late',
  'half_day',
  'approved_leave',
  'medical_leave',
  'school_duty',
  'holiday',
] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/** What a teacher may mark. Leave comes from approved requests; holidays from the calendar. */
export const MARKABLE = ['present', 'absent', 'late', 'half_day', 'school_duty'] as const;
export type Markable = (typeof MARKABLE)[number];

/** What a correction may set: anything but holiday, which is declared for the whole school. */
export const CORRECTABLE = DAY_STATUSES.filter((s) => s !== 'holiday');

export type Mark = { personId: string; status: Markable };
export type Leave = 'approved_leave' | 'medical_leave';
export type SubmissionError = 'not_on_roster' | 'marked_twice' | 'empty_roster';

/**
 * Everyone starts present; students on approved leave appear as on leave; the teacher's marks
 * (the absentees, late arrivals and so on) override both.
 */
export function daysFromSubmission(
  roster: string[],
  marks: Mark[],
  onLeave: ReadonlyMap<string, Leave>,
): Map<string, DayStatus> | SubmissionError {
  if (roster.length === 0) return 'empty_roster';
  const seen = new Set<string>();
  const enrolled = new Set(roster);
  for (const m of marks) {
    if (!enrolled.has(m.personId)) return 'not_on_roster';
    if (seen.has(m.personId)) return 'marked_twice';
    seen.add(m.personId);
  }
  const marked = new Map(marks.map((m) => [m.personId, m.status]));
  return new Map(roster.map((id) => [id, marked.get(id) ?? onLeave.get(id) ?? 'present'] as const));
}

export type Conflict = { personId: string; current: DayStatus; incoming: DayStatus };

/** A later submission never overwrites a taken day: each difference is kept for review. */
export function conflictsWith(
  current: ReadonlyMap<string, DayStatus>,
  incoming: ReadonlyMap<string, DayStatus>,
): Conflict[] {
  const out: Conflict[] = [];
  for (const [personId, status] of incoming) {
    const now = current.get(personId);
    if (now !== undefined && now !== status) out.push({ personId, current: now, incoming: status });
  }
  return out;
}

/** Half-days attended: present, late and school duty count in full, a half day counts half. */
const HALVES: Record<DayStatus, 0 | 1 | 2> = {
  present: 2,
  late: 2,
  school_duty: 2,
  half_day: 1,
  absent: 0,
  approved_leave: 0,
  medical_leave: 0,
  holiday: 0,
};

export type Percent = { workingDays: number; attendedHalves: number; basisPoints: number | null };

/**
 * Running attendance over the days a student's section took attendance. Holidays are not working
 * days. Integer basis points (7525 = 75.25%), rounded down so a student is never shown as passing
 * a threshold they haven't reached. Null before the first working day.
 */
export function attendancePercent(statuses: Iterable<DayStatus>): Percent {
  let workingDays = 0;
  let attendedHalves = 0;
  for (const s of statuses) {
    if (s === 'holiday') continue;
    workingDays += 1;
    attendedHalves += HALVES[s];
  }
  return {
    workingDays,
    attendedHalves,
    basisPoints:
      workingDays === 0 ? null : Math.floor((attendedHalves * 10_000) / (workingDays * 2)),
  };
}

export type Standing = 'ok' | 'warning' | 'short';

export function standing(
  basisPoints: number | null,
  rule: { minimumBasisPoints: number; warnBelowBasisPoints: number },
): Standing {
  if (basisPoints === null || basisPoints >= rule.warnBelowBasisPoints) return 'ok';
  return basisPoints < rule.minimumBasisPoints ? 'short' : 'warning';
}

/** "75.25" for numeric columns and screens. */
export const percentText = (basisPoints: number) =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, '0')}`;
