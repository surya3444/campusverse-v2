'use client';

import type { CertificateDetail, Warning } from '@campusverse/school-certificates';
import { Announcer, Button, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { ReasonDialog } from '../../reason-dialog';
import { STATE_CHIP, certError } from '../register-view';

const t = en.certificates;
const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

function warningText(w: Warning) {
  switch (w.code) {
    case 'dues':
      return t.warningText.dues(rupees(w.duePaise), w.blocks);
    case 'attendance_incomplete':
      return t.warningText.attendance_incomplete;
    case 'documents_pending':
      return t.warningText.documents_pending(w.count);
    case 'deadline':
      return t.warningText.deadline(w.dueBy);
  }
}

export function CertificateView({ id }: { id: string }) {
  const qc = useQueryClient();
  const key = ['certificate', id];
  const c = useQuery({
    queryKey: key,
    queryFn: () => api.get<CertificateDetail>(`/school/certificates/${id}`),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [dialog, setDialog] = useState<'cancel' | 'duplicate' | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const act = useMutation({
    mutationFn: (path: 'check' | 'approve' | 'issue') =>
      api.post<{ number?: string }>(`/school/certificates/${id}/${path}`),
    onSuccess: (r) => {
      if (r?.number) setMessage(t.issued(r.number));
      refresh();
    },
  });
  const portal = useMutation({
    mutationFn: () => api.post(`/school/certificates/${id}/portal-export`, {}),
    onSuccess: refresh,
  });

  if (c.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (c.isError) {
    return c.error instanceof ApiFailure && c.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={certError(c.error)} />
    );
  }
  const d = c.data;
  const editable = ['ready_for_review', 'clearance_pending'].includes(d.state);
  const issued = d.state === 'issued' || d.state === 'delivered';

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/certificates"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold text-ink">
            {t.kinds[d.kind]}
            {d.number && <span className="tabular text-ink-muted"> · {d.number}</span>}
          </h1>
          <p className="text-body text-ink-muted">
            {d.student}
            {d.version && d.version > 1 && ` · ${t.version(d.version)}`}
            {d.dueBy && !issued && ` · ${t.dueBy(d.dueBy)}`}
          </p>
        </div>
        <span
          className={cx('rounded-full px-3 py-1 text-caption font-medium', STATE_CHIP[d.state])}
        >
          {t.states[d.state]}
        </span>
      </div>

      {d.warnings.length > 0 && !issued && (
        <section
          aria-labelledby="warnings"
          className="flex flex-col gap-1 rounded-lg border border-signal-warn bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink"
        >
          <h2 id="warnings" className="font-semibold">
            {t.warnings}
          </h2>
          {d.warnings.map((w, i) => (
            <p key={i}>{warningText(w)}</p>
          ))}
        </section>
      )}

      <section aria-labelledby="draft" className="panel">
        <h2 id="draft" className="border-b border-line px-5 py-3 text-body font-semibold text-ink">
          {t.draft}
        </h2>
        <dl className="divide-y divide-line">
          {d.fields.map(([label, v]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 px-5 py-2.5 text-body"
            >
              <dt className="text-ink-muted">{label}</dt>
              {/* The edit button sits inside the description: a list row holds only dt and dd. */}
              <dd className="flex items-center justify-between gap-3 text-ink">
                <span className="min-w-0">{v}</span>
                {editable && (
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`${t.edit}: ${label}`}
                    onClick={() => {
                      setValue(v);
                      setEditing(label);
                    }}
                  >
                    {t.edit}
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-caption text-ink-muted">
        {[
          d.checkedBy && t.checkedBy(d.checkedBy),
          d.approvedBy && t.approvedBy(d.approvedBy),
          d.portalExportDone && t.portalDone,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="flex flex-wrap justify-end gap-3">
        {!issued && d.state !== 'cancelled' && (
          <Button variant="secondary" onClick={() => setDialog('cancel')}>
            {t.cancel}
          </Button>
        )}
        {d.kind === 'tc' && d.state === 'ready_for_review' && !d.checked && (
          <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('check')}>
            {t.check}
          </Button>
        )}
        {d.kind === 'tc' && d.state === 'ready_for_review' && d.checked && (
          <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
            {t.approve}
          </Button>
        )}
        {(d.kind === 'tc' ? d.state === 'approved' : d.state === 'ready_for_review') && (
          <Button disabled={act.isPending} onClick={() => act.mutate('issue')}>
            {t.issue}
          </Button>
        )}
        {issued && (
          <>
            {d.kind === 'tc' && !d.portalExportDone && (
              <Button
                variant="secondary"
                disabled={portal.isPending}
                onClick={() => portal.mutate()}
              >
                {t.portal}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog('duplicate')}>
              {t.duplicate}
            </Button>
            {d.downloadUrl && (
              <a
                href={d.downloadUrl}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-navy-950 px-3.5 text-body font-medium text-white hover:bg-navy-900"
              >
                <Download aria-hidden className="size-4" />
                {t.download}
              </a>
            )}
            {d.verificationCode && (
              <Link
                href={`/verify/${d.verificationCode}`}
                className="inline-flex h-9 items-center rounded-md px-3.5 text-body text-navy-950 hover:bg-navy-50"
              >
                {t.verify}
              </Link>
            )}
          </>
        )}
      </div>
      {(act.error ?? portal.error) && (
        <p
          role="alert"
          className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          {certError(act.error ?? portal.error)}
        </p>
      )}

      {editing && (
        <ReasonDialog
          title={t.editTitle(editing)}
          hint={t.editHint}
          label={t.reason}
          action={t.save}
          cancel={t.close}
          minLength={3}
          errorText={certError}
          onClose={() => setEditing(null)}
          submit={async (reason) => {
            await api.post(`/school/certificates/${id}/draft`, {
              fields: [[editing, value]],
              reason,
            });
            refresh();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.value}</span>
            <input
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={field}
            />
          </label>
        </ReasonDialog>
      )}
      {dialog && (
        <ReasonDialog
          title={dialog === 'cancel' ? t.cancelTitle : t.duplicate}
          hint={dialog === 'cancel' ? t.cancelHint : t.duplicateHint}
          label={t.reason}
          action={dialog === 'cancel' ? t.cancel : t.duplicate}
          cancel={t.close}
          minLength={3}
          errorText={certError}
          onClose={() => setDialog(null)}
          submit={async (reason) => {
            await api.post(
              `/school/certificates/${id}/${dialog === 'cancel' ? 'cancel' : 'reissue'}`,
              dialog === 'cancel' ? { reason } : { mode: 'duplicate', reason },
            );
            refresh();
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}
