'use client';

import type { CheckLine, StaffCheck } from '@campusverse/people-records';
import {
  Button,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';
import { formatDate } from '../../setup/shared';
import { errorOf, istToday } from '../staff-list';

const t = en.staffPages.checks;
const KINDS = ['police_verification', 'driving_licence', 'medical_fitness', 'psv_badge'] as const;
const TONE: Record<CheckLine['state'], Tone> = {
  ok: 'go',
  expiring: 'warn',
  expired: 'stop',
  missing: 'warn',
};
type Checks = { required: string[]; lines: CheckLine[]; history: StaffCheck[] };

/** A staff member's safety checks: what their roles need, each one's state, and the history. */
export function StaffChecks({ personId, manage }: { personId: string; manage: boolean }) {
  const qc = useQueryClient();
  const checks = useQuery({
    queryKey: ['staff-checks', personId],
    queryFn: () => api.get<Checks>(`/people/staff/${personId}/checks`),
  });
  const [recording, setRecording] = useState<(typeof KINDS)[number] | null>(null);

  if (checks.isPending) return <SkeletonRows rows={3} label={en.states.loading.title} />;
  if (checks.isError)
    return checks.error instanceof ApiFailure && checks.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={en.states.error.body} />
    );
  const { lines, history } = checks.data;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t.title}
        description={t.lead}
        actions={
          manage ? (
            <Button variant="secondary" onClick={() => setRecording('police_verification')}>
              {t.record}
            </Button>
          ) : undefined
        }
        flush
      >
        {lines.length === 0 ? (
          <p className="px-5 py-4 text-body text-ink-muted">{t.none}</p>
        ) : (
          <ul aria-label={t.title} className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.kind} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-700">
                  <ShieldCheck aria-hidden className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-ink">{t.kinds[l.kind]}</span>
                  <span className="text-caption text-ink-muted">
                    {l.latest
                      ? [
                          l.latest.reference,
                          t.checkedOn(formatDate(l.latest.checkedOn)),
                          l.latest.validUntil
                            ? t.validUntil(formatDate(l.latest.validUntil))
                            : t.noExpiry,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t.states.missing}
                  </span>
                </span>
                <Pill tone={TONE[l.state]}>{t.states[l.state]}</Pill>
                {manage && (
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`${l.latest ? t.renew : t.record}: ${t.kinds[l.kind]}`}
                    onClick={() => setRecording(l.kind)}
                  >
                    {l.latest ? t.renew : t.record}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {history.length > 0 && (
        <Section title={t.history} flush>
          <div role="region" aria-label={t.history} tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-body">
              <caption className="sr-only">{t.history}</caption>
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {t.form.kind}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t.form.reference}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    {t.form.checkedOn}
                  </th>
                  <th scope="col" className="px-5 py-2.5 font-medium">
                    {t.form.validUntil}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-5 py-2.5 text-ink">{t.kinds[h.kind]}</td>
                    <td className="px-3 py-2.5 text-ink">{h.reference ?? '—'}</td>
                    <td className="tabular px-3 py-2.5 text-ink">{formatDate(h.checkedOn)}</td>
                    <td className="tabular px-5 py-2.5 text-ink">
                      {h.validUntil ? formatDate(h.validUntil) : t.noExpiry}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {recording && (
        <RecordCheck
          personId={personId}
          kind={recording}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            void qc.invalidateQueries({ queryKey: ['staff-checks', personId] });
            void qc.invalidateQueries({ queryKey: ['staff'] });
          }}
        />
      )}
    </div>
  );
}

function RecordCheck({
  personId,
  kind: first,
  onClose,
  onSaved,
}: {
  personId: string;
  kind: (typeof KINDS)[number];
  onClose: () => void;
  onSaved: () => void;
}) {
  const f = t.form;
  const [form, setForm] = useState({
    kind: first as string,
    reference: '',
    checkedOn: istToday(),
    validUntil: '',
    note: '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/people/staff/${personId}/checks`, {
        kind: form.kind,
        reference: form.reference.trim() || null,
        checkedOn: form.checkedOn,
        validUntil: form.validUntil || null,
        note: form.note.trim() || null,
      }),
    onSuccess: onSaved,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((x) => ({ ...x, [k]: e.target.value }));
  return (
    <FormModal
      title={f.title}
      submitLabel={f.save}
      cancelLabel={en.staffPages.form.cancel}
      pending={save.isPending}
      error={save.isError ? errorOf(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.kind}>
        <select value={form.kind} onChange={set('kind')} className={fieldInput}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.reference}>
        <input
          value={form.reference}
          onChange={set('reference')}
          maxLength={60}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.checkedOn}>
        <input
          required
          type="date"
          max={istToday()}
          value={form.checkedOn}
          onChange={set('checkedOn')}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.validUntil} hint={f.validUntilHint}>
        <input
          type="date"
          min={form.checkedOn}
          value={form.validUntil}
          onChange={set('validUntil')}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.note} wide>
        <input value={form.note} onChange={set('note')} maxLength={300} className={fieldInput} />
      </ModalField>
    </FormModal>
  );
}
