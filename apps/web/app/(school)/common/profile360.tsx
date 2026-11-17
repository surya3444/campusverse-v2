'use client';

// The 360 profile, as in the Campusverse hub (decision 0022): a navy banner hero with the
// photo overlapping it, a row of stat cards, segmented tabs, and icon-titled panels. Used by the
// student and staff records so both read the same.
import { cx } from '@campusverse/ui';
import type { LucideIcon } from 'lucide-react';
import { Tabs } from 'radix-ui';
import type { ReactNode } from 'react';

/** The banner hero: a label on the navy band, the photo over its edge, name, status, contact, chips. */
export function ProfileHero({
  label,
  labelIcon: LabelIcon,
  photo,
  name,
  status,
  subtitle,
  contact,
  chips,
  stamp,
}: {
  label: string;
  labelIcon: LucideIcon;
  photo: ReactNode;
  name: string;
  status?: ReactNode;
  subtitle?: ReactNode;
  contact?: ReactNode;
  chips?: { icon: LucideIcon; label: string }[];
  stamp?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] motion-safe:animate-rise">
      <div
        className="relative h-[120px] overflow-hidden"
        style={{
          background:
            'linear-gradient(115deg, #04266d 0%, hsl(218 70% 30%) 50%, hsl(206 75% 42%) 100%)',
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,.95) 1px, transparent 0)',
            backgroundSize: '18px 18px',
            maskImage: 'linear-gradient(100deg, transparent 15%, #000 85%)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-cyan-400/25 blur-3xl"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <p className="relative flex items-center gap-2 px-6 pt-5 text-caption font-semibold tracking-[0.18em] text-white uppercase sm:pl-[172px]">
          <LabelIcon aria-hidden className="size-4 text-cyan-400" />
          <span className="drop-shadow-sm">{label}</span>
        </p>
      </div>
      <div className="relative px-6 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="relative -mt-16 shrink-0 self-start">{photo}</div>
          <div className="min-w-0 flex-1 pt-1 sm:pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-display leading-tight font-bold tracking-tight text-ink md:text-[2.125rem]">
                {name}
              </h1>
              {status}
            </div>
            {subtitle && <p className="mt-0.5 text-[0.9375rem] text-ink-muted">{subtitle}</p>}
            {contact && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-ink-muted">
                {contact}
              </div>
            )}
            {stamp && <div className="mt-1.5">{stamp}</div>}
          </div>
        </div>
        {chips && chips.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
            {chips.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-50/70 px-2.5 py-1.5 text-caption font-medium text-ink"
              >
                <c.icon aria-hidden className="size-3.5 text-ink-muted" />
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** One stat card in the row under the hero. */
export function StatCard({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="group relative h-full overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-8 size-24 rounded-full bg-navy-950/[0.07] blur-xl"
      />
      <div className="relative flex items-center justify-between">
        <p className="text-caption font-medium text-ink-muted">{label}</p>
        <Icon aria-hidden className="size-4 text-navy-950/70" />
      </div>
      <div className="relative mt-2">{children}</div>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/** A percentage ring (attendance, readiness). `value` 0–100 or null for none yet. */
export function Ring({
  value,
  size = 44,
  tone = 'navy',
  label,
}: {
  value: number | null;
  size?: number;
  tone?: 'navy' | 'go' | 'stop';
  label: string;
}) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const stroke =
    tone === 'go' ? 'stroke-signal-go' : tone === 'stop' ? 'stroke-signal-stop' : 'stroke-navy-950';
  return (
    <span
      role="img"
      aria-label={label}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="fill-none stroke-navy-50"
          strokeWidth={4}
        />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            className={cx('fill-none', stroke)}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
          />
        )}
      </svg>
      <span aria-hidden className="tabular absolute text-[11px] font-semibold text-ink">
        {value === null ? '–' : `${Math.round(pct)}%`}
      </span>
    </span>
  );
}

/** A thin bar for "paid of billed". */
export function Meter({ value, tone = 'go' }: { value: number; tone?: 'go' | 'navy' | 'stop' }) {
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-navy-50">
      <span
        className={cx(
          'block h-full rounded-full',
          tone === 'go' ? 'bg-signal-go' : tone === 'stop' ? 'bg-signal-stop' : 'bg-navy-950',
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

/** An icon-titled panel, as the hub's profile sections. */
export function ProfilePanel({
  title,
  icon: Icon,
  description,
  action,
  children,
  id,
}: {
  title: string;
  icon: LucideIcon;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id ? `${id}-title` : undefined}
      aria-label={id ? undefined : title}
      className="panel flex flex-col gap-4 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            id={id ? `${id}-title` : undefined}
            className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold text-ink"
          >
            <Icon aria-hidden className="size-4 text-navy-950" />
            {title}
          </h2>
          {description && <p className="mt-0.5 text-body text-ink-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The hub's segmented tabs (TabsList / TabsTrigger), on radix Tabs. */
export function ProfileTabsList({
  label,
  tabs,
}: {
  label: string;
  tabs: { value: string; label: string }[];
}) {
  return (
    <Tabs.List
      aria-label={label}
      className="inline-flex h-10 max-w-full items-center self-start overflow-x-auto rounded-lg bg-navy-50 p-1 text-ink-muted"
    >
      {tabs.map((t) => (
        <Tabs.Trigger
          key={t.value}
          value={t.value}
          className="inline-flex shrink-0 items-center justify-center rounded-md px-3 py-1.5 text-body font-medium whitespace-nowrap transition-all hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_0_rgb(0_0_0/0.05)]"
        >
          {t.label}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

/** Label-over-value pairs in a two-column grid (personal info, job details). */
export function InfoGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-body text-ink-muted">{i.label}</dt>
          <dd className="text-[0.9375rem] font-medium break-words text-ink">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
