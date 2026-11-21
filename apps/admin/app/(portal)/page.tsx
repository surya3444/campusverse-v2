'use client';

import type { CustomerSummary, InviteRow, Plan } from '@campusverse/platform-control';
import { Button, PageHeader } from '@campusverse/ui';
import { Building2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { at, Chip, Field, Loaded, Notice, Panel, field } from '../../lib/ui';
import { en } from '../../messages/en';

const t = en.customers;

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);
  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: () =>
      api.get<CustomerSummary[]>(`/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Building2}
        area="navy"
        title={t.title}
        actions={
          <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {t.new}
          </Button>
        }
      />
      {open && <CreateCustomer />}
      <Invites />
      <Field label={t.search} className="max-w-sm">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={field}
        />
      </Field>
      <Loaded q={list} empty={(d) => d.length === 0}>
        {(rows) => (
          <ul className="panel divide-y divide-line">
            {rows.map((c) => (
              <li key={c.orgId}>
                <Link
                  href={`/customers/${c.orgId}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-navy-950">{c.name}</span>
                    <span className="text-caption text-ink-muted tabular-nums">
                      {c.planName} · {t.students(c.students, c.studentLimit)}
                      {c.studentLimit !== null &&
                        c.students > c.studentLimit &&
                        ` · ${t.overLimit}`}
                      {' · '}
                      {c.lastActivity ? t.lastActivity(at(c.lastActivity)) : t.never}
                    </span>
                  </span>
                  <Chip tone={c.status}>{t.status[c.status]}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </div>
  );
}

function CreateCustomer() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const [form, setForm] = useState({ name: '', phone: '', email: '', planCode: 'pilot' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      api.post<{ inviteId: string; simulated?: { to: string; text: string } }>('/invites', {
        ...form,
        email: form.email || null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const sms = save.data?.simulated;
  return (
    <form onSubmit={submit} aria-label={t.new} className="panel grid gap-3 p-5 sm:grid-cols-2">
      <p className="text-body text-ink-muted sm:col-span-2">{t.inviteLead}</p>
      <Field label={t.adminName}>
        <input required minLength={2} value={form.name} onChange={set('name')} className={field} />
      </Field>
      <Field label={t.adminPhone}>
        <input
          required
          type="tel"
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          value={form.phone}
          onChange={set('phone')}
          className={field}
        />
      </Field>
      <Field label={t.adminEmail}>
        <input type="email" value={form.email} onChange={set('email')} className={field} />
      </Field>
      <Field label={t.plan}>
        <select value={form.planCode} onChange={set('planCode')} className={field}>
          {(plans.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {sms && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-signal-warn/40 bg-signal-warn-tint px-4 py-3 sm:col-span-2"
        >
          <span className="text-caption font-semibold text-signal-warn-ink">
            {t.simulatedSms} · {sms.to}
          </span>
          <span className="text-body text-ink">{sms.text}</span>
          <span className="text-caption text-ink-muted">{t.simulatedHint}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        <div className="flex-1">
          <Notice error={save.error} ok={save.isSuccess && t.invited} />
        </div>
        <Button type="submit" disabled={save.isPending}>
          {t.sendInvite}
        </Button>
      </div>
    </form>
  );
}

function Invites() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['invites'], queryFn: () => api.get<InviteRow[]>('/invites') });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/invites/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const open = (list.data ?? []).filter((i) => i.status === 'invited');
  if (open.length === 0) return null;
  return (
    <Panel title={t.invites}>
      <ul className="divide-y divide-line">
        {open.map((i) => (
          <li key={i.inviteId} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-ink">{i.name}</span>
              <span className="text-caption text-ink-muted">
                {i.phone ? `…${i.phone.slice(-4)}` : i.email} · {i.planCode} ·{' '}
                {t.invitedBy(i.invitedBy, at(i.createdAt))}
              </span>
            </span>
            <Chip tone="requested">{t.inviteStatus[i.status]}</Chip>
            <Button size="sm" variant="quiet" onClick={() => cancel.mutate(i.inviteId)}>
              {t.cancelInvite}
            </Button>
          </li>
        ))}
      </ul>
      <div className="px-5 pb-3">
        <Notice error={cancel.error} />
      </div>
    </Panel>
  );
}
