'use client';

import { AlertTriangle, CheckCircle2, Clock, Info, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, cx, toneBar, toneSoft, type Tone } from '../primitives';
import { hourTicks, nowInIndia, position, stackRows, toMinutes } from './time';

/** A row of the schedule: Transport, Attendance, Classes… */
export type DayLineLane = { id: string; label: string };

/** A stretch of the day in one lane: buses running, register open, marks window. */
export type DayLineBlock = {
  id: string;
  lane: string;
  label: string;
  start: string;
  end: string;
  tone?: Tone;
};

/** A moment worth noticing: a deadline, a problem. Shown on the alerts row. */
export type DayLineMarker = {
  id: string;
  at: string;
  label: string;
  tone: Tone;
  attentionId?: string;
};

export type AttentionItem = {
  id: string;
  tone: Tone;
  title: string;
  detail?: string;
  at?: string;
  action?: { label: string; onSelect: () => void };
};

export type DayLineLabels = {
  schedule: string;
  now: string;
  alerts: string;
  todayInOrder: string;
  loading: string;
  emptyTitle: string;
  emptyBody: string;
};

export type AttentionLabels = { title: string; allClear: string; loading: string };

/** The current India time, refreshed every 30 seconds. `fixed` pins it (reviews, screenshots). */
export function useNowInIndia(fixed?: string): string {
  const [now, setNow] = useState(() => fixed ?? nowInIndia());
  useEffect(() => {
    if (fixed) return;
    const id = setInterval(() => setNow(nowInIndia()), 30_000);
    return () => clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

// Positions sit inside a padded track so the first and last hour labels are never clipped.
const PAD = 24;
const pct = (n: number) => `calc(${PAD}px + ${n.toFixed(5)} * (100% - ${2 * PAD}px))`;
const span = (n: number) => `calc(${n.toFixed(5)} * (100% - ${2 * PAD}px))`;
const LANE_H = 48;
const ALERT_ROW_H = 28;

/**
 * The Day Line: the institution's day as a schedule, one lane per kind of work, with the
 * present moment marked. Visual only; screen readers get the same day as an ordered list.
 */
export function DayLine({
  loading = false,
  now,
  start = '07:00',
  end = '18:00',
  lanes,
  blocks = [],
  markers = [],
  labels,
}: {
  loading?: boolean;
  now: string;
  start?: string;
  end?: string;
  lanes: DayLineLane[];
  blocks?: DayLineBlock[];
  markers?: DayLineMarker[];
  labels: DayLineLabels;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowAt = position(now, start, end);
  const empty = !loading && blocks.length === 0 && markers.length === 0;
  const ticks = hourTicks(start, end);
  // Labels are about 150px wide: roughly 100 minutes of line at desktop width.
  const rows = stackRows(
    markers.map((m) => m.at),
    100,
  );
  const alertRows = Math.max(1, ...rows.map((r) => r + 1));

  // On narrow screens the schedule scrolls: bring "now" into view, a third from the left.
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = nowAt * (el.scrollWidth - 112) - el.clientWidth / 3;
  }, [nowAt]);

  const events = [
    ...blocks.map((b) => ({ at: b.start, text: `${b.start}–${b.end} ${b.label}` })),
    ...markers.map((m) => ({ at: m.at, text: `${m.at} ${m.label}` })),
  ].sort((a, b) => toMinutes(a.at) - toMinutes(b.at));

  return (
    <section
      aria-labelledby="dayline-title"
      aria-busy={loading || undefined}
      className="panel overflow-hidden"
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <h2 id="dayline-title" className="text-body font-semibold text-ink">
          {labels.schedule}
        </h2>
        <span className="tabular ml-auto inline-flex items-center gap-1.5 rounded-full bg-navy-950 px-2.5 py-0.5 text-caption font-medium text-white">
          <span className="size-1.5 rounded-full bg-cyan-400" aria-hidden />
          {labels.now} {now}
        </span>
      </header>

      {loading && <p className="sr-only">{labels.loading}</p>}
      {!loading && !empty && (
        <ol aria-label={labels.todayInOrder} className="sr-only">
          {events.map((e, i) => (
            <li key={i}>{e.text}</li>
          ))}
        </ol>
      )}

      <div ref={scroller} aria-hidden className="overflow-x-auto">
        <div className="flex min-w-[680px]">
          {/* Lane labels stay put while the schedule scrolls */}
          <div className="sticky left-0 z-20 w-28 shrink-0 border-r border-line bg-surface">
            <div className="h-9 border-b border-line" />
            {lanes.map((l) => (
              <div
                key={l.id}
                className="flex items-center border-b border-line px-4 text-caption font-medium text-ink-muted"
                style={{ height: LANE_H }}
              >
                {l.label}
              </div>
            ))}
            <div
              className="flex items-start px-4 pt-2 text-caption font-medium text-ink-muted"
              style={{ height: alertRows * ALERT_ROW_H + 16 }}
            >
              {labels.alerts}
            </div>
          </div>

          <div className="relative flex-1">
            {/* Hours */}
            <div className="relative h-9 border-b border-line">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="tabular absolute top-2 -translate-x-1/2 text-caption text-ink-muted"
                  style={{ left: pct(position(t, start, end)) }}
                >
                  {t}
                </span>
              ))}
            </div>

            {/* The part of the day already gone: a soft hatch behind everything */}
            <span
              className="absolute top-9 bottom-0 left-0 bg-[repeating-linear-gradient(135deg,var(--color-paper)_0_6px,transparent_6px_12px)]"
              style={{ width: pct(nowAt) }}
            />
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-9 bottom-0 w-px bg-line"
                style={{ left: pct(position(t, start, end)) }}
              />
            ))}

            {lanes.map((l) => (
              <div key={l.id} className="relative border-b border-line" style={{ height: LANE_H }}>
                {loading ? (
                  <span className="absolute top-3 bottom-3 left-[8%] w-1/4 rounded-md bg-navy-50" />
                ) : (
                  blocks
                    .filter((b) => b.lane === l.id)
                    .map((b) => {
                      const left = position(b.start, start, end);
                      const tone = b.tone ?? 'neutral';
                      return (
                        <div
                          key={b.id}
                          className={cx(
                            'absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md pr-2 pl-3',
                            toneSoft[tone],
                          )}
                          style={{
                            left: pct(left),
                            width: span(position(b.end, start, end) - left),
                          }}
                        >
                          <span
                            className={cx('absolute top-0 bottom-0 left-0 w-[3px]', toneBar[tone])}
                          />
                          <span className="truncate text-caption font-medium">{b.label}</span>
                        </div>
                      );
                    })
                )}
              </div>
            ))}

            <div className="relative" style={{ height: alertRows * ALERT_ROW_H + 16 }}>
              {markers.map((m, i) => (
                <div
                  key={m.id}
                  className={cx(
                    'absolute z-20 flex items-center gap-1.5',
                    // Late in the day the label goes left of the dot, so it never runs off the edge.
                    position(m.at, start, end) > 0.85
                      ? '-translate-x-[calc(100%-5px)] flex-row-reverse'
                      : '-translate-x-[5px]',
                  )}
                  style={{
                    left: pct(position(m.at, start, end)),
                    top: 8 + (rows[i] ?? 0) * ALERT_ROW_H,
                  }}
                >
                  <span
                    className={cx(
                      'size-2.5 shrink-0 rounded-full ring-2 ring-surface',
                      toneBar[m.tone],
                    )}
                  />
                  <span className="max-w-44 truncate rounded bg-surface/90 px-1 text-caption text-ink">
                    {m.label}
                  </span>
                </div>
              ))}
              {empty && (
                <p className="absolute inset-0 flex items-center justify-center text-body text-ink-muted">
                  {labels.emptyTitle}
                </p>
              )}
            </div>

            {/* Now */}
            <span
              className="absolute top-9 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-navy-950 transition-[left] duration-1000 ease-linear"
              style={{ left: pct(nowAt) }}
            >
              <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-navy-950 ring-2 ring-cyan-400" />
            </span>
          </div>
        </div>
      </div>
      {empty && (
        <p className="border-t border-line px-5 py-3 text-caption text-ink-muted">
          {labels.emptyBody}
        </p>
      )}
    </section>
  );
}

