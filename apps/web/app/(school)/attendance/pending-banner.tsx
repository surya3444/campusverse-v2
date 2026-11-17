'use client';

import { Button } from '@campusverse/ui';
import { CloudOff, RefreshCw } from 'lucide-react';
import { flush, useSyncQueue } from '../../../lib/sync-queue';
import { t } from './shared';

/** Shows unsent submissions, so a teacher knows to reconnect before the phone is lost. */
export function PendingBanner() {
  const { count, online } = useSyncQueue();
  if (count === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-signal-warn bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink"
    >
      <CloudOff aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">{online ? t.pending(count) : t.pendingOffline(count)}</span>
      {online && (
        <Button size="sm" variant="secondary" onClick={() => void flush()}>
          <RefreshCw aria-hidden className="size-3.5" />
          {t.sendNow}
        </Button>
      )}
    </div>
  );
}
