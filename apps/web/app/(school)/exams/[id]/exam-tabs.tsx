'use client';

// The exam's date sheet (each paper's date, time, room and invigilator) and its analysis
// (averages, pass rates, grades and the top of each class).
import type { DateSheet, ExamAnalysis } from '@campusverse/school-exams';
import { Button, EmptyState, Pill, Section, SkeletonRows, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Trophy } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';

const t = en.examTabs;
const pct = (bp: number | null) =>
  bp === null ? '—' : `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}%`;
const day = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function DateSheetPanel({ examId }: { examId: string }) {
  const { can } = useMe();
  const sheet = useQuery({
    queryKey: ['date-sheet', examId],
    queryFn: () => api.get<DateSheet>(`/school/exams/${examId}/date-sheet`),
  });
  if (sheet.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (sheet.isError || !sheet.data)
    return <StatePanel kind="error" title={en.states.error.title} />;
  const s = sheet.data;
  const editable = can('school.exam.manage') && s.state === 'marks_open';

  return (
    <Section
      title={t.dateSheet}
      description={s.state === 'marks_open' ? undefined : t.lockedNote}
      flush
      actions={
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t.print}
        </Button>
      }
    >
      <div role="region" aria-label={t.dateSheet} tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-body">
          <thead>
            <tr className="border-b border-line text-left text-caption text-ink-muted">
              <th className="px-5 py-2.5 font-medium">{t.subject}</th>
              <th className="px-3 py-2.5 font-medium">{t.date}</th>
              <th className="px-3 py-2.5 font-medium">{t.time}</th>
              <th className="px-3 py-2.5 font-medium">{t.duration}</th>
              <th className="px-3 py-2.5 font-medium">{t.room}</th>
              <th className="px-3 py-2.5 font-medium">{t.invigilator}</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {s.papers.map((p) => (
              <ScheduleRow
                key={p.paperId}
                examId={examId}
                paper={p}
                staff={s.staff}
                editable={editable}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ScheduleRow({
  examId,
  paper: p,
  staff,
  editable,
}: {
  examId: string;
  paper: DateSheet['papers'][number];
  staff: DateSheet['staff'];
  editable: boolean;
}) {
  const qc = useQueryClient();
  const initial = {
    onDate: p.onDate ?? '',
    startsAt: p.startsAt ?? '',
    durationMinutes: p.durationMinutes === null ? '' : String(p.durationMinutes),
    room: p.room ?? '',
    invigilatorId: p.invigilator?.personId ?? '',
  };
  const [f, setF] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/exams/papers/${p.paperId}/schedule`, {
        onDate: f.onDate || null,
        startsAt: f.startsAt || null,
        durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null,
        room: f.room || null,
        invigilatorId: f.invigilatorId || null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['date-sheet', examId] }),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const label = `${p.className} ${p.subject}`;
  if (!editable)
    return (
      <tr className="border-b border-line last:border-0">
        <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
          <span className="mr-2 text-caption text-ink-muted">{p.className}</span>
          {p.subject}
        </th>
        <td className="px-3 py-3">
          {p.onDate ? (
            day.format(new Date(`${p.onDate}T00:00:00Z`))
          ) : (
            <span className="text-ink-muted">{t.notScheduled}</span>
          )}
        </td>
        <td className="tabular px-3 py-3">{p.startsAt ?? '—'}</td>
        <td className="tabular px-3 py-3">{p.durationMinutes ?? '—'}</td>
        <td className="px-3 py-3">{p.room ?? '—'}</td>
        <td className="px-3 py-3">{p.invigilator?.name ?? '—'}</td>
        <td />
      </tr>
    );
  return (
    <tr className="border-b border-line align-top last:border-0">
      <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
        <span className="mr-2 text-caption text-ink-muted">{p.className}</span>
        {p.subject}
        {save.isError && (
          <span role="alert" className="mt-1 block text-caption font-normal text-signal-stop-ink">
            {errorText(save.error)}
          </span>
        )}
      </th>
      <td className="px-3 py-2">
        <input
          type="date"
          aria-label={`${t.date}: ${label}`}
          value={f.onDate}
          onChange={set('onDate')}
          className={cx(fieldInput, 'h-9 w-40')}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          aria-label={`${t.time}: ${label}`}
          value={f.startsAt}
          onChange={set('startsAt')}
          className={cx(fieldInput, 'h-9 w-28')}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={5}
          max={480}
          step={5}
          aria-label={`${t.duration}: ${label}`}
          value={f.durationMinutes}
          onChange={set('durationMinutes')}
          className={cx(fieldInput, 'tabular h-9 w-20')}
        />
      </td>
      <td className="px-3 py-2">
        <input
          aria-label={`${t.room}: ${label}`}
          maxLength={40}
          value={f.room}
          onChange={set('room')}
          className={cx(fieldInput, 'h-9 w-28')}
        />
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`${t.invigilator}: ${label}`}
          value={f.invigilatorId}
          onChange={set('invigilatorId')}
          className={cx(fieldInput, 'h-9 min-w-40')}
        >
          <option value="">{t.nobody}</option>
          {staff.map((s) => (
            <option key={s.personId} value={s.personId}>
              {s.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        {dirty && (
          <Button
            className="h-9"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            aria-label={`${t.save}: ${label}`}
          >
            {t.save}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function AnalysisPanel({ examId }: { examId: string }) {
  const a = useQuery({
    queryKey: ['exam-analysis', examId],
    queryFn: () => api.get<ExamAnalysis>(`/school/exams/${examId}/analysis`),
  });
  if (a.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (a.isError || !a.data) return <StatePanel kind="error" title={en.states.error.title} />;
  return (
    <div className="flex flex-col gap-6">
      {a.data.classes.map((c) => {
        const any = c.papers.some((p) => p.entered > 0);
        return (
          <Section
            key={c.classId}
            title={c.name}
            description={[
              t.students(c.students),
              a.data.passBasisPoints !== null ? t.passMark(pct(a.data.passBasisPoints)) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            flush
          >
            {!any ? (
              <EmptyState compact art="exams" title={t.noMarks} />
            ) : (
              <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_300px]">
                <ul className="divide-y divide-line">
                  {c.papers.map((p) => (
                    <li key={p.paperId} className="flex flex-col gap-2 px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-body font-semibold text-ink">{p.subject}</span>
                        <span className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
                          <span>
                            {t.average} <b className="tabular text-ink">{pct(p.averageBp)}</b>
                          </span>
                          <span>
                            {t.passRate} <b className="tabular text-ink">{pct(p.passRateBp)}</b>
                          </span>
                          <span>
                            {t.highest} <b className="tabular text-ink">{p.highest ?? '—'}</b> /{' '}
                            {p.maxMarks}
                          </span>
                          {p.absent > 0 && (
                            <span>
                              {t.absent} {p.absent}
                            </span>
                          )}
                          {p.blank > 0 && (
                            <span className="text-signal-warn-ink">
                              {t.blank} {p.blank}
                            </span>
                          )}
                        </span>
                      </div>
                      <span
                        className="flex h-2 overflow-hidden rounded-full bg-navy-50"
                        aria-hidden
                      >
                        <span
                          className="h-full rounded-full bg-navy-950"
                          style={{ width: `${Math.min(100, (p.averageBp ?? 0) / 100)}%` }}
                        />
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <span className="sr-only">{t.grades}:</span>
                        {Object.entries(p.grades)
                          .sort(([x], [y]) => x.localeCompare(y))
                          .map(([g, n]) => (
                            <Pill key={g}>
                              {g} · {n}
                            </Pill>
                          ))}
                      </span>
                    </li>
                  ))}
                </ul>
                <aside
                  className="border-t border-line bg-paper/60 p-5 xl:border-t-0 xl:border-l"
                  aria-label={t.toppers}
                >
                  <p className="flex items-center gap-2 text-body font-semibold text-ink">
                    <Trophy aria-hidden className="size-4 text-signal-warn" />
                    {t.toppers}
                  </p>
                  <p className="mb-3 text-caption text-ink-muted">{t.toppersHint}</p>
                  {c.toppers.length === 0 && (
                    <p className="text-caption text-ink-muted">{t.noneComplete}</p>
                  )}
                  <ol className="flex flex-col gap-2">
                    {c.toppers.map((x) => (
                      <li
                        key={x.personId}
                        className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 shadow-[var(--shadow-card)]"
                      >
                        <span className="tabular flex size-7 items-center justify-center rounded-full bg-navy-50 text-caption font-bold text-navy-950">
                          {x.rank}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-body text-ink">{x.name}</span>
                        <span className="tabular text-caption font-semibold text-ink">
                          {pct(x.percentBp)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </aside>
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