const TONE_ICON = { neutral: Info, go: CheckCircle2, warn: Clock, stop: AlertTriangle } as const;

/** What needs this person now, most urgent first, each with one direct action. */
export function AttentionList({
  items,
  loading = false,
  labels,
}: {
  items: AttentionItem[];
  loading?: boolean;
  labels: AttentionLabels;
}) {
  return (
    <section
      aria-labelledby="attention-title"
      aria-busy={loading || undefined}
      className="panel @container"
    >
      <header className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 id="attention-title" className="text-body font-semibold text-ink">
          {labels.title}
        </h2>
        {!loading && items.length > 0 && (
          <span className="tabular rounded-full bg-signal-stop-tint px-2 text-caption font-medium text-signal-stop-ink">
            {items.length}
          </span>
        )}
      </header>
      {loading ? (
        <ul aria-hidden className="divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-3 px-5 py-4">
              <span className="size-8 rounded-full bg-navy-50" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3.5 w-3/4 rounded bg-navy-50" />
                <span className="h-3 w-1/2 rounded bg-navy-50" />
              </span>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-body text-ink-muted">
          <CheckCircle2 aria-hidden className="size-4 text-signal-go" />
          {labels.allClear}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const Icon = TONE_ICON[item.tone];
            return (
              <li key={item.id} id={`attention-${item.id}`} className="flex gap-3 px-5 py-4">
                <span
                  className={cx(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    toneSoft[item.tone],
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 @2xl:flex-row @2xl:items-center @2xl:gap-6">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-body font-medium text-ink">{item.title}</p>
                      {item.at && (
                        <span className="tabular shrink-0 text-caption text-ink-muted @2xl:hidden">
                          {item.at}
                        </span>
                      )}
                    </div>
                    {item.detail && <p className="text-caption text-ink-muted">{item.detail}</p>}
                  </div>
                  {item.at && (
                    <span className="tabular hidden shrink-0 text-caption text-ink-muted @2xl:inline">
                      {item.at}
                    </span>
                  )}
                  {item.action && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={item.action.onSelect}
                      className="mt-2 self-start @2xl:mt-0 @2xl:w-40 @2xl:self-auto"
                    >
                      {item.action.label}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type KeyFigure = {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: Tone;
  /** The small mark beside the label, as the reference's stat strip. */
  icon?: LucideIcon;
  /** Colours the number itself: red for money owed, navy for the lead figure. */
  valueTone?: 'stop' | 'go' | 'navy';
};

const NOTE_TONE: Record<Tone, string> = {
  neutral: 'text-ink-muted',
  go: 'text-signal-go-ink',
  warn: 'text-signal-warn-ink',
  stop: 'text-signal-stop-ink',
};

/** A few numbers that matter today, side by side in one quiet panel. Not a wall of cards. */
const CARD_TILE = [
  'bg-navy-50 text-navy-950',
  'bg-signal-go/10 text-signal-go-ink',
  'bg-sky-tint text-sky-ink',
  'bg-navy-50 text-ink-muted',
];

/**
 * Key numbers. `cards` (module pages): separate cards with a tinted icon tile, label and value, as
 * the reference's module screens. `strip` (dashboard and directories): one joined panel.
 */
export function KeyFigures({
  figures,
  label,
  loading = false,
  variant = 'cards',
}: {
  figures: KeyFigure[];
  label: string;
  loading?: boolean;
  variant?: 'cards' | 'strip';
}) {
  if (variant === 'cards')
    return (
      <section aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((f, i) => (
          <div
            key={f.label}
            className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]"
          >
            {f.icon && (
              <span
                aria-hidden
                className={cx(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg',
                  f.valueTone === 'stop'
                    ? 'bg-signal-stop/10 text-signal-stop-ink'
                    : CARD_TILE[i % CARD_TILE.length],
                )}
              >
                <f.icon className="size-5" />
              </span>
            )}
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body text-ink-muted">{f.label}</span>
              {loading ? (
                <span className="skeleton mt-1 h-6 w-16" />
              ) : (
                <span
                  className={cx(
                    'tabular truncate font-display text-[1.375rem] leading-7 font-bold',
                    f.valueTone === 'stop' ? 'text-signal-stop-ink' : 'text-ink',
                  )}
                >
                  {f.value}
                </span>
              )}
              {f.note && !loading && (
                <span className={cx('truncate text-caption', NOTE_TONE[f.tone ?? 'neutral'])}>
                  {f.note}
                </span>
              )}
            </div>
          </div>
        ))}
      </section>
    );
  return (
    // The reference's StatGrid: one joined panel, a navy hairline on top, dividers between cells,
    // tiny tracked labels, big display numbers and a faint index in each corner.
    <section
      aria-label={label}
      className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lift)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-navy-950/40 to-transparent"
      />
      <div className="grid grid-cols-2 divide-line lg:grid-cols-4 [&>*]:border-line [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0 [&>*:not(:first-child)]:border-l [&>*:nth-child(3)]:border-l-0 lg:[&>*:nth-child(3)]:border-l">
        {figures.map((f, i) => (
          <div key={f.label} className="relative flex flex-col gap-3 px-6 py-7">
            <span className="flex items-center justify-between gap-2 pr-6">
              <span className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
                {f.label}
              </span>
              {f.icon && (
                <f.icon
                  aria-hidden
                  className={cx(
                    'size-3.5 shrink-0',
                    f.valueTone === 'stop' ? 'text-signal-stop/70' : 'text-ink-muted',
                  )}
                />
              )}
            </span>
            {loading ? (
              <span className="skeleton h-11 w-28" />
            ) : (
              <span
                className={cx(
                  'tabular font-display text-[2rem] leading-none font-bold tracking-tight sm:text-[2.5rem]',
                  f.valueTone === 'stop'
                    ? 'text-signal-stop'
                    : f.valueTone === 'go'
                      ? 'text-signal-go-ink'
                      : 'text-ink',
                )}
              >
                {f.value}
              </span>
            )}
            <span className={cx('min-h-4 text-caption', NOTE_TONE[f.tone ?? 'neutral'])}>
              {!loading && f.note}
            </span>
            {/* Decorative index, drawn by CSS so it isn't text (the label carries the meaning). */}
            <span
              aria-hidden
              data-index={String(i + 1).padStart(2, '0')}
              className="pointer-events-none absolute top-2 right-5 font-mono text-[10px] text-ink-faint/60 after:content-[attr(data-index)]"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
