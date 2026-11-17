'use client';

// "Who did this", wherever a record is shown (decision 0020): created by and last changed by,
// with names, and a History drawer for people who may see the full trail.
import type { RecordStamp as Stamp, TrailEntry } from '@campusverse/platform-audit';
import { Avatar, RecordDrawer, SkeletonRows, cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useMe } from './me';

const t = en.activity;

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
const rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "2 hours ago" for the last day, then the date and time. */
export function ago(iso: string, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(secs);
  if (abs < 60) return rel.format(0, 'second');
  if (abs < 3600) return rel.format(Math.round(secs / 60), 'minute');
  if (abs < 86_400) return rel.format(Math.round(secs / 3600), 'hour');
  return when.format(new Date(iso));
}

/** Audit actions that bring a record into being. */
const CREATION =
  /[.](create|define|provision|onboard|complete_onboarding|enquire|enquiry|admit|add|issue|request|import_commit)$/;

type Stamps = { stamps: Record<string, Stamp>; names: Record<string, string> };

export function useStamps(ids: string[]) {
  const list = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['stamps', list],
    queryFn: () => api.get<Stamps>(`/activity/stamps?ids=${list.join(',')}`),
    enabled: list.length > 0,
  });
}

/** One line under a record's title: who created it, who changed it last, and History. */
export function RecordStamp({ id, className }: { id: string; className?: string }) {
  const q = useStamps([id]);
  const { can } = useMe();
  const [open, setOpen] = useState(false);
  const s = q.data?.stamps[id];
  if (!s) return null;
  const name = (p: string | null) => (p ? (q.data?.names[p] ?? t.someone) : t.someone);
  // Older records were created before auditing began: their first row is a change, not a creation.
  const created = CREATION.test(s.firstAction);
  const showChanged = !created || s.changes > 1;
  return (
    <p
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted',
        className,
      )}
    >
      {created && <span>{t.created(name(s.createdBy), ago(s.createdAt))}</span>}
      {created && showChanged && <span aria-hidden>·</span>}
      {showChanged && <span>{t.changed(name(s.changedBy), ago(s.changedAt))}</span>}
      {can('platform.activity.read') && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-navy-950 hover:bg-navy-50"
          >
            <History aria-hidden className="size-3.5" />
            {t.history}
          </button>
          <HistoryDrawer id={id} open={open} onOpenChange={setOpen} />
        </>
      )}
    </p>
  );
}

export function HistoryDrawer({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ['history', id],
    queryFn: () =>
      api.get<{ trail: TrailEntry[]; names: Record<string, string> }>(`/activity/${id}`),
    enabled: open,
  });
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t.historyTitle}
      subtitle={t.historyLead}
      closeLabel={t.close}
    >
      {q.isPending ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : !q.data || q.data.trail.length === 0 ? (
        <p className="text-body text-ink-muted">{t.empty}</p>
      ) : (
        <ol className="relative flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[17px] before:w-px before:bg-line">
          {q.data.trail.map((e, i) => {
            const who = e.actorPersonId ? (q.data.names[e.actorPersonId] ?? t.someone) : t.someone;
            return (
              <li key={i} className="relative flex gap-3">
                <span className="relative rounded-full ring-4 ring-surface">
                  <Avatar name={who} />
                </span>
                <span className="flex min-w-0 flex-col pt-1">
                  <span className="text-body text-ink">
                    <span className="font-semibold">{who}</span>{' '}
                    {t.actions[e.action] ??
                      e.action.split('.').slice(1).join(' ').replaceAll('_', ' ')}
                  </span>
                  <span className="text-caption text-ink-muted">{ago(e.at)}</span>
                  {e.reason && (
                    <span className="mt-1 text-caption text-ink">{t.reason(e.reason)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </RecordDrawer>
  );
}
