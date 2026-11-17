'use client';

// Exams & Results › Hall Tickets & Eligibility (rule book §13.2: "Attendance, fee and no-dues
// checks; QR admit cards"; §16: "Hall ticket in app; ineligibility notice with reason"): who may sit
// which course this term, hall tickets as QR-verifiable documents, a release despite overdue fees
// with a reason, and notices that say why.
import type { EligibilityBoard, EligibilityRow } from '@campusverse/academics-exams';
import {
  Button,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';

const t = en.examResults.hallTickets;
const TONE: Record<string, Tone> = {
  eligible: 'go',
  condoned: 'go',
  no_classes: 'neutral',
  condonable: 'warn',
  short: 'stop',
};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? en.examResults.errors.forbidden
      : (en.examResults.errors[e.code] ?? en.examResults.errors.error)
    : en.examResults.errors.error) ?? '';

export function HallTickets({ batchId, canManage }: { batchId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const key = ['eligibility', batchId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<EligibilityBoard>(`/academics/batches/${batchId}/eligibility`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [message, setMessage] = useState<string | null>(null);
  const issue = useMutation({
    mutationFn: () =>
      api.post<{ issued: number; unchanged: number; withheld: number; noCourse: number }>(
        `/academics/batches/${batchId}/hall-tickets`,
        {},
      ),
    onSuccess: async (r) => (await refresh(), setMessage(t.issued(r.issued, r.withheld))),
  });
  const notices = useMutation({
    mutationFn: () =>
      api.post<{ students: number }>(`/academics/batches/${batchId}/ineligibility-notices`, {}),
    onSuccess: (r) => setMessage(t.noticesSent(r.students)),
  });
  const download = useMutation({
    mutationFn: (studentId: string) =>
      api.get<{ url: string }>(`/academics/batches/${batchId}/hall-tickets/${studentId}`),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
  });
  const [releasing, setReleasing] = useState<EligibilityRow | null>(null);
  const b = q.data;
  const ready = b?.students.filter((s) => s.ready && !s.ticket).length ?? 0;
  const withReasons = b?.students.filter((s) => s.reasons.length > 0).length ?? 0;
  const error = q.error ?? issue.error ?? notices.error ?? download.error;
  return (
    <Section
      id="hall-tickets"
      title={t.title}
      description={t.lead}
      actions={
        canManage && b ? (
          <span className="flex flex-wrap gap-2">
            {withReasons > 0 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={notices.isPending}
                onClick={() => notices.mutate()}
              >
                {t.sendNotices(withReasons)}
              </Button>
            )}
            <Button
              size="sm"
              disabled={issue.isPending || ready === 0}
              onClick={() => issue.mutate()}
            >
              {t.issue(ready)}
            </Button>
          </span>
        ) : undefined
      }
      flush
    >
      {!b ? (
        q.error ? null : (
          <div className="px-6 pb-5">
            <SkeletonRows rows={3} label={en.states.loading.title} />
          </div>
        )
      ) : b.students.length === 0 ? (
        <p className="px-6 pb-5 text-body text-ink-muted">{en.examResults.noStudents}</p>
      ) : (
        // Focusable so keyboard users can scroll it on a phone.
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[720px] text-body">
            <caption className="sr-only">{t.title}</caption>
            <thead>
              <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.student}
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.courses}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t.fees}
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.ticket}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.students.map((s) => (
                <tr key={s.studentId} className="align-top">
                  <th scope="row" className="px-5 py-3 text-left font-normal text-ink">
                    {s.name}
                    {s.registerNumber && (
                      <span className="tabular block text-caption text-ink-muted">
                        {s.registerNumber}
                      </span>
                    )}
                  </th>
                  <td className="px-5 py-3">
                    <span className="flex flex-wrap gap-1">
                      {s.courses.map((c) => (
                        <Pill
                          key={c.courseId}
                          tone={c.maySit ? (TONE[c.standing] ?? 'go') : 'stop'}
                        >
                          {c.code}
                          {c.basisPoints !== null && ` · ${(c.basisPoints / 100).toFixed(2)}%`}
                          {!c.maySit && ` · ${t.notToSit}`}
                        </Pill>
                      ))}
                    </span>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {s.overduePaise > 0 ? (
                      <span className="text-signal-stop-ink">{rupees(s.overduePaise)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {s.ticket ? (
                      <span className="flex flex-col items-start gap-1">
                        <span className="tabular text-caption text-ink">{s.ticket.number}</span>
                        {s.ticket.releasedReason && (
                          <span className="text-caption text-signal-warn-ink">
                            {t.released(s.ticket.releasedReason)}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="quiet"
                          aria-label={t.downloadFor(s.name)}
                          disabled={download.isPending}
                          onClick={() => download.mutate(s.studentId)}
                        >
                          <Download aria-hidden className="size-4" />
                          {t.download}
                        </Button>
                      </span>
                    ) : s.ready ? (
                      <Pill tone="go">{t.readyPill}</Pill>
                    ) : s.overduePaise > 0 && s.courses.some((c) => c.maySit) ? (
                      <span className="flex flex-col items-start gap-1">
                        <Pill tone="warn">{t.withheld}</Pill>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="quiet"
                            aria-label={t.releaseFor(s.name)}
                            onClick={() => setReleasing(s)}
                          >
                            {t.release}
                          </Button>
                        )}
                      </span>
                    ) : (
                      <Pill tone="stop">{t.noCourse}</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && (
        <p role="status" className="px-6 py-3 text-caption text-ink-muted">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="px-6 py-3 text-caption text-signal-stop-ink">
          {errorText(error)}
        </p>
      )}
      {releasing && (
        <ReleaseForm
          batchId={batchId}
          row={releasing}
          onClose={() => setReleasing(null)}
          onDone={async () => {
            setReleasing(null);
            await refresh();
            setMessage(t.issued(1, 0));
          }}
        />
      )}
    </Section>
  );
}

function ReleaseForm({
  batchId,
  row,
  onClose,
  onDone,
}: {
  batchId: string;
  row: EligibilityRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${batchId}/hall-tickets`, {
        studentIds: [row.studentId],
        releaseReason: reason,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.releaseFor(row.name)}
      description={t.releaseLead(rupees(row.overduePaise))}
      submitLabel={t.release}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={reason.trim().length < 3}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.reason} wide>
        <textarea
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
