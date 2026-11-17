'use client';

import type { CustomerDetail, Plan } from '@campusverse/platform-control';
import { Button } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { api } from '../../../../lib/api';
import { at, Chip, Field, Loaded, Notice, Panel, field } from '../../../../lib/ui';
import { en } from '../../../../messages/en';

const t = en.customers;

type SupportView = {
  expiresAt: string;
  institutions: {
    name: string;
    board: string;
    status: string;
    year: string | null;
    classes: number;
    sections: number;
  }[];
  imports: {
    kind: string;
    status: string;
    failure: string | null;
    total: number;
    invalid: number;
    duplicate: number;
    createdAt: string;
  }[];
};

export default function CustomerPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const qc = useQueryClient();
  const key = ['customer', orgId];
  const detail = useQuery({
    queryKey: key,
    queryFn: () => api.get<CustomerDetail>(`/customers/${orgId}`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const plan = useMutation({
    mutationFn: (planCode: string) => api.post(`/customers/${orgId}/plan`, { planCode }),
    onSuccess: refresh,
  });
  const flag = useMutation({
    mutationFn: (v: { key: string; enabled: boolean | null }) =>
      api.post(`/customers/${orgId}/flags`, v),
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/"
        className="flex w-fit items-center gap-1.5 text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <Loaded q={detail}>
        {(c) => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-title font-semibold text-ink">{c.name}</h1>
              <Chip tone={c.status}>{t.status[c.status]}</Chip>
            </div>
            <p className="text-body text-ink-muted tabular-nums">
              {t.students(c.students, c.studentLimit)}
              {c.studentLimit !== null && c.students > c.studentLimit && ` · ${t.overLimit}`} ·{' '}
              {c.lastActivity ? t.lastActivity(at(c.lastActivity)) : t.never}
            </p>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title={t.changePlan}>
                <div className="flex flex-col gap-3 p-5">
                  <Field label={t.plan}>
                    <select
                      value={c.planCode}
                      onChange={(e) => plan.mutate(e.target.value)}
                      disabled={plan.isPending}
                      className={field}
                    >
                      {(plans.data ?? []).map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Notice error={plan.error} ok={plan.isSuccess && t.planSaved} />
                </div>
              </Panel>

              <Panel title={t.features}>
                <ul className="divide-y divide-line">
                  {c.flags.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body text-ink">{f.description}</span>
                        <span className="text-caption text-ink-muted">
                          {f.on ? t.on : t.off} ·{' '}
                          {f.override === null ? t.fromPlan : t.override(f.override)}
                        </span>
                      </span>
                      {f.override !== null && (
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => flag.mutate({ key: f.key, enabled: null })}
                        >
                          {t.useDefault}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`${f.on ? t.switchOff : t.switchOn}: ${f.description}`}
                        onClick={() => flag.mutate({ key: f.key, enabled: !f.on })}
                      >
                        {f.on ? t.switchOff : t.switchOn}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="px-5 pb-3">
                  <Notice error={flag.error} />
                </div>
              </Panel>

              <StatusPanel orgId={orgId} detail={c} onDone={refresh} />
              <SupportPanel orgId={orgId} detail={c} onDone={refresh} />
            </div>

            {c.switches.length > 0 && (
              <Panel title={t.switches}>
                <ul className="divide-y divide-line">
                  {c.switches.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <Chip tone="on">{en.switches.keys[s.key]}</Chip>
                      <span className="text-caption text-ink-muted">
                        {s.global ? t.global : c.name} · {s.reason} · {at(s.setAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Panel title={t.deliveries}>
              {c.deliveries.length === 0 ? (
                <p className="px-5 py-3 text-caption text-ink-muted">{t.noDeliveries}</p>
              ) : (
                <ul className="flex flex-wrap gap-2 px-5 py-3">
                  {c.deliveries.map((d) => (
                    <li
                      key={`${d.channel}-${d.state}`}
                      className="rounded-md border border-line px-3 py-1.5 text-caption tabular-nums"
                    >
                      {d.channel} · {d.state}: {d.n}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t.activity}>
              <ul className="divide-y divide-line">
                {c.audit.map((a, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 px-5 py-2.5 text-caption">
                    <span className="text-ink-muted tabular-nums">{at(a.at)}</span>
                    <span className="font-medium text-ink">{a.action}</span>
                    <span className="text-ink-muted">{a.staff ?? en.audit.system}</span>
                    {a.reason && <span className="text-ink-muted">· {a.reason}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </Loaded>
    </div>
  );
}

function StatusPanel({
  orgId,
  detail,
  onDone,
}: {
  orgId: string;
  detail: CustomerDetail;
  onDone: () => void;
}) {
  const [status, setStatus] = useState(detail.status === 'active' ? 'suspended' : 'active');
  const [reason, setReason] = useState('');
  const ask = useMutation({
    mutationFn: () => api.post(`/customers/${orgId}/status`, { status, reason }),
    onSuccess: () => {
      setReason('');
      onDone();
    },
  });
  const waiting = detail.pending.filter((p) => p.kind === 'customer_status');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask.mutate();
  };
  return (
    <Panel title={t.statusTitle}>
      <form onSubmit={submit} aria-label={t.statusTitle} className="flex flex-col gap-3 p-5">
        <p className="text-caption text-ink-muted">{t.statusHint}</p>
        <Field label={t.newStatus}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={field}
          >
            {(['active', 'suspended', 'closed'] as const)
              .filter((s) => s !== detail.status)
              .map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
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
        {waiting.map((p) => (
          <p key={p.id} className="text-caption text-signal-warn-ink">
            {t.pending}: {p.reason} ({p.requestedBy})
          </p>
        ))}
        <div className="flex items-center justify-end gap-3">
          <div className="flex-1">
            <Notice error={ask.error} ok={ask.isSuccess && t.asked} />
          </div>
          <Button type="submit" variant="secondary" disabled={ask.isPending}>
            {t.ask}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SupportPanel({
  orgId,
  detail,
  onDone,
}: {
  orgId: string;
  detail: CustomerDetail;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [open, setOpen] = useState(false);
  const ask = useMutation({
    mutationFn: () => api.post(`/customers/${orgId}/support`, { reason, ticket, minutes }),
    onSuccess: () => {
      setReason('');
      setTicket('');
      onDone();
    },
  });
  const view = useQuery({
    queryKey: ['support-view', orgId],
    queryFn: () => api.get<SupportView>(`/customers/${orgId}/support-view`),
    enabled: open,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask.mutate();
  };
  return (
    <Panel title={t.supportTitle}>
      <div className="flex flex-col gap-3 p-5">
        <p className="text-caption text-ink-muted">{t.supportHint}</p>
        {detail.grants.map((g) => (
          <p key={g.id} className="text-caption text-ink">
            {g.staff} · {t.expires(at(g.expiresAt))}
          </p>
        ))}
        {detail.pending
          .filter((p) => p.kind === 'support_access')
          .map((p) => (
            <p key={p.id} className="text-caption text-signal-warn-ink">
              {t.pending}: {p.reason} ({p.requestedBy})
            </p>
          ))}
        <form
          onSubmit={submit}
          aria-label={t.requestAccess}
          className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]"
        >
          <Field label={t.reason}>
            <input
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={field}
            />
          </Field>
          <Field label={t.ticket}>
            <input
              required
              minLength={2}
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              className={field}
            />
          </Field>
          <Field label={t.minutes}>
            <input
              type="number"
              min={15}
              max={240}
              required
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className={field}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-3">
            <div className="flex-1">
              <Notice error={ask.error} ok={ask.isSuccess && t.asked} />
            </div>
            <Button type="button" variant="quiet" onClick={() => setOpen(true)}>
              {t.openSupport}
            </Button>
            <Button type="submit" variant="secondary" disabled={ask.isPending}>
              {t.requestAccess}
            </Button>
          </div>
        </form>
        {open && (
          <Loaded q={view}>
            {(v) => (
              <div className="flex flex-col gap-3 rounded-md border border-line p-4">
                <p className="text-caption text-ink-muted">{t.expires(at(v.expiresAt))}</p>
                <h3 className="text-body font-semibold text-ink">{t.institutions}</h3>
                <ul className="flex flex-col gap-1 text-caption">
                  {v.institutions.map((i) => (
                    <li key={i.name}>
                      {i.name} · {i.board} · {i.status} · {i.year ?? '—'} ·{' '}
                      {t.classes(i.classes, i.sections)}
                    </li>
                  ))}
                </ul>
                <h3 className="text-body font-semibold text-ink">{t.imports}</h3>
                <ul className="flex flex-col gap-1 text-caption tabular-nums">
                  {v.imports.map((i) => (
                    <li key={i.createdAt}>
                      {at(i.createdAt)} · {i.kind} · {i.status} ·{' '}
                      {t.importLine(i.total, i.invalid, i.duplicate)}
                      {i.failure && ` · ${i.failure}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Loaded>
        )}
      </div>
    </Panel>
  );
}
