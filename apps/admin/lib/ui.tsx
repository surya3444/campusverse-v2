'use client';

// Small shared pieces for portal pages: query states, a labelled field, chips and notices.
import { StatePanel, cx } from '@campusverse/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { en } from '../messages/en';
import { ApiFailure } from './api';

export const field =
  'h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

export const errorText = (e: unknown) => en.error(e instanceof ApiFailure ? e.code : 'error');

/** Loading, denied, offline, error and empty states for one query; children render the data. */
export function Loaded<T>({
  q,
  empty,
  children,
}: {
  q: UseQueryResult<T>;
  empty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  if (q.isPending) return <StatePanel kind="loading" title={en.states.loading} />;
  if (q.isError)
    return q.error instanceof ApiFailure && q.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied} body={en.states.deniedBody} />
    ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
      <StatePanel kind="offline" title={en.states.offline} />
    ) : (
      <StatePanel kind="error" title={en.states.error} body={errorText(q.error)} />
    );
  if (empty?.(q.data)) return <StatePanel kind="empty" title={en.states.empty} />;
  return <>{children(q.data)}</>;
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

const TONE: Record<string, string> = {
  active: 'bg-signal-go-tint text-signal-go-ink',
  approved: 'bg-signal-go-tint text-signal-go-ink',
  on: 'bg-signal-stop-tint text-signal-stop-ink',
  suspended: 'bg-signal-stop-tint text-signal-stop-ink',
  requested: 'bg-signal-warn-tint text-signal-warn-ink',
  closed: 'bg-paper text-ink-muted',
  rejected: 'bg-paper text-ink-muted',
};

export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
        TONE[tone] ?? 'bg-navy-50 text-navy-700',
      )}
    >
      {children}
    </span>
  );
}

export function Notice({ error, ok }: { error?: unknown; ok?: string | false | undefined }) {
  if (error)
    return (
      <p role="alert" className="text-caption text-signal-stop-ink">
        {errorText(error)}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="text-caption text-signal-go-ink">
        {ok}
      </p>
    );
  return null;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <h2 className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
export const at = (ts: string | null) => (ts ? when.format(new Date(ts)) : '—');
