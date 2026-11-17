// Timetable rules that need no database: the bell schedule, which version is in effect, the
// weekday of a date, and periods per week against each subject's target.

export type PeriodInput = {
  startsAt: string;
  endsAt: string;
  kind: 'class' | 'break';
  label?: string | null | undefined;
};

export type ScheduleProblem = 'no_periods' | 'too_many_periods' | 'bad_time' | 'periods_overlap';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Periods run forward in time without overlapping; numbers are their order (1, 2, 3…). */
export function checkPeriods(periods: readonly PeriodInput[]): ScheduleProblem | null {
  if (periods.length === 0 || !periods.some((p) => p.kind === 'class')) return 'no_periods';
  if (periods.length > 16) return 'too_many_periods';
  for (const p of periods)
    if (!HM.test(p.startsAt) || !HM.test(p.endsAt) || p.endsAt <= p.startsAt) return 'bad_time';
  for (let i = 1; i < periods.length; i++)
    if ((periods[i]?.startsAt ?? '') < (periods[i - 1]?.endsAt ?? '')) return 'periods_overlap';
  return null;
}

export type VersionStatus = 'draft' | 'scheduled' | 'current' | 'superseded';

/**
 * Where each version stands on a date. Published versions take effect on their date and last
 * until the next one's; the latest one already in effect is current.
 */
export function versionStatus(
  versions: readonly { id: string; state: 'draft' | 'published'; effectiveFrom: string | null }[],
  today: string,
): Map<string, VersionStatus> {
  const out = new Map<string, VersionStatus>();
  const started = versions
    .filter((v) => v.state === 'published' && v.effectiveFrom && v.effectiveFrom <= today)
    .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''));
  const current = started[0]?.id;
  for (const v of versions)
    out.set(
      v.id,
      v.state === 'draft'
        ? 'draft'
        : (v.effectiveFrom ?? '') > today
          ? 'scheduled'
          : v.id === current
            ? 'current'
            : 'superseded',
    );
  return out;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function weekday(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export type Target = { subjectId: string; placed: number; target: number | null };

/** Periods placed per subject for one section, against the class's periods per week. */
export function targets(
  slots: readonly { subjectId: string }[],
  offerings: readonly { subjectId: string; periodsPerWeek: number | null }[],
): Target[] {
  const placed = new Map<string, number>();
  for (const s of slots) placed.set(s.subjectId, (placed.get(s.subjectId) ?? 0) + 1);
  return offerings.map((o) => ({
    subjectId: o.subjectId,
    placed: placed.get(o.subjectId) ?? 0,
    target: o.periodsPerWeek,
  }));
}
