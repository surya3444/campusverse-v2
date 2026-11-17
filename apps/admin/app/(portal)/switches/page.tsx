'use client';

import type { CustomerSummary, Staff, SwitchRow } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { Power } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { at, Chip, Field, Loaded, Notice, Panel, field } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.switches;
const KEYS = ['messaging_off', 'payments_off', 'writes_off'] as const;

export default function SwitchesPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const list = useQuery({
    queryKey: ['switches'],
    queryFn: () => api.get<SwitchRow[]>('/switches'),
  });
  const customers = useQuery({
    queryKey: ['customers', ''],
    queryFn: () => api.get<CustomerSummary[]>('/customers'),
  });
  const [key, setKey] = useState<(typeof KEYS)[number]>('messaging_off');
  const [orgId, setOrgId] = useState('');
  const [reason, setReason] = useState('');
  const flip = useMutation({
    mutationFn: (v: { key: string; orgId: string | null; on: boolean; reason: string }) =>
      api.post('/switches', v),
    onSuccess: () => {
      setReason('');
      void qc.invalidateQueries();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    flip.mutate({ key, orgId: orgId || null, on: true, reason });
  };
  const owner = me.data?.role === 'owner';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Power} area="rose" title={t.title} description={t.lead} />
      <Loaded q={list}>
        {(rows) => (
          <Panel title={t.on}>
            {rows.length === 0 ? (
              <p className="px-5 py-3 text-caption text-ink-muted">{en.states.empty}</p>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Chip tone="on">{t.keys[s.key]}</Chip>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body text-ink">{s.customer ?? t.everyone}</span>
                      <span className="text-caption text-ink-muted">
                        {s.reason} · {t.setBy(s.setBy, at(s.setAt))}
                      </span>
                    </span>
                    {owner && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={flip.isPending}
                        onClick={() =>
                          flip.mutate({
                            key: s.key,
                            orgId: s.orgId,
                            on: false,
                            reason: `Off: ${s.reason}`,
                          })
                        }
                      >
                        {t.turnOff}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </Loaded>
      {owner && (
        <form
          onSubmit={submit}
          aria-label={t.turnOn}
          className="panel grid gap-3 p-5 sm:grid-cols-3"
        >
          <Field label={t.title}>
            <select
              value={key}
              onChange={(e) => setKey(e.target.value as typeof key)}
              className={field}
            >
              {KEYS.map((k) => (
                <option key={k} value={k}>
                  {t.keys[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={en.nav.customers}>
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={field}>
              <option value="">{t.everyone}</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.orgId} value={c.orgId}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.reason}>
            <input
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={field}
            />
          </Field>
          <p className="text-caption text-ink-muted sm:col-span-2">{t.effects[key]}</p>
          <div className="flex justify-end">
            <Button type="submit" disabled={flip.isPending}>
              {t.turnOn}
            </Button>
          </div>
        </form>
      )}
      <Notice error={flip.error} />
    </div>
  );
}
