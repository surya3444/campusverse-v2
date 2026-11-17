'use client';

import type { NoticeProof, ShortageReport, ShortageRow } from '@campusverse/school-attendance';
import { Announcer, Button, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { ReasonDialog } from '../../reason-dialog';
import { errorText, shortDate, t, useInstitution } from '../shared';

const STANDING_CHIP: Record<string, string> = {
  short: 'bg-signal-stop-tint text-signal-stop-ink',
  warning: 'bg-signal-warn-tint text-signal-warn-ink',
};

export function ShortageView() {
  const school = useInstitution();
  const id = school.institutionId;
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [opening, setOpening] = useState<ShortageRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: ShortageRow; grant: boolean } | null>(null);
  const [deadline, setDeadline] = useState('');
  const key = ['attendance-shortage', id];
  const report = useQuery({
    queryKey: key,
    queryFn: () => api.get<ShortageReport>(`/school/attendance/${id}/shortage`),
    enabled: !!id,
  });
  const notify = useMutation({
    mutationFn: (personId: string) =>
      api.post<{ id: string; messages: number }>(`/school/attendance/shortage/${personId}/notice`),
    onSuccess: (r) => {
      setMessage(t.noticeDone(r.messages));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (school.isPending || (report.isPending && !!id)) {
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  }
  if (school.isError || report.isError) {
    const denied = report.error instanceof ApiFailure && report.error.status === 403;
    return denied ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={errorText(school.error ?? report.error)}
        action={en.states.error.action}
        onAction={() => void report.refetch()}
      />
    );
  }
  const r = report.data;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-semibold text-ink">{t.shortageTitle}</h1>
        <p className="text-body text-ink-muted">
          {r?.rule
            ? t.rule(r.rule.minimumPercent, r.rule.warnBelowPercent, r.rule.source)
            : t.noRule}
        </p>
      </div>
      {!r || r.students.length === 0 ? (
        <StatePanel kind="empty" title={r?.rule ? t.noShortage : t.noRule} />
      ) : (
        <div
          role="region"
          aria-label={t.shortageTitle}
          tabIndex={0}
          className="panel relative overflow-x-auto"
        >
          <table className="w-full min-w-[720px] text-body">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.name}
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  {t.percent}
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.state}
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.proof}
                </th>
                <th scope="col" className="px-5 py-2.5">
                  <span className="sr-only">{t.notice}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.students.map((s) => (
                <tr key={s.personId}>
                  <td className="px-5 py-3">
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">{s.name}</span>
                      <span className="text-caption text-ink-muted">{s.sectionLabel}</span>
                    </span>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {s.percent}%
                    <span className="block text-caption text-ink-muted">
                      {t.workingDays}: {s.workingDays}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={cx(
                        'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                        STANDING_CHIP[s.standing],
                      )}
                    >
                      {t.standing[s.standing]}
                    </span>
                    {s.condonation && (
                      <span className="mt-1 block text-caption text-ink-muted">
                        {t.caseStates[s.condonation.status]}
                        {s.condonation.status === 'open' &&
                          ` · ${t.caseDue(shortDate(s.condonation.deadline))}`}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-caption">
                    {s.lastNotice ? (
                      <Proof noticeId={s.lastNotice.id} sentAt={s.lastNotice.sentAt} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={notify.isPending}
                        onClick={() => notify.mutate(s.personId)}
                      >
                        {t.notice}
                      </Button>
                      {s.standing === 'short' && !s.condonation && (
                        <Button size="sm" variant="secondary" onClick={() => setOpening(s)}>
                          {t.openCase}
                        </Button>
                      )}
                      {s.condonation?.status === 'open' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeciding({ row: s, grant: false })}
                          >
                            {t.refuse}
                          </Button>
                          <Button size="sm" onClick={() => setDeciding({ row: s, grant: true })}>
                            {t.grant}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notify.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {errorText(notify.error)}
        </p>
      )}

      {opening && (
        <ReasonDialog
          title={t.caseTitle(opening.name)}
          hint={t.caseHint}
          label={t.caseReason}
          action={t.caseAction}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setOpening(null)}
          submit={async (reason) => {
            await api.post('/school/attendance/condonation', {
              personId: opening.personId,
              reason,
              deadline,
            });
            await qc.invalidateQueries({ queryKey: key });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.caseDeadline}</span>
            <input
              type="date"
              required
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950"
            />
          </label>
        </ReasonDialog>
      )}
      {deciding?.row.condonation && (
        <ReasonDialog
          title={t.decideTitle(deciding.grant)}
          hint={t.decideHint}
          label={t.decideNote}
          action={deciding.grant ? t.grant : t.refuse}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setDeciding(null)}
          submit={async (note) => {
            await api.post(
              `/school/attendance/condonation/${deciding.row.condonation?.id}/decide`,
              {
                grant: deciding.grant,
                note,
              },
            );
            await qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** Where the last notice got to, per guardian: the school's evidence that it gave notice. */
function Proof({ noticeId, sentAt }: { noticeId: string; sentAt: string }) {
  const proof = useQuery({
    queryKey: ['attendance-notice', noticeId],
    queryFn: () => api.get<NoticeProof>(`/school/attendance/notices/${noticeId}`),
  });
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-ink">{t.noticeSent(shortDate(sentAt.slice(0, 10)))}</span>
      {proof.data?.messages.map((m) => (
        <span key={m.messageId} className="text-ink-muted">
          {m.state}
          {m.channels.length > 0 &&
            ` · ${m.channels.map((c) => `${c.channel} ${c.state}`).join(', ')}`}
        </span>
      ))}
    </span>
  );
}
