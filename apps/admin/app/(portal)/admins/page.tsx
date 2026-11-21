'use client';

import type { AdminRow, InviteRow, Plan } from '@campusverse/platform-control';
import { Button, FormModal, ModalField, PageHeader, Pill, Segmented } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Copy, Mail, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { at, errorText, field, Loaded, Notice } from '../../../lib/ui';
import { en } from '../../../messages/en';

const t = en.admins;
type Tab = 'requests' | 'admins' | 'invites';

/**
 * Organisation admins: sign-up requests to approve or decline, email invites with a one-time
 * link, and every admin with the organisations they run.
 */
export default function AdminsPage() {
  const [tab, setTab] = useState<Tab>('requests');
  const [inviting, setInviting] = useState(false);
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.get<InviteRow[]>('/invites'),
  });
  const requests = (invites.data ?? []).filter((i) => i.status === 'requested');
  const open = (invites.data ?? []).filter((i) => i.status === 'invited');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={UsersRound}
        area="navy"
        title={t.title}
        description={t.lead}
        actions={
          <Button onClick={() => setInviting(true)}>
            <Mail aria-hidden className="size-4" />
            {t.inviteEmail}
          </Button>
        }
      >
        <Segmented
          label={t.title}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'requests', label: t.tabs.requests, count: requests.length },
            { value: 'admins', label: t.tabs.admins },
            { value: 'invites', label: t.tabs.invites, count: open.length },
          ]}
        />
      </PageHeader>
      {tab === 'requests' && <Loaded q={invites}>{() => <Requests rows={requests} />}</Loaded>}
      {tab === 'admins' && <Admins />}
      {tab === 'invites' && <Loaded q={invites}>{() => <OpenInvites rows={open} />}</Loaded>}
      {inviting && <InviteForm onClose={() => setInviting(false)} />}
    </div>
  );
}

const kindLabel = (k: string | null) => (k ? (t.kinds[k] ?? k) : null);
const contact = (i: { phone: string | null; email: string | null }) =>
  [i.phone && `…${i.phone.slice(-4)}`, i.email].filter(Boolean).join(' · ');

function Requests({ rows }: { rows: InviteRow[] }) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState<InviteRow | null>(null);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (
      v: { id: string; decision: 'approve' } | { id: string; decision: 'decline'; reason: string },
    ) =>
      api.post(
        `/invites/${v.id}/decision`,
        v.decision === 'approve'
          ? { decision: 'approve' }
          : { decision: 'decline', reason: v.reason },
      ),
    onSuccess: () => {
      setDeclining(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
  });
  if (rows.length === 0)
    return (
      <div className="panel px-5 py-10 text-center">
        <p className="font-medium text-ink">{t.noRequests}</p>
        <p className="mt-1 text-caption text-ink-muted">{t.noRequestsBody}</p>
      </div>
    );
  return (
    <section className="panel" aria-label={t.tabs.requests}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.inviteId} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-950">
              <Building2 aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-ink">{r.organisation ?? r.name}</span>
              <span className="text-caption text-ink-muted">
                {[kindLabel(r.kind), t.by(r.name), contact(r), at(r.createdAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setDeclining(r)}
                aria-label={`${t.decline}: ${r.organisation ?? r.name}`}
              >
                {t.decline}
              </Button>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.inviteId, decision: 'approve' })}
                aria-label={`${t.approve}: ${r.organisation ?? r.name}`}
              >
                <Check aria-hidden className="size-4" />
                {t.approve}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {!declining && (
        <div className="px-5 pb-3">
          <Notice error={decide.error} />
        </div>
      )}
      {declining && (
        <FormModal
          title={t.declineTitle(declining.organisation ?? declining.name)}
          description={t.declineLead}
          submitLabel={t.decline}
          cancelLabel={t.cancel}
          tone="danger"
          pending={decide.isPending}
          submitDisabled={reason.trim().length < 3}
          error={decide.error ? errorText(decide.error) : null}
          onClose={() => setDeclining(null)}
          onSubmit={() =>
            decide.mutate({ id: declining.inviteId, decision: 'decline', reason: reason.trim() })
          }
        >
          <ModalField label={t.reason}>
            <textarea
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${field} h-auto py-2`}
            />
          </ModalField>
        </FormModal>
      )}
    </section>
  );
}

function Admins() {
  const list = useQuery({ queryKey: ['admins'], queryFn: () => api.get<AdminRow[]>('/admins') });
  return (
    <Loaded q={list} empty={(d) => d.length === 0}>
      {(rows) => (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => (
            <li key={a.accountId} className="panel flex flex-col">
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#04266d,#1a5fb4)] font-semibold text-white">
                  {a.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-ink">{a.name}</span>
                  <span className="truncate text-caption text-ink-muted">
                    {contact(a)} · {t.since(at(a.since))}
                  </span>
                </span>
                <span className="tabular text-caption text-ink-muted">
                  {t.orgCount(a.organisations.length)}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {a.organisations.map((o) => (
                  <li key={o.orgId}>
                    <Link
                      href={`/customers/${o.orgId}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-paper"
                    >
                      <Building2 aria-hidden className="size-4 shrink-0 text-ink-muted" />
                      <span className="min-w-0 flex-1 truncate text-body text-navy-950">
                        {o.name}
                      </span>
                      <span className="text-caption text-ink-muted">{o.planName}</span>
                      <Pill tone={o.status === 'active' ? 'go' : 'stop'}>
                        {en.customers.status[o.status] ?? o.status}
                      </Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Loaded>
  );
}

