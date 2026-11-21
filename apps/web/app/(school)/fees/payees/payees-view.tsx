'use client';

// Fees collected for others (owner's brief, 21 Nov 2026): VTU's fee inside a college's fee, a
// board's registration fee in a school's. What is held for each body, and paying it on.
import type { PayeeSummary, PayeesView as View } from '@campusverse/shared-finance';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Progress,
  Segmented,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Landmark, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { parseRupees, rupees, shortRupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { fieldInput } from '../../common/custom-fields';
import { useMe } from '../../common/me';

export const c = en.collectedFor;
export const payeeError = (e: unknown): string =>
  c.errors[e instanceof ApiFailure ? e.code : 'error'] ?? c.errors.error ?? '';
const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** The year in view: "all" or a label such as "2026-27". */
export function YearSwitch({
  years,
  value,
  onChange,
}: {
  years: string[];
  value: string;
  onChange: (y: string) => void;
}) {
  if (years.length === 0) return null;
  return (
    <Segmented
      label={c.year}
      value={value}
      onChange={onChange}
      options={[...years.map((y) => ({ value: y, label: y })), { value: 'all', label: c.allYears }]}
    />
  );
}

export function PayeesView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  // Undefined: the newest year (the server chooses); "all" for every year.
  const [year, setYear] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PayeeSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const view = useQuery({
    queryKey: ['fee-payees', id, year],
    queryFn: () => api.get<View>(`/finance/${id}/payees${year ? `?year=${year}` : ''}`),
    enabled: !!id,
  });
  const shown = view.data?.year ?? 'all';

  if (school.isPending || view.isPending)
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (view.isError || school.isError || !id)
    return view.error instanceof ApiFailure && view.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={payeeError(view.error ?? school.error)}
        action={en.states.error.action}
        onAction={() => void view.refetch()}
      />
    );
  const v = view.data;
  const sum = (k: 'collectedPaise' | 'remittedPaise' | 'toCollectPaise') =>
    v.payees.reduce((a, p) => a + p[k], 0);
  const canManage = can('finance.plan.manage');
  const canRemit = can('finance.remittance.record');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Landmark}
        area="go"
        eyebrow={en.systems.groups.finance}
        title={c.title}
        description={c.lead}
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
              <Plus aria-hidden className="size-4" />
              {c.add}
            </Button>
          ) : undefined
        }
      >
        <YearSwitch years={v.years} value={shown} onChange={setYear} />
      </PageHeader>

      {v.payees.length === 0 ? (
        <div className="panel">
          <EmptyState
            art="fees"
            title={c.emptyTitle}
            body={c.emptyBody}
            actions={
              canManage ? <Button onClick={() => setAdding(true)}>{c.add}</Button> : undefined
            }
          />
        </div>
      ) : (
        <>
          <KeyFigures
            variant="strip"
            label={c.figures}
            figures={[
              {
                label: c.held,
                value: shortRupees(v.heldPaise),
                note: c.heldNote,
                valueTone: 'navy',
              },
              {
                label: c.collected,
                value: shortRupees(sum('collectedPaise')),
                note: c.collectedNote,
              },
              { label: c.remitted, value: shortRupees(sum('remittedPaise')), note: c.remittedNote },
              {
                label: c.toCollect,
                value: shortRupees(sum('toCollectPaise')),
                note: c.toCollectNote,
              },
            ]}
          />
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {v.payees.map((p) => (
              <li key={p.id}>
                <PayeeCard p={p} year={shown} canRemit={canRemit} onPay={() => setPaying(p)} />
              </li>
            ))}
          </ul>
        </>
      )}

      {adding && (
        <AddPayeeDialog
          institutionId={id}
          onClose={() => setAdding(false)}
          onDone={(name) => {
            setAdding(false);
            setMessage(c.added(name));
          }}
        />
      )}
      {paying && (
        <RemitDialog
          payee={paying}
          years={v.years}
          year={shown === 'all' ? null : shown}
          onClose={() => setPaying(null)}
          onDone={(m) => {
            setPaying(null);
            setMessage(m);
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

function PayeeCard({
  p,
  year,
  canRemit,
  onPay,
}: {
  p: PayeeSummary;
  year: string;
  canRemit: boolean;
  onPay: () => void;
}) {
  return (
    <article className="panel flex h-full flex-col gap-4 p-5" aria-labelledby={`payee-${p.id}`}>
      <header className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal-go-tint text-signal-go-ink">
          <Landmark aria-hidden className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={`payee-${p.id}`} className="font-display text-lead font-semibold text-ink">
            {p.shortName}
          </h2>
          <p className="truncate text-caption text-ink-muted">{p.name}</p>
        </div>
        <Pill tone="neutral">{c.kinds[p.kind]}</Pill>
      </header>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-caption text-ink-muted">
          <span>{c.progress(rupees(p.collectedPaise), rupees(p.billedPaise))}</span>
        </div>
        <Progress
          value={p.collectedPaise}
          max={Math.max(p.billedPaise, p.collectedPaise, 1)}
          label={`${p.shortName}: ${c.progress(rupees(p.collectedPaise), rupees(p.billedPaise))}`}
        />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-y border-line py-3 sm:grid-cols-3">
        {(
          [
            [c.held, p.toRemitPaise, true],
            [c.remitted, p.remittedPaise, false],
            [c.toCollect, p.toCollectPaise, false],
          ] as const
        ).map(([label, value, lead]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd
              className={
                lead
                  ? 'tabular font-display text-lead font-semibold text-navy-950'
                  : 'tabular text-body font-medium text-ink'
              }
            >
              {rupees(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-ink-muted">
        {c.heads(p.heads)}
        {p.heads.length === 0 && (
          <>
            {' '}
            <Link href="/fees/plans" className="font-medium text-navy-950 underline">
              {c.noHeadsHint}
            </Link>
          </>
        )}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {canRemit && p.toRemitPaise > 0 && (
          <Button size="sm" onClick={onPay} aria-haspopup="dialog">
            <Send aria-hidden className="size-4" />
            {c.payOn(p.shortName)}
          </Button>
        )}
        <Link
          href={`/fees/payees/${p.id}${year === 'all' ? '' : `?year=${year}`}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-navy-950 hover:bg-navy-50"
          aria-label={`${c.statement}: ${p.shortName}`}
        >
          {c.statement}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}

function AddPayeeDialog({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: (shortName: string) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('university');
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/finance/${institutionId}/payees`, {
        kind,
        name: name.trim(),
        shortName: shortName.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fee-payees'] });
      onDone(shortName.trim());
    },
  });
  return (
    <FormModal
      title={c.addTitle}
      description={c.addLead}
      submitLabel={c.add}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || !shortName.trim()}
      error={save.isError ? payeeError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={c.kind} wide>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={fieldInput}>
          {Object.entries(c.kinds).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={c.name} wide>
        <input
          required
          maxLength={120}
          value={name}
          placeholder={c.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={c.shortName} hint={c.shortNameHint}>
        <input
          required
          maxLength={20}
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

/** Records money sent to a payee: never more than is held for it. */
export function RemitDialog({
  payee,
  years,
  year,
  onClose,
  onDone,
}: {
  payee: PayeeSummary;
  years: string[];
  year: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [periodLabel, setPeriodLabel] = useState<string | null>(year ?? years[0] ?? null);
  const [amount, setAmount] = useState(rupees(payee.toRemitPaise).replace(/[₹,]/g, ''));
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const paise = parseRupees(amount);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/finance/payees/${payee.id}/remittances`, {
        periodLabel,
        amountPaise: paise,
        paidOn,
        reference: reference.trim(),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fee-payees'] });
      void qc.invalidateQueries({ queryKey: ['fee-payee', payee.id] });
      onDone(c.remitted_(rupees(paise ?? 0), payee.shortName));
    },
  });
  const failure = save.error instanceof ApiFailure ? save.error : null;
  const held = (failure?.details as { heldPaise?: number } | null)?.heldPaise;
  return (
    <FormModal
      title={c.remitTitle(payee.shortName)}
      description={c.remitLead(payee.name, rupees(payee.toRemitPaise))}
      submitLabel={c.remitSave}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!paise || paise <= 0 || !reference.trim() || !paidOn}
      error={
        save.isError
          ? held !== undefined
            ? `${payeeError(save.error)} (${rupees(held)})`
            : payeeError(save.error)
          : null
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField
        label={c.remitAmount}
        hint={
          <button
            type="button"
            className="font-medium text-navy-950 underline"
            onClick={() => setAmount(rupees(payee.toRemitPaise).replace(/[₹,]/g, ''))}
          >
            {c.remitAll} · {rupees(payee.toRemitPaise)}
          </button>
        }
      >
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${fieldInput} tabular`}
        />
      </ModalField>
      <ModalField label={c.remitDate}>
        <input
          type="date"
          required
          max={todayIso()}
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={c.remitReference} hint={c.remitReferenceHint}>
        <input
          required
          maxLength={60}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      {years.length > 0 && (
        <ModalField label={c.remitYear}>
          <select
            value={periodLabel ?? ''}
            onChange={(e) => setPeriodLabel(e.target.value || null)}
            className={fieldInput}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </ModalField>
      )}
      <ModalField label={c.remitNote} hint={c.remitNoteHint} wide>
        <input
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
