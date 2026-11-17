import { AlertTriangle, CheckCircle2, CloudOff, Inbox, Lock, RotateCcw } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

export type Tone = 'neutral' | 'go' | 'warn' | 'stop';

/** Solid tone colours for stripes, dots and bars. */
export const toneBar: Record<Tone, string> = {
  neutral: 'bg-navy-200',
  go: 'bg-signal-go',
  warn: 'bg-signal-warn',
  stop: 'bg-signal-stop',
};

/** Soft tinted backgrounds with readable text, for chips and highlighted rows. */
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-navy-50 text-navy-700',
  go: 'bg-signal-go-tint text-signal-go-ink',
  warn: 'bg-signal-warn-tint text-signal-warn-ink',
  stop: 'bg-signal-stop-tint text-signal-stop-ink',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

/** Primary is the one strong action on a surface. Secondary and quiet sit beside it. */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        // The reference's button: rounded-lg, 14 px medium, soft shadow on solid ones.
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] duration-200 [&_svg]:size-4 [&_svg]:shrink-0',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-9 rounded-md px-3 text-caption',
        size === 'md' && 'h-10 px-4 text-body',
        size === 'lg' && 'h-11 px-6 text-[1rem]',
        variant === 'primary' &&
          'bg-navy-950 text-white shadow-[var(--shadow-button)] hover:bg-navy-950/90 active:shadow-[var(--shadow-card)]',
        variant === 'secondary' &&
          'border border-line bg-surface text-ink shadow-[var(--shadow-card)] hover:bg-navy-50',
        variant === 'danger' &&
          'bg-signal-stop-ink text-white shadow-[var(--shadow-button)] hover:bg-signal-stop-ink/90',
        variant === 'quiet' && 'text-ink hover:bg-navy-50',
        className,
      )}
      {...rest}
    />
  );
}

export type ViewState = 'ready' | 'loading' | 'empty' | 'error' | 'offline' | 'denied';

const STATE_ICON = {
  loading: Inbox,
  empty: Inbox,
  error: AlertTriangle,
  offline: CloudOff,
  denied: Lock,
} as const;

const STATE_TONE = {
  loading: 'bg-navy-50 text-navy-700',
  empty: 'bg-navy-50 text-navy-700',
  error: 'bg-signal-stop-tint text-signal-stop-ink',
  offline: 'bg-signal-warn-tint text-signal-warn-ink',
  denied: 'bg-navy-50 text-navy-700',
} as const;

/**
 * The shared look for loading, empty, error, offline and denied. Every screen uses it, so the
 * same situation always looks and reads the same.
 */
export function StatePanel({
  kind,
  title,
  body,
  action,
  onAction,
  className,
}: {
  kind: Exclude<ViewState, 'ready'>;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  const Icon = STATE_ICON[kind];
  if (kind === 'loading')
    return (
      <div
        role="status"
        aria-busy
        aria-label={title}
        className={cx('panel flex flex-col gap-3 p-6', className)}
      >
        <span className="skeleton h-4 w-1/3" />
        <span className="skeleton h-3 w-2/3" />
        <span className="skeleton h-3 w-1/2" />
      </div>
    );
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'panel flex flex-col items-center gap-3 px-6 py-10 text-center motion-safe:animate-rise',
        className,
      )}
    >
      <span
        className={cx(
          'flex size-12 shrink-0 items-center justify-center rounded-xl',
          STATE_TONE[kind],
        )}
      >
        <Icon aria-hidden className="size-6" />
      </span>
      <p className="text-lead font-semibold text-ink">{title}</p>
      {body && <p className="max-w-md text-body text-ink-muted">{body}</p>}
      {action && onAction && (
        <Button variant="secondary" onClick={onAction} className="mt-1">
          {kind === 'error' && <RotateCcw aria-hidden className="size-3.5" />}
          {action}
        </Button>
      )}
    </div>
  );
}

/** A thin banner for "you are offline, this is what we last had". Content stays usable below it. */
export function OfflineBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-md border border-signal-warn/30 bg-signal-warn-tint px-4 py-2.5 text-body text-signal-warn-ink"
    >
      <CloudOff aria-hidden className="size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Polite live region for confirmations like "Reminders queued", shown as a quiet toast. */
export function Announcer({ message }: { message: string | null }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 sm:justify-end sm:px-6"
    >
      {message && (
        <p className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-body text-ink shadow-[var(--shadow-overlay)]">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-signal-go" />
          {message}
        </p>
      )}
    </div>
  );
}

/** A quiet section heading with an optional count and action, used above panels. */
export function SectionHeader({
  title,
  count,
  children,
  id,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <h2 id={id} className="text-body font-semibold text-ink">
        {title}
      </h2>
      {count !== undefined && (
        <span className="tabular rounded-full bg-navy-50 px-2 text-caption font-medium text-navy-700">
          {count}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
