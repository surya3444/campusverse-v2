'use client';

import { Announcer, Button, PreviewCanvas, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import {
  ErrorNote,
  failureText,
  keys,
  useRefreshSetup,
  type InvitePreview,
  type Readiness,
} from './shared';

export function InvitesStep({ institutionId }: { institutionId: string }) {
  const t = en.setup.invites;
  const refresh = useRefreshSetup(institutionId);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: keys.invites(institutionId),
    queryFn: () => api.get<InvitePreview>(`/school/setup/${institutionId}/invites`),
    // While the worker sends, keep checking until nobody is left to invite.
    refetchInterval: (q) =>
      sending && (q.state.data?.staff ?? 0) + (q.state.data?.guardians ?? 0) > 0 ? 1500 : false,
  });
  const send = useMutation({
    mutationFn: () => api.post(`/school/setup/${institutionId}/invites`),
    onSuccess: async () => {
      setConfirming(false);
      setSending(true);
      setMessage(t.sending);
      await refresh();
    },
  });

  // When the worker has invited everyone, the step and readiness change: refresh them once.
  const left = (invites.data?.staff ?? 0) + (invites.data?.guardians ?? 0);
  useEffect(() => {
    if (sending && left === 0) {
      setSending(false);
      void refresh();
    }
  }, [sending, left, refresh]);

  if (invites.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (invites.isError) return <StatePanel kind="error" title={failureText(invites.error)} />;
  const d = invites.data;
  const due = d.staff + d.guardians;

  return (
    <section className="panel" aria-labelledby="invites-title">
      <header className="border-b border-line px-5 py-4">
        <h2 id="invites-title" className="text-body font-semibold text-ink">
          {t.title}
        </h2>
        <p className="text-caption text-ink-muted">{t.help}</p>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {[
          [t.staff, d.staff],
          [t.guardians, d.guardians],
          [t.already, d.alreadyInvited],
          [t.noPhone, d.noPhone],
        ].map(([label, n]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface px-5 py-4">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="tabular font-display text-title font-semibold text-ink">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        <ErrorNote error={send.error} />
        {due === 0 ? (
          <p className="flex items-center gap-2 text-body text-ink-muted">
            <CheckCircle2 aria-hidden className="size-4 text-signal-go" />
            {t.none}
          </p>
        ) : (
          <Button disabled={sending} onClick={() => setConfirming(true)}>
            {sending ? t.sending : t.action(due)}
          </Button>
        )}
      </div>
      {confirming && (
        <PreviewCanvas
          open
          onOpenChange={setConfirming}
          title={t.canvasTitle}
          actionLabel={t.action(due)}
          changes={[t.change]}
          affected={[
            { label: t.staff, count: d.staff },
            { label: t.guardians, count: d.guardians },
          ]}
          risks={d.noPhone > 0 ? [t.risk] : []}
          undo={t.undo}
          busy={send.isPending}
          onConfirm={() => send.mutate()}
          labels={en.preview}
        />
      )}
      <Announcer message={message} />
    </section>
  );
}

export function ReadyStep({ readiness }: { readiness: Readiness }) {
  const t = en.setup.ready;
  return (
    <section className="panel" aria-labelledby="ready-title">
      <header
        className={cx(
          'flex items-center gap-3 border-b border-line px-5 py-4',
          readiness.ready ? 'bg-signal-go-tint' : 'bg-paper',
        )}
      >
        {readiness.ready ? (
          <CheckCircle2 aria-hidden className="size-5 text-signal-go" />
        ) : (
          <CircleAlert aria-hidden className="size-5 text-signal-warn" />
        )}
        <h2 id="ready-title" className="text-body font-semibold text-ink">
          {readiness.ready ? t.yes : t.no}
        </h2>
      </header>
      <ul className="divide-y divide-line">
        {readiness.checks.map((c) => (
          <li key={c.key} className="flex gap-3 px-5 py-3">
            {c.ok ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-go" />
            ) : (
              <Circle
                aria-hidden
                className={cx(
                  'mt-0.5 size-4 shrink-0',
                  c.blocking ? 'text-signal-stop' : 'text-ink-faint',
                )}
              />
            )}
            <div className="flex min-w-0 flex-col">
              <span className="text-body text-ink">
                {t.checks[c.key]}
                {!c.blocking && (
                  <span className="ml-2 text-caption text-ink-muted">· {t.advice}</span>
                )}
              </span>
              {!c.ok && c.missing.length > 0 && (
                <span className="text-caption text-ink-muted">
                  {t.missing(c.missing.join(', '))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
