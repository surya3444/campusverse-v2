'use client';

import type { Register } from '@campusverse/school-attendance';
import { Button, StatePanel, cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../../lib/api';
import { exportCsv } from '../../../../../lib/csv';
import { en } from '../../../../../messages/en';
import { errorText, t } from '../../shared';

const CELL: Record<string, string> = {
  absent: 'text-signal-stop-ink font-semibold',
  late: 'text-signal-warn-ink',
  half_day: 'text-signal-warn-ink',
  holiday: 'text-ink-faint',
};

/** The monthly register: one row per student, one column per day; prints on one landscape page. */
export function RegisterView({ sectionId }: { sectionId: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const reg = useQuery({
    queryKey: ['attendance-register', sectionId, month],
    queryFn: () =>
      api.get<Register>(`/school/attendance/sections/${sectionId}/register?month=${month}`),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/attendance/${sectionId}`}
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline print:hidden"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-semibold text-ink">
          {reg.data ? t.registerTitle(reg.data.label) : t.register}
        </h1>
        <div className="flex items-end gap-3 print:hidden">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.month}</span>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950"
            />
          </label>
          <Button
            variant="secondary"
            disabled={!reg.data || reg.data.students.length === 0}
            onClick={() => {
              const r = reg.data;
              if (!r) return;
              void exportCsv(
                'attendance_register',
                sectionId,
                `attendance-${r.label}-${r.month}`.replaceAll(' ', '-'),
                [t.roll, t.name, ...r.dates.map((d) => d.slice(8)), t.total],
                r.students.map((st) => {
                  const cells = r.dates.map((d) => {
                    const s = st.days[d] ?? (r.holidays[d] ? 'holiday' : null);
                    return s ? (t.short[s] ?? s) : '';
                  });
                  const present = Object.values(st.days).filter(
                    (s) => s === 'present' || s === 'late' || s === 'school_duty',
                  ).length;
                  return [st.rollNumber, st.name, ...cells, present];
                }),
              );
            }}
          >
            <Download aria-hidden className="size-4" />
            {t.download}
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t.print}
          </Button>
        </div>
      </div>
      {reg.isPending ? (
        <StatePanel kind="loading" title={en.states.loading.title} />
      ) : reg.isError ? (
        reg.error instanceof ApiFailure && reg.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel
            kind="error"
            title={en.states.error.title}
            body={errorText(reg.error)}
            action={en.states.error.action}
            onAction={() => void reg.refetch()}
          />
        )
      ) : reg.data.students.length === 0 ? (
        <StatePanel kind="empty" title={t.errors.empty_roster ?? ''} />
      ) : (
        <>
          <div
            role="region"
            aria-label={reg.data.label}
            tabIndex={0}
            className="panel relative overflow-x-auto print:overflow-visible print:border-0"
          >
            <table className="tabular w-full text-caption">
              <thead>
                <tr className="border-b border-line bg-paper text-ink-muted">
                  <th
                    scope="col"
                    className="sticky left-0 bg-paper px-2 py-2 text-left font-medium"
                  >
                    {t.roll}
                  </th>
                  <th
                    scope="col"
                    className="sticky left-8 bg-paper px-2 py-2 text-left font-medium"
                  >
                    {t.name}
                  </th>
                  {reg.data.dates.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className={cx(
                        'w-7 px-0.5 py-2 text-center font-medium',
                        reg.data.holidays[d] && 'text-ink-faint',
                      )}
                    >
                      {Number(d.slice(8))}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t.total}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reg.data.students.map((st) => {
                  const days = Object.values(st.days).filter((s) => s !== 'holiday');
                  const present = days.filter(
                    (s) => s === 'present' || s === 'late' || s === 'school_duty',
                  ).length;
                  return (
                    <tr key={st.personId}>
                      <td className="sticky left-0 bg-surface px-2 py-1.5 text-ink-muted">
                        {st.rollNumber ?? ''}
                      </td>
                      <td className="sticky left-8 max-w-48 truncate bg-surface px-2 py-1.5 text-ink">
                        {st.name}
                      </td>
                      {reg.data.dates.map((d) => {
                        const s = st.days[d] ?? (reg.data.holidays[d] ? 'holiday' : null);
                        return (
                          <td
                            key={d}
                            className={cx('px-0.5 py-1.5 text-center', s && CELL[s])}
                            title={s ? t.statuses[s] : undefined}
                          >
                            {s ? t.short[s] : ''}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right text-ink">
                        {present}/{days.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-ink-muted">{t.legend}</p>
        </>
      )}
    </div>
  );
}
