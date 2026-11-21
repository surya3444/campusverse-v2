'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiFailure, api } from '../../../lib/api';
import { useChosenInstitution } from '../../../lib/scope';
import { useView } from '../../../lib/view';
import { en } from '../../../messages/en';

export const t = en.attendance;

export const errorText = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';

/**
 * The institution chosen in the scope switcher, or the first one in the person's view. Only
 * institutions inside the saved view count; without a view (it failed) every one does.
 */
export function useInstitution(enabled = true) {
  const chosen = useChosenInstitution();
  const q = useQuery({
    queryKey: ['institutions'],
    queryFn: () =>
      api.get<{ id: string; name: string; profile: string }[]>('/school/setup/institutions'),
    enabled,
  });
  const view = useView(enabled);
  const inView = view.data ? new Set(view.data.institutionIds) : null;
  const list = inView ? q.data?.filter((i) => inView.has(i.id)) : q.data;
  const found = list?.find((i) => i.id === chosen) ?? list?.[0];
  return {
    ...q,
    isPending: q.isPending || (enabled && view.isPending),
    institutionId: found?.id,
    institutionName: found?.name,
    /** Rule book §12.3: school, affiliated_college, autonomous_college or university. */
    profile: found?.profile,
    /** The institutions in the view, for screens that show several at once. */
    inView: list ?? [],
  };
}

export const STATE_CHIP: Record<string, string> = {
  not_taken: 'bg-signal-warn-tint text-signal-warn-ink',
  submitted: 'bg-signal-go-tint text-signal-go-ink',
  signed_off: 'bg-navy-50 text-navy-700',
  holiday: 'bg-paper text-ink-muted',
};

export const STATUS_TILE: Record<string, string> = {
  present: 'border-line bg-surface text-ink',
  absent: 'border-signal-stop bg-signal-stop-tint text-signal-stop-ink',
  late: 'border-signal-warn bg-signal-warn-tint text-signal-warn-ink',
  half_day: 'border-signal-warn bg-signal-warn-tint text-signal-warn-ink',
  approved_leave: 'border-line bg-navy-50 text-navy-700',
  medical_leave: 'border-line bg-navy-50 text-navy-700',
  school_duty: 'border-line bg-navy-50 text-navy-700',
  holiday: 'border-line bg-paper text-ink-muted',
};

const dayMonth = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
export const shortDate = (iso: string) => dayMonth.format(new Date(`${iso}T00:00:00Z`));
const time = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
export const clock = (ts: string) => time.format(new Date(ts));
