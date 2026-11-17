'use client';

import type { Head, PlanSummary } from '@campusverse/shared-finance';
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
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api.post(`/finance/${id}/heads`, { code, name, taxClass, rteExempt: rte, refundable }),
    onSuccess: () => {
      setCode('');
      setName('');
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
                <span className="text-caption text-ink-muted">
                  {t.taxClasses[h.taxClass]}
                  {h.rteExempt && ` · ${t.rteExempt}`}
                  {h.refundable && ` · ${t.refundable}`}
                </span>
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
