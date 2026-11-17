'use client';

// One person's month as a calendar: each day coloured by how it counts, late and early marked.
import { Section, SkeletonRows, cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';

const t = en.staffAttendance;
export type MonthDay = { onDate: string; status: string; late: boolean; leftEarly: boolean };
export type MonthRow = {
  personId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  photoFileId: string | null;
  days: MonthDay[];
  totals: Record<string, number>;
};

export const CELL: Record<string, string> = {
  present: 'bg-signal-go-tint text-signal-go-ink',
  half_day: 'bg-signal-warn-tint text-signal-warn-ink',
  absent: 'bg-signal-stop-tint text-signal-stop-ink',
  on_leave: 'bg-violet-tint text-violet-ink',
  on_duty: 'bg-sky-tint text-sky-ink',
};
export const thisMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
export const shiftMonth = (m: string, by: number) => {
  const [y = 1970, mo = 1] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
export const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

export function MonthCalendar({ personId }: { personId: string }) {
  const school = useInstitution();
  const [month, setMonth] = useState(thisMonth());
  const report = useQuery({
    queryKey: ['staff-month', school.institutionId, month],
    queryFn: () =>
      api.get<{ staff: MonthRow[] }>(
        `/staff-attendance/report?institutionId=${school.institutionId}&month=${month}`,
      ),
    enabled: !!school.institutionId,
  });
  const row = report.data?.staff.find((s) => s.personId === personId);
  const [y = 1970, m = 1] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const byDate = new Map((row?.days ?? []).map((d) => [d.onDate, d]));

  return (
    <Section
      title={t.monthTitle(monthName(month))}
      actions={
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t.previous}
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-paper"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t.next}
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= thisMonth()}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-paper disabled:opacity-30"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </span>
      }
    >
      {report.isPending ? (
        <SkeletonRows rows={3} label={en.states.loading.title} />
      ) : (
        <div className="flex flex-col gap-5">
          {row && (
            <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {(['worked', 'present', 'half_day', 'absent', 'late', 'leftEarly'] as const).map(
                (k) => (
                  <div key={k} className="rounded-xl bg-paper px-3 py-2">
                    <dt className="text-caption text-ink-muted">{t.columns[k]}</dt>
                    <dd className="tabular text-lead font-semibold text-ink">
                      {row.totals[k] ?? 0}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          )}
          <ol className="grid grid-cols-7 gap-1.5" aria-label={monthName(month)}>
            {Array.from({ length: lead }, (_, i) => (
              <li key={`x${i}`} aria-hidden />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = `${month}-${String(i + 1).padStart(2, '0')}`;
              const d = byDate.get(date);
              return (
                <li
                  key={date}
                  title={
                    d
                      ? `${t.statuses[d.status]}${d.late ? ` · ${t.late}` : ''}${d.leftEarly ? ` · ${t.leftEarly}` : ''}`
                      : t.notMarked
                  }
                  className={cx(
                    'relative flex aspect-square flex-col items-center justify-center rounded-lg text-caption font-medium',
                    d ? CELL[d.status] : 'bg-paper text-ink-muted',
                  )}
                >
                  <span className="tabular">{i + 1}</span>
                  <span className="sr-only">{d ? t.statuses[d.status] : t.notMarked}</span>
                  {d && (d.late || d.leftEarly) && (
                    <span
                      aria-hidden
                      className="absolute top-1 right-1 size-1.5 rounded-full bg-signal-warn"
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <ul className="flex flex-wrap gap-3 text-caption text-ink-muted">
            {Object.keys(CELL).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span aria-hidden className={cx('size-3 rounded', CELL[k])} />
                {t.statuses[k]}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-signal-warn" />
              {t.late} / {t.leftEarly}
            </li>
          </ul>
        </div>
      )}
    </Section>
  );
}