function OpenInvites({ rows }: { rows: InviteRow[] }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/invites/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  if (rows.length === 0)
    return (
      <div className="panel px-5 py-10 text-center">
        <p className="font-medium text-ink">{t.noInvites}</p>
      </div>
    );
  return (
    <section className="panel" aria-label={t.tabs.invites}>
      <ul className="divide-y divide-line">
        {rows.map((i) => (
          <li key={i.inviteId} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-ink">{i.name}</span>
              <span className="text-caption text-ink-muted">
                {[
                  contact(i),
                  t.sources[i.source],
                  en.customers.invitedBy(i.invitedBy, at(i.createdAt)),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <Pill tone="warn">{i.phone ? t.waitingOnboarding : t.linkOpen(at(i.expiresAt))}</Pill>
            <Button size="sm" variant="quiet" onClick={() => cancel.mutate(i.inviteId)}>
              {en.customers.cancelInvite}
            </Button>
          </li>
        ))}
      </ul>
      <div className="px-5 pb-3">
        <Notice error={cancel.error} />
      </div>
    </section>
  );
}

/** Invite by email: a one-time sign-up link that needs no approval, shown once to copy or email. */
function InviteForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/plans') });
  const [form, setForm] = useState({ name: '', email: '', planCode: 'pilot' });
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: () => api.post<{ link: string; days: number }>('/invites/email', form),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const done = save.data;
  if (done) {
    const mail = `mailto:${encodeURIComponent(form.email)}?subject=${encodeURIComponent(
      t.mailSubject,
    )}&body=${encodeURIComponent(t.mailBody(form.name, done.link, done.days))}`;
    return (
      <FormModal
        title={t.linkReady}
        description={t.linkLead(form.email, done.days)}
        submitLabel={t.done}
        cancelLabel={t.cancel}
        onClose={onClose}
        onSubmit={onClose}
      >
        <ModalField label={t.link}>
          <input readOnly value={done.link} className={field} onFocus={(e) => e.target.select()} />
        </ModalField>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            onClick={() =>
              void navigator.clipboard.writeText(done.link).then(() => setCopied(true))
            }
          >
            <Copy aria-hidden className="size-4" />
            {copied ? t.copied : t.copy}
          </Button>
          <a
            href={mail}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-body font-medium text-navy-950 hover:bg-navy-50"
          >
            <Mail aria-hidden className="size-4" />
            {t.openMail}
          </a>
        </div>
        <p role="status" className="sr-only">
          {copied ? t.copied : ''}
        </p>
      </FormModal>
    );
  }
  return (
    <FormModal
      title={t.inviteEmail}
      description={t.inviteLead}
      submitLabel={t.createLink}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={form.name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)}
      error={save.error ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name}>
        <input
          required
          minLength={2}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={t.email}>
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={field}
        />
      </ModalField>
      <ModalField label={en.customers.plan}>
        <select
          value={form.planCode}
          onChange={(e) => setForm({ ...form, planCode: e.target.value })}
          className={field}
        >
          {(plans.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
    </FormModal>
  );
}
