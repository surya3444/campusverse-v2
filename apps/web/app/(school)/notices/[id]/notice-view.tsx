'use client';

import type { NoticeDetail, NoticePreview } from '@campusverse/shared-communications';
import { Button, PreviewCanvas, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { clock } from '../../attendance/shared';
import { NOTICE_CHIP, noticeError } from '../notices-list';

const t = en.notices;

const MESSAGE_CHIP: Record<string, string> = {
  acknowledged: 'bg-signal-go-tint text-signal-go-ink',
  read: 'bg-signal-go-tint text-signal-go-ink',
  delivered: 'bg-signal-go-tint text-signal-go-ink',
  sent: 'bg-navy-50 text-navy-700',
  fallback_sent: 'bg-signal-warn-tint text-signal-warn-ink',
  queued: 'bg-paper text-ink-muted',
  failed: 'bg-signal-stop-tint text-signal-stop-ink',
};

/** Seconds until a time, ticking; 0 once it has passed. */
function useCountdown(at: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  return at ? Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)) : 0;
}

export function NoticeView({ id }: { id: string }) {
  const qc = useQueryClient();
  const key = ['notice', id];
  const notice = useQuery({
    queryKey: key,
    queryFn: () => api.get<NoticeDetail>(`/communications/notices/${id}`),
    // Live while it is going out; delivery keeps changing for a while after.
    refetchInterval: (q) =>
      q.state.data && ['draft', 'approved', 'cancelled'].includes(q.state.data.state)
        ? false
        : 3000,
  });
  const [preview, setPreview] = useState<NoticePreview | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const approve = useMutation({
    mutationFn: () => api.post(`/communications/notices/${id}/approve`),
    onSuccess: refresh,
  });
  const ask = useMutation({
    mutationFn: () => api.post<NoticePreview>(`/communications/notices/${id}/preview`),
    onSuccess: setPreview,
  });
  const send = useMutation({
    mutationFn: () => api.post(`/communications/notices/${id}/send`),
    onSuccess: () => {
      setPreview(null);
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/communications/notices/${id}/cancel`),
    onSuccess: refresh,
  });
  const left = useCountdown(notice.data?.state === 'scheduled' ? notice.data.sendAt : null);

  if (notice.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (notice.isError) {
    return notice.error instanceof ApiFailure && notice.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={noticeError(notice.error)}
        action={en.states.error.action}
        onAction={() => void notice.refetch()}
      />
    );
  }
  const n = notice.data;
  const english = n.versions.find((v) => v.language === 'en');
  const urgent = n.kind === 'urgent';
  const error = approve.error ?? ask.error ?? send.error ?? cancel.error;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/notices"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.title}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title font-semibold text-ink">{english?.title}</h1>
          <p className="text-caption text-ink-muted">
            {t.kinds[n.kind]} · {t.created(n.createdBy, clock(n.createdAt))}
            {n.approvedBy && ` · ${t.approvedBy(n.approvedBy)}`}
            {n.approval?.status === 'pending' &&
              ` · ${en.workflow.progress(
                n.approval.step,
                n.approval.steps,
                n.approval.stepRoleName ?? en.workflow.anyApprover,
              )}`}
          </p>
        </div>
        <span
          className={cx(
            'rounded-full px-2.5 py-0.5 text-caption font-medium',
            NOTICE_CHIP[n.state],
          )}
        >
          {t.states[n.state]}
        </span>
      </div>

      {n.state === 'scheduled' && left > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-signal-warn bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink"
        >
          <span className="tabular flex-1">{t.undo(left)}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t.cancel}
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {n.versions.map((v) => (
          <article
            key={v.language}
            lang={v.language}
            dir={v.language === 'ur' ? 'rtl' : 'ltr'}
            className="panel flex flex-col gap-2 p-5"
          >
            <span className="text-caption text-ink-muted">{t.languages[v.language]}</span>
            <h2 className="text-body font-semibold text-ink">{v.title}</h2>
            <p className="text-body whitespace-pre-line text-ink">{v.body}</p>
          </article>
        ))}
      </div>

      {(n.state === 'draft' || n.state === 'approved') && (
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {t.cancel}
          </Button>
          {n.state === 'draft' && !urgent && n.approval?.mine && (
            <Button
              variant="secondary"
              disabled={approve.isPending}
              onClick={() => approve.mutate()}
            >
              {t.approve}
            </Button>
          )}
          {(n.state === 'approved' || urgent) && (
            <Button disabled={ask.isPending} onClick={() => ask.mutate()}>
              {t.preview}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {noticeError(error)}
        </p>
      )}

      {(n.state === 'sending' || n.state === 'sent') && (
        <section aria-labelledby="tracking" className="flex flex-col gap-3">
          <h2 id="tracking" className="text-body font-semibold text-ink">
            {t.counts}
          </h2>
          <dl className="panel flex flex-wrap divide-x divide-line">
            {['acknowledged', 'read', 'delivered', 'sent', 'fallback_sent', 'queued', 'failed']
              .filter((s) => n.counts[s])
              .map((s) => (
                <div key={s} className="flex min-w-28 flex-col gap-0.5 px-5 py-3">
                  <dt className="text-caption text-ink-muted">{t.messageStates[s]}</dt>
                  <dd className="tabular text-title font-semibold text-ink">{n.counts[s]}</dd>
                </div>
              ))}
          </dl>
          {n.guardians.length === 0 ? (
            <StatePanel kind="empty" title={t.noRecipients} />
          ) : (
            <div
              role="region"
              aria-label={t.recipients}
              tabIndex={0}
              className="panel relative overflow-x-auto"
            >
              <table className="w-full min-w-[560px] text-body">
                <thead>
                  <tr className="border-b border-line bg-paper text-left text-caption text-ink-muted">
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      {t.guardian}
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      {t.state}
                    </th>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      {t.channelsCol}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {n.guardians.map((g) => (
                    <tr key={g.messageId}>
                      <td className="px-5 py-2.5 text-ink">{g.name}</td>
                      <td className="px-5 py-2.5">
                        <span
                          className={cx(
                            'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                            MESSAGE_CHIP[g.state],
                          )}
                        >
                          {t.messageStates[g.state] ?? g.state}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-caption text-ink-muted">
                        {g.channels
                          .map(
                            (c) =>
                              `${t.channels[c.channel]} ${t.channelStates[c.state] ?? c.state}${c.at ? ` ${clock(c.at)}` : ''}`,
                          )
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={t.previewTitle}
        actionLabel={urgent ? t.sendUrgent : t.send(preview?.recipients ?? 0)}
        changes={t.previewChanges(english?.title ?? '')}
        affected={[
          ...(preview?.byLanguage.map((l) => ({
            label: t.byLanguage(t.languages[l.language] ?? l.language),
            count: l.guardians,
          })) ?? []),
          { label: t.firstOn(t.channels.push ?? ''), count: preview?.firstChannel.push ?? 0 },
          {
            label: t.firstOn(t.channels.whatsapp ?? ''),
            count: preview?.firstChannel.whatsapp ?? 0,
          },
          { label: t.firstOn(t.channels.sms ?? ''), count: preview?.firstChannel.sms ?? 0 },
        ]}
        risks={[
          ...(preview && preview.unreachable > 0
            ? [t.previewUnreachable(preview.unreachable)]
            : []),
          ...(preview?.byLanguage
            .filter((l) => !l.hasVersion && l.guardians > 0)
            .map((l) => t.previewMissing(t.languages[l.language] ?? l.language, l.guardians)) ??
            []),
        ]}
        undo={urgent ? t.previewUndoUrgent : t.previewUndo}
        busy={send.isPending}
        labels={en.preview}
        onConfirm={() => send.mutate()}
      />
    </div>
  );
}
