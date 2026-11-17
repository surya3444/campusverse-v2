// Design 3.0 building blocks: page headers, sections, empty states, avatars, stats, progress and
// segmented controls. Every screen is built from these, so the product reads as one thing.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Illustration, type IllustrationName } from './illustrations';
import { cx, type Tone } from './primitives';

/** One quiet colour per area of the product, for its icon tile and soft tints. */
export type Area = 'navy' | 'violet' | 'teal' | 'sky' | 'rose' | 'amber' | 'go';

export const areaTile: Record<Area, string> = {
  navy: 'bg-navy-50 text-navy-950',
  violet: 'bg-violet-tint text-violet-ink',
  teal: 'bg-teal-tint text-teal-ink',
  sky: 'bg-sky-tint text-sky-ink',
  rose: 'bg-rose-tint text-rose-ink',
  amber: 'bg-amber-tint text-amber-ink',
  go: 'bg-signal-go-tint text-signal-go-ink',
};

export function IconTile({
  icon: Icon,
  area = 'navy',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  area?: Area;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center',
        size === 'xs' && 'size-6 rounded-full',
        size === 'sm' && 'size-8 rounded-md',
        size === 'md' && 'size-10 rounded-lg',
        size === 'lg' && 'size-12 rounded-xl',
        areaTile[area],
        className,
      )}
    >
      <Icon
        className={
          size === 'lg'
            ? 'size-6'
            : size === 'md'
              ? 'size-5'
              : size === 'sm'
                ? 'size-4'
                : 'size-3.5'
        }
      />
    </span>
  );
}

