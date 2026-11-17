'use client';

// Campus Core › Activity Log (rule book §13.12, P0 item 10): the organisation's append-only log,
// newest first, with Verse AI's steps, filters, and the hash-chain integrity check.
import type { DataClass, LogEntry, SealCheck } from '@campusverse/platform-audit';
import {
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { ago } from '../common/activity';
import { fieldInput } from '../common/custom-fields';

const t = en.activityLog;
const words = en.activity;
type Page = { entries: LogEntry[]; names: Record<string, string>; next: string | null };
const CLASSES: DataClass[] = ['operational', 'personal', 'sensitive', 'restricted'];

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const said = (action: string) =>
  words.actions[action] ?? action.split('.').slice(1).join(' ').replaceAll('_', ' ');

export function ActivityLogView() {
  const [dataClass, setDataClass] = useState('');
  const [day, setDay] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['activity-log', dataClass, day],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      if (pageParam) p.set('before', pageParam);
      if (dataClass) p.set('dataClass', dataClass);
      if (day) p.set('day', day);
      return api.get<Page>(`/activity/log?${p.toString()}`);
    },
    getNextPageParam: (last) => last.next,
  });
  const check = useMutation({ mutationFn: () => api.get<SealCheck>('/activity/verify') });
  const denied = q.error instanceof ApiFailure && q.error.status === 403;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ScrollText}
        area="navy"
        eyebrow={en.systems.groups.core}
        title={t.title}
        description={t.lead}
      />
      {denied ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : (
        <>
          <Section
            id="activity-integrity"
            title={t.integrity}
            description={t.integrityLead}
            actions={
              <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
                <ShieldCheck aria-hidden />
                {check.isPending ? t.checking : t.verify}
              </Button>
            }
          >
            <div aria-live="polite">
              {check.data ? (
                check.data.ok ? (
                  <p className="flex items-start gap-2 text-body text-ink">
                    <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-go" />
                    <span>
                      {t.intact(check.data.events, check.data.seals)}{' '}
                      {check.data.lastSealedAt && t.lastSealed(fmt(check.data.lastSealedAt))}
                    </span>
                  </p>
                ) : (
                  <p
                    role="alert"
                    className="flex items-start gap-2 text-body font-medium text-signal-stop-ink"
                  >
                    <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {t.broken(fmt(check.data.brokenAt ?? ''))}
                  </p>
                )
              ) : check.error ? (
                <p role="alert" className="text-body text-signal-stop-ink">
                  {en.states.error.title}
                </p>
              ) : (
                <p className="text-body text-ink-muted">{t.notChecked}</p>
              )}
            </div>
          </Section>

          <div className="flex flex-wrap items-end gap-4" role="group" aria-label={t.filters}>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.dataClass}</span>
              <select
                className={fieldInput}
                value={dataClass}
                onChange={(e) => setDataClass(e.target.value)}
              >
                <option value="">{t.anyClass}</option>
                {CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {t.classes[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.day}</span>
              <input
                type="date"
                className={fieldInput}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            {(dataClass || day) && (
              <Button
                variant="quiet"
                onClick={() => {
                  setDataClass('');
                  setDay('');
                }}
              >
                {t.clear}
              </Button>
            )}
          </div>

          {q.isPending ? (
            <SkeletonRows rows={8} label={en.states.loading.title} />
          ) : q.error ? (
            typeof navigator !== 'undefined' && !navigator.onLine ? (
              <StatePanel
                kind="offline"
                title={en.states.offline.title}
                body={en.states.offline.body}
              />
            ) : (
              <StatePanel kind="error" title={en.states.error.title} />
            )
          ) : q.data.pages[0]?.entries.length === 0 ? (
            <EmptyState icon={ScrollText} area="navy" title={t.empty} />
          ) : (
            <Section id="activity-log" title={t.title} description={t.retention} flush>
              <ol className="divide-y divide-line">
                {q.data.pages.flatMap((page) =>
                  page.entries.map((e) => {
                    const who = e.actorPersonId
                      ? (page.names[e.actorPersonId] ?? words.someone)
                      : words.someone;
                    return (
                      <li key={e.id} className="flex items-start gap-3 px-6 py-3">
                        <Avatar name={who} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-body text-ink">
                            <span className="font-semibold">{who}</span> {said(e.action)}{' '}
                            <span className="text-ink-muted">
                              {t.on(e.entityType.replaceAll('_', ' '))}
                            </span>
                          </span>
                          <span className="text-caption text-ink-muted">
                            <time dateTime={e.at} title={fmt(e.at)}>
                              {ago(e.at)}
                            </time>
                            {e.reason ? ` · ${words.reason(e.reason)}` : ''}
                          </span>
                        </span>
                        {e.dataClass !== 'operational' && (
                          <Pill tone={e.dataClass === 'personal' ? 'neutral' : 'warn'}>
                            {t.classes[e.dataClass]}
                          </Pill>
                        )}
                      </li>
                    );
                  }),
                )}
              </ol>
              {q.hasNextPage && (
                <div className="border-t border-line px-6 py-3">
                  <Button
                    variant="quiet"
                    disabled={q.isFetchingNextPage}
                    onClick={() => void q.fetchNextPage()}
                  >
                    {t.more}
                  </Button>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
