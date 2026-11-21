'use client';

// Setting up next year as a proposal (owner's brief, 20 Nov 2026): it starts from this year's
// classes and sections, and the school changes it before confirming: a class can stop, a class
// can start, any class can have more or fewer sections and seats. This year doesn't change.
import type { ClassesOverview } from '@campusverse/school-setup';
import { FormModal, Pill, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

const t = en.yearEnd.proposal;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const day = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

type Row = { code: string; name: string; sections: number; capacity: number; runs: boolean };

export function NextYearDialog({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: (r: { label: string; sections: number }) => void;
}) {
  const view = useQuery({
    queryKey: ['classes', institutionId],
    queryFn: () => api.get<ClassesOverview>(`/school/setup/${institutionId}/classes`),
  });
  if (!view.data)
    return (
      <FormModal
        title={t.title}
        submitLabel={t.create}
        cancelLabel={en.form.cancel}
        submitDisabled
        onClose={onClose}
        onSubmit={onClose}
      >
        <p className="col-span-full text-body text-ink-muted" aria-live="polite">
          {view.isError ? t.loadFailed : en.states.loading.title}
        </p>
      </FormModal>
    );
  return (
    <Proposal
      overview={view.data}
      institutionId={institutionId}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function Proposal({
  overview,
  institutionId,
  onClose,
  onDone,
}: {
  overview: ClassesOverview;
  institutionId: string;
  onClose: () => void;
  onDone: (r: { label: string; sections: number }) => void;
}) {
  const qc = useQueryClient();
  // The latest year (newest first) is what next year follows on from.
  const last = overview.years[0];
  const startYear = Number(last?.label.slice(0, 4) ?? '0') + 1;
  const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const now = new Map(
    (last?.classes ?? []).map((c) => {
      const open = c.sections.filter((s) => !s.closed);
      return [c.code, { sections: open.length, capacity: open[0]?.capacity ?? 30 }] as const;
    }),
  );
  const [rows, setRows] = useState<Row[]>(() =>
    (last?.classes ?? [])
      .filter((c) => c.sections.some((s) => !s.closed))
      .map((c) => ({
        code: c.code,
        name: c.name,
        sections: now.get(c.code)?.sections ?? 1,
        capacity: now.get(c.code)?.capacity ?? 30,
        runs: true,
      })),
  );
  const [adding, setAdding] = useState('');
  const order = new Map(overview.catalogue.map((c, i) => [c.code, i]));
  const sorted = [...rows].sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  const choices = overview.catalogue.filter((c) => !rows.some((r) => r.code === c.code));
  const set = (code: string, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  const running = rows.filter((r) => r.runs);
  const totals = {
    classes: running.length,
    sections: running.reduce((n, r) => n + r.sections, 0),
    seats: running.reduce((n, r) => n + r.sections * r.capacity, 0),
  };
  const valid =
    running.length > 0 &&
    running.every(
      (r) => r.sections >= 1 && r.sections <= 26 && r.capacity >= 1 && r.capacity <= 80,
    );
  const save = useMutation({
    mutationFn: () =>
      api.post<{ label: string; sections: number }>(`/school/setup/${institutionId}/next-year`, {
        plan: {
          classes: running.map((r) => ({
            code: r.code,
            sections: Array.from({ length: r.sections }, (_, i) => ({
              name: LETTERS.charAt(i),
              capacity: r.capacity,
            })),
          })),
        },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['classes'] });
      void qc.invalidateQueries({ queryKey: ['exam-years'] });
      onDone(r);
    },
  });
  const change = (r: Row) => {
    const was = now.get(r.code);
    if (!r.runs) return { text: t.stops, tone: 'stop' as const };
    if (!was) return { text: t.starts, tone: 'go' as const };
    const parts = [];
    if (r.sections !== was.sections) parts.push(t.sectionsChange(was.sections, r.sections));
    if (r.capacity !== was.capacity) parts.push(t.seatsChange(was.capacity, r.capacity));
    return parts.length ? { text: parts.join(' · '), tone: 'warn' as const } : null;
  };

  return (
    <FormModal
      title={t.titleFor(label)}
      description={last ? t.lead(day(last.ends), last.label) : undefined}
      submitLabel={t.create}
      cancelLabel={en.form.cancel}
      size="xl"
      pending={save.isPending}
      submitDisabled={!valid}
      error={
        save.error
          ? (t.errors[save.error instanceof ApiFailure ? save.error.code : 'error'] ??
            t.errors.error)
          : null
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <div className="col-span-full flex min-w-0 flex-col gap-4">
        {/* Scrolls sideways on a phone; focusable so the keyboard can scroll it too. */}
        <div
          role="region"
          aria-label={t.titleFor(label)}
          tabIndex={0}
          className="overflow-x-auto rounded-xl border border-line focus-visible:ring-2 focus-visible:ring-navy-950"
        >
          <table className="w-full min-w-[560px] text-body">
            <caption className="sr-only">{t.titleFor(label)}</caption>
            <thead>
              <tr className="border-b border-line bg-paper text-left text-caption font-medium text-ink-muted">
                <th scope="col" className="px-4 py-2.5">
                  {t.cls}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t.runs}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t.sections}
                </th>
                <th scope="col" className="px-3 py-2.5">
                  {t.seats}
                </th>
                <th scope="col" className="px-4 py-2.5">
                  {t.change}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((r) => {
                const d = change(r);
                return (
                  <tr key={r.code} className={cx(!r.runs && 'bg-paper/70')}>
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-left font-medium whitespace-nowrap text-ink"
                    >
                      {r.name}
                      {r.runs && (
                        <span className="block text-caption font-normal text-ink-muted">
                          {LETTERS.slice(0, r.sections).split('').join(', ')}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={r.runs}
                        onChange={(e) => set(r.code, { runs: e.target.checked })}
                        aria-label={t.runsIn(r.name, label)}
                        className="size-4 accent-[#04266d]"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center rounded-lg border border-line-strong">
                        <button
                          type="button"
                          disabled={!r.runs || r.sections <= 1}
                          onClick={() => set(r.code, { sections: r.sections - 1 })}
                          aria-label={t.fewer(r.name)}
                          className="inline-flex size-8 items-center justify-center text-ink-muted hover:text-navy-950 disabled:opacity-40"
                        >
                          <Minus aria-hidden className="size-3.5" />
                        </button>
                        <span
                          className="tabular w-7 text-center font-medium text-ink"
                          aria-live="polite"
                        >
                          {r.runs ? r.sections : '—'}
                        </span>
                        <button
                          type="button"
                          disabled={!r.runs || r.sections >= 26}
                          onClick={() => set(r.code, { sections: r.sections + 1 })}
                          aria-label={t.more(r.name)}
                          className="inline-flex size-8 items-center justify-center text-ink-muted hover:text-navy-950 disabled:opacity-40"
                        >
                          <Plus aria-hidden className="size-3.5" />
                        </button>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={80}
                        disabled={!r.runs}
                        value={r.capacity}
                        aria-label={t.seatsFor(r.name)}
                        onChange={(e) => set(r.code, { capacity: Number(e.target.value) })}
                        className="tabular h-8 w-20 rounded-lg border border-line-strong bg-surface px-2 text-body text-ink outline-none focus:border-navy-950 disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {d ? (
                          <Pill tone={d.tone}>{d.text}</Pill>
                        ) : (
                          <span className="text-caption text-ink-muted">{t.same}</span>
                        )}
                        {!now.has(r.code) && (
                          <button
                            type="button"
                            onClick={() => setRows((cur) => cur.filter((x) => x.code !== r.code))}
                            aria-label={t.removeNew(r.name)}
                            className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-signal-stop-tint hover:text-signal-stop-ink"
                          >
                            <X aria-hidden className="size-4" />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {choices.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.addClass}</span>
              <select
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                className="h-10 min-w-48 rounded-lg border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950"
              >
                <option value="">{t.choose}</option>
                {choices.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!adding}
              onClick={() => {
                const c = overview.catalogue.find((x) => x.code === adding);
                if (c)
                  setRows((cur) => [
                    ...cur,
                    { code: c.code, name: c.name, sections: 1, capacity: 30, runs: true },
                  ]);
                setAdding('');
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-navy-950 shadow-[var(--shadow-card)] hover:bg-navy-50 disabled:opacity-50"
            >
              <Plus aria-hidden className="size-4" />
              {t.add}
            </button>
          </div>
        )}
        <p
          aria-live="polite"
          className="tabular rounded-xl bg-navy-50/60 px-4 py-3 text-body font-medium text-ink"
        >
          {t.totals(label, totals.classes, totals.sections, totals.seats)}
        </p>
        <p className="text-caption text-ink-muted">{t.note}</p>
      </div>
    </FormModal>
  );
}
