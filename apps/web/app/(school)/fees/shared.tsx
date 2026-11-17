'use client';

import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

export const t = en.fees;

export const feeError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';

/** A new key per collection form: a retried submit sends the same key and gets the same receipt. */
export const newIdempotencyKey = () => `counter-${crypto.randomUUID()}`;

/** POST with an Idempotency-Key header, for writes that move money. */
export async function postOnce<T>(path: string, key: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'campusverse',
      'idempotency-key': key,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as T;
  const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  throw new ApiFailure(res.status, err.code ?? 'error', err.message ?? '');
}

export { api };

export const INVOICE_CHIP: Record<string, string> = {
  paid: 'bg-signal-go-tint text-signal-go-ink',
  part_paid: 'bg-signal-warn-tint text-signal-warn-ink',
  overdue: 'bg-signal-stop-tint text-signal-stop-ink',
  issued: 'bg-navy-50 text-navy-700',
  adjusted: 'bg-paper text-ink-muted',
  written_off: 'bg-paper text-ink-faint',
};

const dmy = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const date = (iso: string) => dmy.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
