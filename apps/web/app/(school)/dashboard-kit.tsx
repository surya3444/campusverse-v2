'use client';

// The dashboard's sections, as the Campusverse hub draws them (decision 0022): the setup
// checklist, eyebrow panels, the weekly attendance bars, today's pulse, the student donut, the
// admissions pipeline, the finance breakdown, the attention ribbon and the quick-action pills.
// Charts are plain SVG and CSS: no chart library.
import { cx, type AttentionItem } from '@campusverse/ui';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Circle,
  Info,
  ListChecks,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { en } from '../../messages/en';

const d = en.home.dash;

/** A panel with a tracked eyebrow, an optional title, and an "Open ↗" link. */
export function DashPanel({
  eyebrow,
  title,
  aside,
  action,
  children,
  className,
  tint = false,
}: {
  eyebrow: string;
  title?: ReactNode;
  aside?: ReactNode;
  action?: { label: string; href: string };
  children: ReactNode;
  className?: string;
  tint?: boolean;
}) {
  return (
    <section
      aria-label={eyebrow}
      className={cx(
        'rounded-2xl border border-line shadow-[var(--shadow-lift)]',
        tint ? 'bg-linear-to-br from-surface via-surface to-navy-950/[0.03]' : 'bg-surface',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
            {eyebrow}
          </p>
          {title && (
            <h3 className="mt-0.5 font-display text-lead font-semibold text-ink">{title}</h3>
          )}
        </div>
        {aside}
        {action && (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-ink-muted transition-colors hover:text-ink"
          >
            {action.label} <ArrowUpRight aria-hidden className="size-3" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** "Finish setting up": the remaining tasks, each opening where it is done. */
export function SetupChecklist({
  checks,
  group,
  bodies,
}: {
  checks: { key: string; ok: boolean; href: string; title: string }[];
  /** The heading over the tasks (a school's by default). */
  group?: string;
  /** A line under each task, by key (a school's by default). */
  bodies?: Record<string, string>;
}) {
  const s = d.setup;
  const [open, setOpen] = useState(true);
  const done = checks.filter((c) => c.ok).length;
  const left = checks.filter((c) => !c.ok);
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
  if (left.length === 0) return null;
  return (
    <section
      aria-label={s.eyebrow}
      className="relative overflow-hidden rounded-2xl border border-line bg-linear-to-br from-navy-950/[0.06] via-surface to-cyan-400/[0.05] shadow-[var(--shadow-lift)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-navy-950/40 to-transparent"
      />
      <header className="flex items-center gap-4 px-6 py-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-950/10"
        >
          <ListChecks className="size-5 text-navy-950" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
            {s.eyebrow}
          </p>
          <p className="font-display text-[1rem] leading-tight font-semibold text-ink">
            {s.progress(done, checks.length, left.length)}
          </p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <span aria-hidden className="h-1.5 w-32 overflow-hidden rounded-full bg-navy-50">
            <span
              className="block h-full rounded-full bg-linear-to-r from-navy-950 to-cyan-400"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="tabular font-display text-lead font-bold text-ink">{pct}%</span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? s.collapse : s.expand}
          onClick={() => setOpen((o) => !o)}
          className="ml-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-navy-50 hover:text-ink"
        >
          <ChevronDown
            aria-hidden
            className={cx('size-4 transition-transform duration-200', !open && '-rotate-90')}
          />
        </button>
      </header>
      {open && (
        <>
          <div className="border-t border-navy-950/10 px-6 py-5">
            <p className="mb-2 text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
              {group ?? s.group}
            </p>
            <ul className="flex flex-col gap-1.5">
              {left.map((c) => (
                <li key={c.key}>
                  <div className="group relative flex items-start gap-3 rounded-xl border border-transparent bg-surface/60 px-4 py-3 transition-all hover:border-navy-950/20 hover:bg-surface hover:shadow-[var(--shadow-lift)]">
                    <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-body leading-tight font-medium text-ink">{c.title}</p>
                        <span className="rounded-full border border-signal-warn/30 bg-signal-warn/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-signal-warn-ink uppercase">
                          {s.required}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-caption text-ink-muted">
                        {(bodies ?? s.bodies)[c.key] ?? ''}
                      </p>
                    </div>
                    <Link
                      href={c.href}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-navy-950 transition-all after:absolute after:inset-0 hover:bg-navy-950/10"
                    >
                      {s.setUp}
                      <ArrowUpRight aria-hidden className="size-3" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-navy-950/10 px-6 py-3">
            <p className="text-[11px] text-ink-muted">{s.footer}</p>
            {done > 0 && (
              <span className="inline-flex items-center gap-1 text-caption font-medium text-signal-go-ink">
                <CheckCircle2 aria-hidden className="size-3.5" />
                {done}
              </span>
            )}
          </footer>
        </>
      )}
    </section>
  );
}

/** The week's attendance as paired bars (present, absent), with gridlines. */
export function WeeklyBars({
  days,
}: {
  days: { label: string; present: number; absent: number }[];
}) {
  const max = Math.max(1, ...days.map((x) => Math.max(x.present, x.absent)));
  const top = Math.ceil(max / 4) * 4 || 4;
  const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];
  const w = d.weekly;
  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="flex gap-3">
        <div
          aria-hidden
          className="tabular flex h-[220px] flex-col justify-between pb-6 text-right text-[11px] text-ink-muted"
        >
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {Math.round(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between"
          >
            {ticks.map((t) => (
              <span key={t} className="block border-t border-dashed border-line" />
            ))}
          </div>
          <ul className="relative flex h-[220px] items-end gap-2">
            {days.map((x) => (
              <li
                key={x.label}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                aria-label={`${x.label}: ${w.present} ${x.present}, ${w.absent} ${x.absent}`}
              >
                <span className="flex h-full w-full items-end justify-center gap-1 pb-0">
                  <span
                    className="w-[38%] max-w-6 rounded-t-md bg-linear-to-b from-signal-go/95 to-signal-go/60"
                    style={{ height: `${(x.present / top) * 100}%` }}
                  />
                  <span
                    className="w-[38%] max-w-6 rounded-t-md bg-linear-to-b from-signal-stop/55 to-signal-stop/25"
                    style={{ height: `${(x.absent / top) * 100}%` }}
                  />
                </span>
                <span className="h-4 text-[11px] text-ink-muted">{x.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 flex gap-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-signal-go" />
          {w.present}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-signal-stop/50" />
          {w.absent}
        </span>
      </p>
    </div>
  );
}

/** A donut of parts with the total in the middle. */
export function Donut({
  parts,
  total,
  label,
}: {
  parts: { label: string; value: number; color: string }[];
  total: number;
  label: string;
}) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const gap = parts.filter((p) => p.value > 0).length > 1 ? 6 : 0;
  let offset = 0;
  return (
    <div className="relative mx-auto size-[150px]">
      <svg viewBox="0 0 150 150" className="size-full -rotate-90" aria-hidden>
        <circle cx="75" cy="75" r={r} className="fill-none stroke-navy-50" strokeWidth="22" />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const len = (p.value / total) * c;
              const el = (
                <circle
                  key={p.label}
                  cx="75"
                  cy="75"
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="22"
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular font-display text-title font-bold text-ink">{total}</span>
        <span className="text-[10px] tracking-[0.18em] text-ink-muted uppercase">{label}</span>
      </span>
    </div>
  );
}

/** "Requires attention · n": up to four cards, as the reference's ribbon. */
export function AttentionRibbon({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={d.attention(items.length)} className="flex flex-col gap-3">
      <header className="flex items-center">
        <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
          {d.attention(items.length)}
        </p>
        <span aria-hidden className="ml-4 h-px flex-1 bg-line" />
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.slice(0, 8).map((a) => {
          const Icon: LucideIcon = a.tone === 'neutral' ? Info : AlertTriangle;
          return (
            <button
              key={a.id}
              type="button"
              onClick={a.action?.onSelect}
              className={cx(
                'group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                a.tone === 'stop'
                  ? 'border-signal-stop/30 bg-signal-stop/[0.03] hover:bg-signal-stop/[0.06]'
                  : a.tone === 'warn'
                    ? 'border-signal-warn/30 bg-signal-warn/[0.03] hover:bg-signal-warn/[0.06]'
                    : 'border-navy-950/20 bg-navy-950/[0.03] hover:bg-navy-950/[0.06]',
              )}
            >
              <Icon
                aria-hidden
                className={cx(
                  'size-4 shrink-0',
                  a.tone === 'stop'
                    ? 'text-signal-stop-ink'
                    : a.tone === 'warn'
                      ? 'text-signal-warn-ink'
                      : 'text-navy-950',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{a.title}</span>
                {(a.detail ?? a.action?.label) && (
                  <span className="block truncate text-caption text-ink-muted">
                    {a.detail ?? a.action?.label}
                  </span>
                )}
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-3.5 shrink-0 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The quick-action pills under the dashboard. */
export function QuickPills({
  items,
}: {
  items: { key: string; href?: string; onClick?: () => void; icon: LucideIcon }[];
}) {
  const cls =
    'inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-4 text-caption font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:bg-navy-50';
  return (
    <section aria-label={d.quick} className="flex flex-col gap-3">
      <header className="flex items-center">
        <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
          {d.quick}
        </p>
        <span aria-hidden className="ml-4 h-px flex-1 bg-line" />
      </header>
      <div className="flex flex-wrap gap-2">
        {items.map((q) =>
          q.href ? (
            <Link key={q.key} href={q.href} className={cls}>
              <q.icon aria-hidden className="size-3.5" />
              {d.quickItems[q.key]}
            </Link>
          ) : (
            <button key={q.key} type="button" onClick={q.onClick} className={cls}>
              <q.icon aria-hidden className="size-3.5" />
              {d.quickItems[q.key]}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

/** A pipeline stage box (leads → converted). */
export function Stage({ value, label, go }: { value: number; label: string; go?: boolean }) {
  return (
    <div
      className={cx(
        'flex-1 rounded-xl border px-4 py-4 text-center',
        go ? 'border-signal-go/30 bg-signal-go/5' : 'border-navy-950/30 bg-navy-950/5',
      )}
    >
      <p
        className={cx(
          'tabular font-display text-display font-bold',
          go ? 'text-signal-go-ink' : 'text-navy-950',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] tracking-[0.18em] text-ink-muted uppercase">{label}</p>
    </div>
  );
}

export const StageArrow = () => (
  <ArrowRight aria-hidden className="size-4 shrink-0 text-ink-muted/60" />
);
