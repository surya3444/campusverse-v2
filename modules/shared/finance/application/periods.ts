// Fee plans bill for one academic year (a "period" the academic module reports through the
// audience port). Finance never reads the school's tables: it asks the port.
import type { Tx } from '@campusverse/db';
import type { AudiencePeriod, AudiencePort } from '@campusverse/shared-communications';
import { FinanceError } from './common.js';

/** How long before a year starts its fees may fall due (admission fees, advance first terms). */
export const EARLY_DAYS = 180;

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export async function periodsFor(
  tx: Tx,
  audience: AudiencePort,
  institutionId: string,
): Promise<AudiencePeriod[]> {
  return audience.periods ? audience.periods(tx, institutionId) : [];
}

/** The period containing a date, if any. */
export const periodOn = (periods: AudiencePeriod[], date: string) =>
  periods.find((p) => p.starts <= date && date < p.ends) ?? null;

/** The period a new fee plan bills for: required where the institution has years, open, and its dates fit. */
export async function resolvePeriod(
  tx: Tx,
  audience: AudiencePort,
  institutionId: string,
  periodId: string | null | undefined,
  dueDates: string[],
): Promise<AudiencePeriod | null> {
  const periods = await periodsFor(tx, audience, institutionId);
  if (periods.length === 0) {
    if (periodId) throw new FinanceError('year_not_found');
    return null;
  }
  // Not named: the year the first instalment falls in (or is due ahead of).
  const id = periodId ?? inferPeriod(periods, dueDates)?.id;
  if (!id) throw new FinanceError('year_required');
  const p = periods.find((x) => x.id === id);
  if (!p) throw new FinanceError('year_not_found');
  if (p.closed) throw new FinanceError('year_closed', { year: p.label });
  const earliest = addDays(p.starts, -EARLY_DAYS);
  const outside = dueDates.filter((d) => d < earliest || d >= p.ends);
  if (outside.length > 0)
    throw new FinanceError('due_outside_year', { year: p.label, dates: outside });
  return p;
}

/** A date moved inside a period (its first or last day), so a plan bills that year's students. */
export const clampTo = (date: string, p: AudiencePeriod) =>
  date < p.starts ? p.starts : date >= p.ends ? addDays(p.ends, -1) : date;

/** The year a set of due dates belongs to: the one holding the first, else the next to start within EARLY_DAYS. */
export function inferPeriod(periods: AudiencePeriod[], dueDates: string[]): AudiencePeriod | null {
  const first = [...dueDates].sort()[0];
  if (!first) return null;
  return (
    periodOn(periods, first) ??
    [...periods]
      .filter((p) => p.starts > first && addDays(p.starts, -EARLY_DAYS) <= first)
      .sort((a, b) => a.starts.localeCompare(b.starts))[0] ??
    null
  );
}