/**
 * The top of every screen, editorial and open on the page: an uppercase eyebrow with the area's
 * mark, a large title, one line on why, chips under it and the main actions on the right.
 * `dark` is the midnight welcome card (the home screen), the only header with artwork.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  dark = false,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  /** Kept for callers; the header no longer tints by area or shows artwork (decision 0022). */
  area?: Area;
  art?: IllustrationName;
  dark?: boolean;
  actions?: ReactNode;
  /** A row under the title: chips, counts, tabs, the date. */
  children?: ReactNode;
}) {
  const Icon = icon;
  if (dark) {
    // The reference's dashboard greeting: open on the page, a tracked eyebrow with a cyan mark, an
    // oversized title whose last word runs navy to cyan, and a cyan full stop.
    const words = title.replace(/[.!]$/, '').split(' ');
    const last = words.pop() ?? '';
    return (
      <header className="relative motion-safe:animate-rise">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-56 bg-[radial-gradient(60%_100%_at_20%_0%,rgb(10_197_255/0.08),transparent_70%)]"
        />
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-3">
            {eyebrow && (
              <p className="flex items-center gap-2 text-caption font-semibold tracking-[0.18em] text-ink-muted uppercase">
                {Icon && <Icon aria-hidden className="size-3.5 text-cyan-400" />}
                {eyebrow}
              </p>
            )}
            <h1 className="font-display text-[2.5rem] leading-[1.05] font-bold tracking-tight text-ink md:text-[3.5rem]">
              {words.length > 0 && `${words.join(' ')} `}
              <span className="bg-linear-to-r from-navy-950 from-40% to-[#0a8fd6] bg-clip-text text-transparent">
                {last}
              </span>
              <span aria-hidden className="text-cyan-400">
                .
              </span>
            </h1>
            {description && <p className="max-w-2xl text-[1rem] text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>}
      </header>
    );
  }
  // The reference's module header: a compact display title, one line of purpose, the main
  // actions on the right, then tabs or chips. (The dashboard's greeting is the `dark` variant.)
  return (
    <header className="relative motion-safe:animate-rise">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-title font-bold tracking-tight text-ink">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-3xl text-body text-ink-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** A titled panel. Use `flush` for tables and lists that run edge to edge. */
export function Section({
  title,
  description,
  actions,
  children,
  footer,
  flush = false,
  id,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  id?: string;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  // The reference's Card: rounded, hairline border, the faintest shadow; the title in the
  // display face; no rule under the header.
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cx('panel flex flex-col', className)}
    >
      {title && (
        <div className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2
              id={headingId}
              className="font-display text-[1.0625rem] leading-6 font-semibold text-ink"
            >
              {title}
            </h2>
            {description && <p className="text-body text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div
        className={cx(
          !flush && 'px-6 pb-6',
          !flush && !title && 'pt-6',
          flush && title && 'border-t border-line/70',
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line/70 px-6 py-3 text-caption text-ink-muted">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * An empty screen or section that says what goes here, why it matters, and the next step,
 * never just "nothing here".
 */
export function EmptyState({
  icon,
  art,
  area = 'navy',
  title,
  body,
  actions,
  tips,
  compact = false,
}: {
  icon?: LucideIcon;
  /** An illustration instead of the icon tile, for first-run screens. */
  art?: IllustrationName;
  area?: Area;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  tips?: readonly string[];
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center text-center motion-safe:animate-rise',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
      )}
    >
      {art ? (
        <Illustration name={art} className={compact ? 'w-36' : 'w-52'} />
      ) : (
        icon && <IconTile icon={icon} area={area} size={compact ? 'md' : 'lg'} />
      )}
      <p className={cx('font-semibold text-ink', compact ? 'text-body' : 'text-lead')}>{title}</p>
      {body && <p className="max-w-md text-body text-ink-muted">{body}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
      {tips && tips.length > 0 && (
        <ul className="mt-3 flex max-w-md flex-col gap-1.5 text-left text-caption text-ink-muted">
          {tips.map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-navy-200" />
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const AVATAR_AREAS: Area[] = ['navy', 'violet', 'teal', 'sky', 'rose', 'amber'];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

/** Initials in a stable colour per name, so the same person always looks the same. */
export function Avatar({
  name,
  size = 'md',
  src,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** A photo. If it can't load (none yet, or still being scanned), the initials show through. */
  src?: string | null | undefined;
}) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const area = AVATAR_AREAS[h % AVATAR_AREAS.length] ?? 'navy';
  return (
    <span
      aria-hidden
      className={cx(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold',
        size === 'sm' && 'size-7 text-[11px]',
        size === 'md' && 'size-9 text-caption',
        size === 'lg' && 'size-12 text-body',
        size === 'xl' && 'size-28 text-[2.5rem]',
        // The reference: soft blue-grey initials in navy, the same for everyone.
        area && 'bg-[linear-gradient(135deg,#e3ebf5,#d5e0ee)] font-display text-navy-950',
      )}
    >
      {initials(name)}
      {src && (
        // An empty alt draws nothing when the image fails, so the initials stay visible.
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

const PILL: Record<Tone, string> = {
  neutral: 'border-line bg-navy-50 text-ink-muted',
  go: 'border-signal-go/25 bg-signal-go/10 text-signal-go-ink',
  warn: 'border-signal-warn/25 bg-signal-warn/10 text-signal-warn-ink',
  stop: 'border-signal-stop/20 bg-signal-stop/10 text-signal-stop-ink',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-navy-700',
  go: 'bg-signal-go',
  warn: 'bg-signal-warn',
  stop: 'bg-signal-stop',
};

/** A status: a soft pill with a dot, so it reads at a glance and in grey-scale. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
        PILL[tone],
      )}
    >
      <span aria-hidden className={cx('size-1.5 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

/** One key number with its meaning. Numbers use tabular figures. */
export function Stat({
  label,
  value,
  note,
  icon,
  area = 'navy',
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: LucideIcon;
  area?: Area;
  tone?: Tone;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <IconTile icon={icon} area={area} size="sm" className="mt-0.5" />}
      <div className="flex min-w-0 flex-col">
        <span className="text-caption font-medium text-ink-muted">{label}</span>
        <span className="tabular font-display text-title font-semibold text-ink">{value}</span>
        {note && (
          <span
            className={cx(
              'text-caption',
              tone === 'stop'
                ? 'text-signal-stop-ink'
                : tone === 'warn'
                  ? 'text-signal-warn-ink'
                  : tone === 'go'
                    ? 'text-signal-go-ink'
                    : 'text-ink-muted',
            )}
          >
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

/** A thin progress bar with an accessible value. */
export function Progress({
  value,
  max = 100,
  tone = 'go',
  label,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50"
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'go' && 'bg-signal-go',
          tone === 'warn' && 'bg-signal-warn',
          tone === 'stop' && 'bg-signal-stop',
          tone === 'neutral' && 'bg-navy-950',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** A ring for "how far along": setup progress, sections marked. */
export function ProgressRing({
  value,
  max = 100,
  size = 56,
  tone = 'go',
  label,
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  tone?: Tone;
  label: string;
  children?: ReactNode;
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const stroke =
    tone === 'go'
      ? 'stroke-signal-go'
      : tone === 'warn'
        ? 'stroke-signal-warn'
        : tone === 'stop'
          ? 'stroke-signal-stop'
          : 'stroke-navy-950';
  return (
    <div
      role="img"
      aria-label={label}
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="fill-none stroke-navy-50"
          strokeWidth={5}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={cx('fill-none transition-[stroke-dashoffset] duration-700', stroke)}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span className="tabular absolute text-caption font-semibold text-ink">{children}</span>
    </div>
  );
}

/** A small set of mutually exclusive choices, shown together (filters, views). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-10 max-w-full items-center overflow-x-auto rounded-lg bg-navy-50 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-body font-medium whitespace-nowrap transition-all',
            o.value === value
              ? 'bg-surface text-ink shadow-[0_1px_2px_0_rgb(0_0_0/0.05)]'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="tabular rounded-md bg-navy-100 px-1.5 text-[11px] text-ink">
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Search and filters above a list, with the count of what's shown. */
export function Toolbar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  // The reference's filter card: search and filters together in one white card.
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      {children}
      {count !== undefined && (
        <span className="tabular ml-auto text-caption text-ink-muted">{count}</span>
      )}
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-busy aria-label={label} className="flex flex-col divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <span className="skeleton size-9 rounded-full" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="skeleton h-3 w-1/3" />
            <span className="skeleton h-2.5 w-1/5" />
          </span>
        </div>
      ))}
    </div>
  );
}
