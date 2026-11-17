'use client';

// Payroll › Final settlements (rule book §13.7; Labour Codes in force since 21 Nov 2025): each
// recent leaver, what they are owed, and the two-working-day deadline. Prepared here, approved
// through the workflow engine (My Work), paid with a bank reference.
import type { SettlementRow } from '@campusverse/people-payroll';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { formatDate } from '../setup/shared';

const t = en.payroll.settlement;
const STATE_TONE: Record<string, Tone> = {
  to_prepare: 'warn',
  prepared: 'warn',
  approved: 'neutral',
  rejected: 'stop',
  paid: 'go',
};
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? en.payroll.errors.forbidden
      : (en.payroll.errors[e.code] ?? en.payroll.errors.error)
    : en.payroll.errors.error) ?? '';

export function Settlements({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ kind: 'back' | 'pay'; row: SettlementRow } | null>(null);
  const key = ['settlements', institutionId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<SettlementRow[]>(`/payroll/settlements?institutionId=${institutionId}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const prepare = useMutation({
    mutationFn: (personId: string) => api.post('/payroll/settlements', { institutionId, personId }),
    onSuccess: async () => (await refresh(), onMessage(t.prepared)),
  });
  const approve = useMutation({
    mutationFn: (id: string) =>
      api.post(`/payroll/settlements/${id}/decision`, { approve: true, note: null }),
    onSettled: refresh,
  });
  const error = prepare.error ?? approve.error;

  return (
    <Section id="settlements" title={t.title} description={t.lead} flush>
      {q.error ? (
        <div className="px-6 pb-5">
          <StatePanel
            kind={q.error instanceof ApiFailure && q.error.status === 403 ? 'denied' : 'error'}
            title={errorText(q.error)}
          />
        </div>
      ) : !q.data ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={UserMinus} area="go" title={t.none} compact />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {q.data.map((r) => {
            const f = r.figures;
            return (
              <li
                key={r.personId}
                className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="tabular text-caption text-ink-muted">{r.employeeCode}</span>
                    <Pill tone={STATE_TONE[r.state] ?? 'neutral'}>{t.states[r.state]}</Pill>
                    {r.fixedTerm && <Pill>{t.fixedTerm}</Pill>}
                    {r.overdue && <Pill tone="stop">{t.overdue}</Pill>}
                    {r.state === 'paid' && (
                      <Pill tone={r.paidLate ? 'warn' : 'go'}>
                        {r.paidLate ? t.paidLate : t.paidOnTime}
                      </Pill>
                    )}
                  </p>
                  <p className="tabular text-caption text-ink-muted">
                    {t.lastDay(formatDate(r.lastDay))} · {t.due(formatDate(r.dueOn))}
                  </p>
                  {!f ? (
                    <p className="mt-1 text-caption text-signal-warn-ink">{t.noSalary}</p>
                  ) : (
                    <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-body">
                      <dt className="text-ink">{t.salary(f.salaryDays)}</dt>
                      <dd className="tabular text-right text-ink">{rupees(f.salaryNetPaise)}</dd>
                      <dt className="text-ink">
                        {f.gratuityPaise > 0
                          ? t.gratuity(f.gratuityYears)
                          : r.joinedOn
                            ? t.noGratuity(f.serviceMonths)
                            : t.noJoining}
                        {f.gratuityPaise > 0 && (
                          <span className="block text-caption text-ink-muted">
                            {t.wages(rupees(f.gratuityWagesPaise))}
                          </span>
                        )}
                      </dt>
                      <dd className="tabular text-right text-ink">{rupees(f.gratuityPaise)}</dd>
                      <dt className="font-semibold text-ink">{t.total}</dt>
                      <dd className="tabular text-right font-semibold text-ink">
                        {rupees(f.totalPaise)}
                      </dd>
                    </dl>
                  )}
                  {r.state === 'paid' && r.paidOn && (
                    <p className="mt-1 text-caption text-ink-muted">
                      {t.paidWith(formatDate(r.paidOn), r.reference ?? '')}
                    </p>
                  )}
                  {r.state === 'prepared' && r.approval?.status === 'pending' && (
                    <p className="mt-1 text-caption text-ink-muted">
                      {en.workflow.progress(
                        r.approval.step,
                        r.approval.steps,
                        r.approval.stepRoleName ?? en.workflow.anyApprover,
                      )}
                    </p>
                  )}
                  {r.state === 'rejected' && r.decisionNote && (
                    <p className="mt-1 text-caption text-ink-muted">{r.decisionNote}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {(r.state === 'to_prepare' || r.state === 'rejected') && f && (
                    <Button
                      size="sm"
                      aria-label={t.prepareFor(r.name)}
                      disabled={prepare.isPending}
                      onClick={() => prepare.mutate(r.personId)}
                    >
                      {t.prepare}
                    </Button>
                  )}
                  {r.state === 'prepared' && r.approval?.mine && r.id && (
                    <>
                      <Button
                        size="sm"
                        aria-label={t.approveFor(r.name)}
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(r.id ?? '')}
                      >
                        {t.approve}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t.sendBackFor(r.name)}
                        onClick={() => setForm({ kind: 'back', row: r })}
                      >
                        {t.sendBack}
                      </Button>
                    </>
                  )}
                  {r.state === 'approved' && (
                    <Button
                      size="sm"
                      aria-label={t.payFor(r.name)}
                      onClick={() => setForm({ kind: 'pay', row: r })}
                    >
                      {t.pay}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
          {errorText(error)}
        </p>
      )}
      {form && (
        <SettlementForm
          kind={form.kind}
          row={form.row}
          onClose={() => setForm(null)}
          onDone={async (m) => {
            setForm(null);
            await refresh();
            if (m) onMessage(m);
          }}
        />
      )}
    </Section>
  );
}

function SettlementForm({
  kind,
  row,
  onClose,
  onDone,
}: {
  kind: 'back' | 'pay';
  row: SettlementRow;
  onClose: () => void;
  onDone: (message: string | null) => void;
}) {
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(istToday());
  const [reference, setReference] = useState('');
  const m = useMutation({
    mutationFn: () =>
      kind === 'back'
        ? api.post(`/payroll/settlements/${row.id}/decision`, { approve: false, note })
        : api.post(`/payroll/settlements/${row.id}/paid`, { paidOn, reference }),
    onSuccess: () => onDone(kind === 'pay' ? t.done : null),
  });
  const title = kind === 'back' ? t.sendBackTitle : t.payFor(row.name);
  return (
    <FormModal
      title={title}
      description={row.figures ? `${row.name} · ${rupees(row.figures.totalPaise)}` : row.name}
      submitLabel={kind === 'back' ? t.sendBack : t.pay}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={kind === 'back' ? !note.trim() : !paidOn || !reference.trim()}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      {kind === 'back' ? (
        <ModalField label={t.why} wide>
          <textarea
            required
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={fieldInput}
          />
        </ModalField>
      ) : (
        <>
          <ModalField label={t.paidOn}>
            <input
              type="date"
              required
              min={row.lastDay}
              max={istToday()}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
          <ModalField label={t.reference}>
            <input
              required
              maxLength={80}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </>
      )}
    </FormModal>
  );
}
