'use client';

import type { NoticeSummary } from '@campusverse/shared-communications';
import { EmptyState, PageHeader, StatePanel, cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';
import Link from 'next/link';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';

const t = en.notices;
export const noticeError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';

export const NOTICE_CHIP: Record<string, string> = {
  draft: 'bg-paper text-ink-muted',
  approved: 'bg-navy-50 text-navy-700',
  scheduled: 'bg-signal-warn-tint text-signal-warn-ink',
  sending: 'bg-signal-warn-tint text-signal-warn-ink',
  sent: 'bg-signal-go-tint text-signal-go-ink',
  cancelled: 'bg-paper text-ink-faint',
};

/** Delivered-or-better out of all, for the list's one-line summary. */
export function reached(counts: Record<string, number>) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const ok = (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.acknowledged ?? 0);
  return { total, ok, failed: counts.failed ?? 0 };
}

export function NoticesList() {
  const school = useInstitution();
  const id = school.institutionId;
  const notices = useQuery({
    queryKey: ['notices', id],
    queryFn: () => api.get<NoticeSummary[]>(`/communications/${id}/notices`),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const body =
    school.isPending || (notices.isPending && !!id) ? (
      <StatePanel kind="loading" title={en.states.loading.title} />
    ) : notices.error instanceof ApiFailure && notices.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : school.isError || notices.isError ? (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={noticeError(school.error ?? notices.error)}
        action={en.states.error.action}
        onAction={() => void notices.refetch()}
      />
    ) : !notices.data || notices.data.length === 0 ? (
      <div className="panel">
        <EmptyState
          art="notices"
          area="violet"
          title={t.empty}
          body={t.emptyBody}
          actions={
            <Link
              href="/notices/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-900"
            >
              <Plus aria-hidden className="size-4" />
              {t.compose}
            </Link>
          }
        />
      </div>
    ) : (
      <ul className="panel divide-y divide-line">
        {notices.data.map((n) => {
          const r = reached(n.counts);
          return (
            <li key={n.id}>
              <Link
                href={`/notices/${n.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-paper"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium text-ink">{n.title}</span>
                  <span className="text-caption text-ink-muted">
                    {t.kinds[n.kind]} · {n.createdBy}
                  </span>
                </span>
                {r.total > 0 && (
                  <span className="tabular text-caption text-ink-muted">
                    {r.ok}/{r.total} {t.messageStates.delivered?.toLowerCase()}
                    {r.failed > 0 && (
                      <span className="text-signal-stop-ink">
                        {' '}
                        · {r.failed} {t.messageStates.failed?.toLowerCase()}
                      </span>
                    )}
                  </span>
                )}
                <span
                  className={cx(
                    'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                    NOTICE_CHIP[n.state],
                  )}
                >
                  {t.states[n.state]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Megaphone}
        art="notices"
        eyebrow={en.nav.groups.messages}
        area="violet"
        title={t.title}
        description={t.lead}
        actions={
          <Link
            href="/notices/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-navy-950 px-3.5 text-body font-medium text-white hover:bg-navy-900"
          >
            <Plus aria-hidden className="size-4" />
            {t.compose}
          </Link>
        }
      />
      {body}
    </div>
  );
}
