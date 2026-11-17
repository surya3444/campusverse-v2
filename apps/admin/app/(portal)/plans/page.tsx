'use client';

import type { FlagRow, Plan, Staff } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { Tags } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { Field, Loaded, Notice, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.plans;
const rupees = (paise: number) => (paise / 100).toLocaleString('en-IN');

export default function PlansPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api.get<FlagRow[]>('/flags') });
  const owner = me.data?.role === 'owner';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Tags} area="amber" title={t.title} />
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <div className="grid gap-5 lg:grid-cols-2">
            {rows.map((p) =>
              owner ? (
                <PlanForm key={p.code} plan={p} flags={(flags.data ?? []).map((f) => f.key)} />
              ) : (
                <div key={p.code} className="panel flex flex-col gap-1 p-5">
                  <h2 className="text-body font-semibold text-ink">{p.name}</h2>
                  <p className="text-caption text-ink-muted tabular-nums">
                    ₹{rupees(p.pricePaise)} · {p.studentLimit ?? t.noLimit} ·{' '}
                    {p.features.join(', ')} · {t.customers(p.customers)}
                  </p>
                </div>
              ),
            )}
          </div>
        )}
      </Loaded>
    </div>
  );
}

function PlanForm({ plan, flags }: { plan: Plan; flags: string[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [limit, setLimit] = useState(plan.studentLimit === null ? '' : String(plan.studentLimit));
  const [price, setPrice] = useState(String(plan.pricePaise / 100));
  const [features, setFeatures] = useState(plan.features);
  const save = useMutation({
    mutationFn: () =>
      api.post('/plans', {
        code: plan.code,
        name,
        studentLimit: limit ? Number(limit) : null,
        // Whole rupees on screen; paise in the API (integers only, never floats).
        pricePaise: Math.round(Number(price) * 100),
        features,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} aria-label={plan.name} className="panel grid gap-3 p-5 sm:grid-cols-2">
      <h2 className="text-body font-semibold text-ink sm:col-span-2">
        {plan.code} · {t.customers(plan.customers)}
      </h2>
      <Field label={t.name}>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </Field>
      <Field label={t.limit}>
        <input
          type="number"
          min={1}
          placeholder={t.noLimit}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className={`${field} tabular-nums`}
        />
      </Field>
      <Field label={t.price}>
        <input
          type="number"
          min={0}
          step={1}
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={`${field} tabular-nums`}
        />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption font-medium text-ink">{t.features}</legend>
        {flags.map((f) => (
          <label key={f} className="flex items-center gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={features.includes(f)}
              onChange={(e) =>
                setFeatures((xs) => (e.target.checked ? [...xs, f] : xs.filter((x) => x !== f)))
              }
            />
            {f}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        <div className="flex-1">
          <Notice error={save.error} ok={save.isSuccess && t.saved} />
        </div>
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
