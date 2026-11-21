'use client';

import type { Head, PayeesView, PlanSummary } from '@campusverse/shared-finance';
import {
  Button,
  EmptyState,
  FormModal,
  PageHeader,
  Pill,
  Section,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Layers, Plus, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { fieldInput } from '../../common/custom-fields';
import { api, feeError, t } from '../shared';

export function PlansView() {
  const school = useInstitution();
  const id = school.institutionId;
  const qc = useQueryClient();
  const heads = useQuery({
    queryKey: ['fee-heads', id],
    queryFn: () => api.get<Head[]>(`/finance/${id}/heads`),
    enabled: !!id,
  });
  const plans = useQuery({
    queryKey: ['fee-plans', id],
    queryFn: () => api.get<PlanSummary[]>(`/finance/${id}/plans`),
    enabled: !!id,
  });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [taxClass, setTaxClass] = useState<'education_exempt' | 'taxable'>('education_exempt');
  const [rte, setRte] = useState(true);
  const [refundable, setRefundable] = useState(false);
  const [payeeId, setPayeeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Head | null>(null);
  // Bodies the institution collects for (VTU, a board): a head can be collected for one of them.
  const payees = useQuery({
    queryKey: ['fee-payees', id, 'all'],
    queryFn: () => api.get<PayeesView>(`/finance/${id}/payees?year=all`),
    enabled: !!id,
  });
  const bodies = payees.data?.payees ?? [];
  const add = useMutation({
    mutationFn: () =>
      api.post(`/finance/${id}/heads`, {
        code,
        name,
        taxClass,
        rteExempt: rte,
        refundable,
        payeeId: payeeId || null,
      }),
    onSuccess: () => {
      setCode('');
      setName('');
      setPayeeId('');
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['fee-heads', id] });
    },
  });

  if (school.isPending || heads.isPending || plans.isPending)
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  const err = heads.error ?? plans.error;
  if (err) {
    return err instanceof ApiFailure && err.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={feeError(err)} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={IndianRupee}
        area="go"
        eyebrow={en.systems.groups.finance}
        title={t.plans}
        description={t.plansLead}
        actions={
          (heads.data ?? []).length > 0 ? (
            <Link
              href="/fees/plans/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-navy-950 px-4 text-body font-medium text-white shadow-[var(--shadow-card)] hover:bg-navy-900"
            >
              <Plus aria-hidden className="size-4" />
              {t.newPlan}
            </Link>
          ) : undefined
        }
      />

      <HowFeesWork />

      <Section
        id="heads"
        title={t.headsStep}
        description={t.noHeads}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAdding(true)}
            aria-haspopup="dialog"
          >
            <Plus aria-hidden className="size-4" />
            {t.addHead}
          </Button>
        }
        flush
      >
        {(heads.data ?? []).length === 0 ? (
          <EmptyState icon={Layers} area="go" title={t.headsEmpty} compact />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {(heads.data ?? []).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-6 py-2.5 text-body">
                <span className="w-24 font-mono text-caption text-ink-muted">{h.code}</span>
                <span className="flex-1 font-medium text-ink">{h.name}</span>
                {h.payee ? (
                  <Pill tone="go">{en.collectedFor.collectedForPill(h.payee)}</Pill>
                ) : null}
                <span className="text-caption text-ink-muted">
                  {t.taxClasses[h.taxClass]}
                  {h.rteExempt && ` · ${t.rteExempt}`}
                  {h.refundable && ` · ${t.refundable}`}
                </span>
                {!h.used && bodies.length > 0 && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setMoving(h)}
                    aria-haspopup="dialog"
                    aria-label={t.collectedForEdit(h.name)}
                  >
                    {t.collectedFor}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {adding && (
          <FormModal
            title={t.addHead}
            description={t.taxNote}
            submitLabel={t.addHead}
            cancelLabel={en.form.cancel}
            pending={add.isPending}
            error={add.isError ? feeError(add.error) : null}
            onClose={() => {
              add.reset();
              setAdding(false);
            }}
            onSubmit={() => add.mutate()}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.code}</span>
              <input
                required
                pattern="[A-Z][A-Z0-9_]{1,19}"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className={cx(fieldInput, 'font-mono')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.name}</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={fieldInput}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.taxClass}</span>
              <select
                value={taxClass}
                onChange={(e) => setTaxClass(e.target.value as 'education_exempt' | 'taxable')}
                className={fieldInput}
              >
                <option value="education_exempt">{t.taxClasses.education_exempt}</option>
                <option value="taxable">{t.taxClasses.taxable}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.collectedFor}</span>
              <select
                value={payeeId}
                onChange={(e) => setPayeeId(e.target.value)}
                className={fieldInput}
              >
                <option value="">{en.collectedFor.own}</option>
                {bodies.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.shortName} · {b.name}
                  </option>
                ))}
              </select>
              <span className="text-caption text-ink-muted">
                {t.collectedForHint}{' '}
                <Link href="/fees/payees" className="font-medium text-navy-950 underline">
                  {en.collectedFor.add}
                </Link>
              </span>
            </label>
            <label className="flex items-center gap-2 text-body text-ink">
              <input type="checkbox" checked={rte} onChange={(e) => setRte(e.target.checked)} />
              {t.rteExempt}
            </label>
            <label className="flex items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                checked={refundable}
                onChange={(e) => setRefundable(e.target.checked)}
              />
              {t.refundable}
            </label>
          </FormModal>
        )}
      </Section>

      {moving && (
        <HeadPayeeDialog
          head={moving}
          bodies={bodies}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            void qc.invalidateQueries({ queryKey: ['fee-heads', id] });
            void qc.invalidateQueries({ queryKey: ['fee-payees'] });
          }}
        />
      )}

      <Section id="plans" title={t.plansStep} description={t.plansStepLead} flush>
        {(plans.data ?? []).length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            area="go"
            title={t.noPlans}
            body={(heads.data ?? []).length ? t.noPlansBody : t.noPlansFirst}
            compact
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {(plans.data ?? []).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/fees/plans/${p.id}`}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-paper"
                >
                  <span className="flex-1 font-medium text-navy-950">
                    {p.name}{' '}
                    <span className="text-caption text-ink-muted">{t.version(p.version)}</span>
                  </span>
                  {p.periodLabel && (
                    <span className="tabular rounded-full bg-paper px-2.5 py-0.5 text-caption text-ink-muted">
                      {p.periodLabel}
                    </span>
                  )}
                  <span className="tabular text-body text-ink">{rupees(p.totalPaise)}</span>
                  <Pill tone={p.state === 'published' ? 'go' : 'neutral'}>{t.states[p.state]}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Who a head is collected for, while it hasn't been billed. */
function HeadPayeeDialog({
  head,
  bodies,
  onClose,
  onDone,
}: {
  head: Head;
  bodies: PayeesView['payees'];
  onClose: () => void;
  onDone: () => void;
}) {
  const [payeeId, setPayeeId] = useState(head.payeeId ?? '');
  const save = useMutation({
    mutationFn: () => api.post(`/finance/heads/${head.id}/payee`, { payeeId: payeeId || null }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.collectedForEdit(head.name)}
      description={t.collectedForLead}
      submitLabel={en.form.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      error={save.isError ? feeError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <label className="col-span-full flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.collectedFor}</span>
        <select value={payeeId} onChange={(e) => setPayeeId(e.target.value)} className={fieldInput}>
          <option value="">{en.collectedFor.own}</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {b.shortName} · {b.name}
            </option>
          ))}
        </select>
      </label>
    </FormModal>
  );
}

/** Fees in four steps, in plain words, above the setup it explains. */
function HowFeesWork() {
  const h = t.how;
  return (
    <section aria-labelledby="how-fees" className="panel flex flex-col gap-4 p-5">
      <h2 id="how-fees" className="font-display text-body font-semibold text-ink">
        {h.title}
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {h.steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3 rounded-xl bg-paper p-3">
            <span
              aria-hidden
              className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-950 text-caption font-semibold text-white"
            >
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-body font-medium text-ink">{title}</span>
              <span className="text-caption text-ink-muted">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-caption text-ink-muted">{h.extras}</p>
    </section>
  );
}
