'use client';

// Payroll › TDS (rule book §13.7 "TDS (24Q), Form 16"; §15): a quarter's tax deducted from
// salaries against the challans that deposited it, what still stops the 24Q statement, the
// worksheet for the Return Preparation Utility, and each employee's Form 16 Part B figures.
import type { Form16Row, TdsQuarter } from '@campusverse/people-payroll';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Landmark, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { formatDate } from '../setup/shared';

const t = en.payroll.tdsReturns;
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? en.payroll.errors.forbidden
      : (en.payroll.errors[e.code] ?? en.payroll.errors.error)
    : en.payroll.errors.error) ?? '';
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** The financial year (starting April) and quarter of a date. */
const quarterOf = (d: string) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return { fy: m >= 4 ? y : y - 1, quarter: Math.floor(((m + 8) % 12) / 3) + 1 };
};
const save = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

export function Tds({
  institutionId,
  canPrepare,
  onMessage,
}: {
  institutionId: string;
  canPrepare: boolean;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const now = quarterOf(istToday());
  const [fy, setFy] = useState(now.fy);
  const [quarter, setQuarter] = useState(now.quarter);
  const [recording, setRecording] = useState(false);
  const params = `institutionId=${institutionId}&fy=${fy}&quarter=${quarter}`;
  const key = ['tds', institutionId, fy, quarter];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<TdsQuarter>(`/payroll/tds?${params}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tds', institutionId] });
  const file = useMutation({
    mutationFn: () => api.get<TdsQuarter>(`/payroll/tds/file?${params}`),
    onSuccess: (r) => save(`24Q-FY${fy}-${String(fy + 1).slice(2)}-Q${quarter}.csv`, r.file ?? ''),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/tds/challans/${id}`),
    onSuccess: async () => (await refresh(), onMessage(t.removed)),
  });
  const years = [now.fy, now.fy - 1, now.fy - 2];
  const r = q.data;
  const error = file.error ?? remove.error;

  return (
    <>
      <Section
        id="tds"
        title={t.title}
        description={t.lead}
        actions={
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink">{t.year}</span>
              <select
                value={fy}
                onChange={(e) => setFy(Number(e.target.value))}
                className={fieldInput}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {t.fy(y)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-ink">{t.quarter}</span>
              <select
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
                className={fieldInput}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {t.quarters[n]}
                  </option>
                ))}
              </select>
            </label>
          </span>
        }
        flush
      >
        {q.error ? (
          <div className="px-6 pb-5">
            <StatePanel
              kind={q.error instanceof ApiFailure && q.error.status === 403 ? 'denied' : 'error'}
              title={errorText(q.error)}
            />
          </div>
        ) : !r ? (
          <div className="px-6 pb-5">
            <SkeletonRows rows={3} label={en.states.loading.title} />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 px-6 pb-4">
              <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                <Pill tone={r.ready ? 'go' : 'warn'}>{r.ready ? t.ready : t.notReady}</Pill>
                <span className="tabular">{t.statementDue(formatDate(r.statementDue))}</span>
                <span className="text-ink-muted">{r.tan ? t.tan(r.legalEntity, r.tan) : ''}</span>
              </p>
              <ul className="flex flex-col gap-1 text-caption text-signal-warn-ink">
                {!r.tan && (
                  <li>
                    {t.noTan}{' '}
                    <Link href="/settings/organisation" className="text-navy-950 underline">
                      {t.setTan}
                    </Link>
                  </li>
                )}
                {r.months.some((m) => m.run && m.run.state !== 'paid') && <li>{t.unpaid}</li>}
                {r.unlinked.length > 0 && (
                  <li>
                    {t.unlinked(
                      r.unlinked.length,
                      rupees(r.unlinked.reduce((a, u) => a + u.tdsPaise, 0)),
                    )}
                  </li>
                )}
                {r.withoutPan.length > 0 && (
                  <li>{t.withoutPan(r.withoutPan.map((p) => p.name).join(', '))}</li>
                )}
              </ul>
              <span className="flex flex-wrap gap-2">
                {canPrepare && (
                  <Button size="sm" onClick={() => setRecording(true)}>
                    <Plus aria-hidden className="size-4" />
                    {t.record}
                  </Button>
                )}
                {canPrepare && r.deductees > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={file.isPending}
                    onClick={() => file.mutate()}
                  >
                    <Download aria-hidden className="size-4" />
                    {t.download}
                  </Button>
                )}
              </span>
            </div>
            {/* Focusable so keyboard users can scroll it on a phone. */}
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full min-w-[720px] text-body">
                <caption className="sr-only">{t.title}</caption>
                <thead>
                  <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t.table.month}
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      {t.table.deducted}
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      {t.table.deposited}
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t.table.challans}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.months.map((m) => (
                    <tr key={m.month} className="align-top">
                      <th scope="row" className="px-5 py-3 text-left font-normal text-ink">
                        {en.payroll.month(m.month)}
                        <span className="block text-caption text-ink-muted">
                          {m.run ? t.runStates[m.run.state] : t.noRun} ·{' '}
                          {t.depositBy(formatDate(m.depositDue))}
                        </span>
                      </th>
                      <td className="tabular px-5 py-3 text-right text-ink">
                        {rupees(m.deductedPaise)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-ink">
                        {rupees(m.depositedPaise)}
                      </td>
                      <td className="px-5 py-3">
                        {m.challans.length === 0 ? (
                          <span className="text-caption text-ink-muted">{t.noChallans}</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {m.challans.map((c) => (
                              <li key={c.id} className="flex flex-wrap items-center gap-2">
                                <span className="tabular text-caption text-ink">
                                  {t.challan(c.bsrCode, c.challanSerial, formatDate(c.depositedOn))}{' '}
                                  · {rupees(c.amountPaise)}
                                </span>
                                {c.late && <Pill tone="warn">{t.late}</Pill>}
                                {canPrepare && (
                                  <Button
                                    size="sm"
                                    variant="quiet"
                                    aria-label={t.removeFor(c.challanSerial)}
                                    disabled={remove.isPending}
                                    onClick={() => remove.mutate(c.id)}
                                  >
                                    <Trash2 aria-hidden className="size-4" />
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-6 py-3 text-caption text-ink-muted">{t.note(r.source.title)}</p>
          </>
        )}
        {error && (
          <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
            {errorText(error)}
          </p>
        )}
        {recording && r && (
          <ChallanForm
            institutionId={institutionId}
            months={r.months.map((m) => m.month)}
            onClose={() => setRecording(false)}
            onDone={async () => {
              setRecording(false);
              await refresh();
              onMessage(t.recorded);
            }}
          />
        )}
      </Section>
      <Form16 institutionId={institutionId} fy={fy} canPrepare={canPrepare} />
    </>
  );
}

function ChallanForm({
  institutionId,
  months,
  onClose,
  onDone,
}: {
  institutionId: string;
  months: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [month, setMonth] = useState(months[0] ?? '');
  const [bsrCode, setBsr] = useState('');
  const [challanSerial, setSerial] = useState('');
  const [depositedOn, setDate] = useState(istToday());
  const [amount, setAmount] = useState('');
  const amountPaise = parseRupees(amount);
  const m = useMutation({
    mutationFn: () =>
      api.post('/payroll/tds/challans', {
        institutionId,
        month,
        bsrCode,
        challanSerial,
        depositedOn,
        amountPaise,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.recordTitle}
      description={t.recordLead}
      submitLabel={t.record}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={
        !/^\d{7}$/.test(bsrCode) || !/^\d{5}$/.test(challanSerial) || !depositedOn || !amountPaise
      }
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.form.month}>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={fieldInput}>
          {months.map((x) => (
            <option key={x} value={x}>
              {en.payroll.month(x)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.form.depositedOn}>
        <input
          type="date"
          required
          max={istToday()}
          value={depositedOn}
          onChange={(e) => setDate(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={t.form.bsr} hint={t.form.bsrHint}>
        <input
          required
          inputMode="numeric"
          pattern="[0-9]{7}"
          maxLength={7}
          value={bsrCode}
          onChange={(e) => setBsr(e.target.value.replace(/\D/g, ''))}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={t.form.serial} hint={t.form.serialHint}>
        <input
          required
          inputMode="numeric"
          pattern="[0-9]{5}"
          maxLength={5}
          value={challanSerial}
          onChange={(e) => setSerial(e.target.value.replace(/\D/g, ''))}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={t.form.amount}>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function Form16({
  institutionId,
  fy,
  canPrepare,
}: {
  institutionId: string;
  fy: number;
  canPrepare: boolean;
}) {
  const params = `institutionId=${institutionId}&fy=${fy}`;
  const q = useQuery({
    queryKey: ['form16', institutionId, fy],
    queryFn: () => api.get<{ rows: Form16Row[] }>(`/payroll/form16?${params}`),
  });
  const file = useMutation({
    mutationFn: () => api.get<{ file: string | null }>(`/payroll/form16/file?${params}`),
    onSuccess: (r) => save(`Form16-PartB-FY${fy}-${String(fy + 1).slice(2)}.csv`, r.file ?? ''),
  });
  const rows = q.data?.rows ?? [];
  return (
    <Section
      id="form16"
      title={t.form16.title(t.fy(fy))}
      description={t.form16.lead}
      actions={
        canPrepare && rows.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={file.isPending}
            onClick={() => file.mutate()}
          >
            <Download aria-hidden className="size-4" />
            {t.form16.download}
          </Button>
        ) : undefined
      }
      flush
    >
      {q.error ? (
        <div className="px-6 pb-5">
          <StatePanel kind="error" title={errorText(q.error)} />
        </div>
      ) : !q.data ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Landmark} area="go" title={t.form16.none} compact />
      ) : (
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[640px] text-body">
            <caption className="sr-only">{t.form16.title(t.fy(fy))}</caption>
            <thead>
              <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.form16.name}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t.form16.gross}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t.form16.pt}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t.form16.tds}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.personId}>
                  <th scope="row" className="px-5 py-2 text-left font-normal text-ink">
                    {r.name}
                    <span className="block text-caption text-ink-muted">
                      {t.form16.span(en.payroll.month(r.from), en.payroll.month(r.to))}
                    </span>
                  </th>
                  <td className="tabular px-5 py-2 text-right text-ink">{rupees(r.grossPaise)}</td>
                  <td className="tabular px-5 py-2 text-right text-ink">{rupees(r.ptPaise)}</td>
                  <td className="tabular px-5 py-2 text-right text-ink">{rupees(r.tdsPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {file.error && (
        <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
          {errorText(file.error)}
        </p>
      )}
    </Section>
  );
}
