'use client';

import type {
  Approval,
  CounterStudent,
  DayCloseView,
  Dues,
  ReconItem,
  ReminderPreview,
  FinanceSummary,
} from '@campusverse/shared-finance';
import {
  Announcer,
  Avatar,
  Button,
  FormModal,
  IconTile,
  KeyFigures,
  PreviewCanvas,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  BadgeCheck,
  Download,
  Receipt,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiFailure } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { ReasonDialog } from '../reason-dialog';
import { api, date, feeError, t } from './shared';

export function FeesHome() {
  const school = useInstitution();
  const id = school.institutionId;
  const [message, setMessage] = useState<string | null>(null);
  if (school.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (school.isError || !id)
    return <StatePanel kind="error" title={en.states.error.title} body={feeError(school.error)} />;
  return (
    <div className="flex flex-col gap-6">
      <FeesBanner institutionId={id} />
      <FeesFigures institutionId={id} />
      <Counter institutionId={id} />
      <div className="grid gap-6 lg:grid-cols-2">
        <MyDay institutionId={id} onMessage={setMessage} />
        <Approvals institutionId={id} />
      </div>
      <DuesPanel institutionId={id} onMessage={setMessage} />
      <Reconciliation institutionId={id} onMessage={setMessage} />
      <Announcer message={message} />
    </div>
  );
}

const today = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** The reference's fee counter banner: the date, the title, and today's collection. */
function FeesBanner({ institutionId }: { institutionId: string }) {
  const day = useQuery({
    queryKey: ['fees-day', institutionId],
    queryFn: () => api.get<DayCloseView>(`/finance/${institutionId}/day`),
    retry: false,
  });
  const total = day.data
    ? day.data.cash.paise + day.data.cheques.paise + day.data.digital.paise
    : null;
  return (
    <header className="relative overflow-hidden rounded-2xl bg-[linear-gradient(115deg,#04266d_0%,hsl(218_70%_30%)_55%,hsl(206_75%_42%)_100%)] px-6 py-6 text-white shadow-[var(--shadow-lift)] motion-safe:animate-rise">
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-cyan-400/20 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center gap-6">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-caption text-white/80">
            <Sparkles aria-hidden className="size-3.5 text-cyan-400" />
            {today.format(new Date())}
          </p>
          <h1 className="mt-1 font-display text-title font-bold text-white">{t.title}</h1>
          <p className="mt-0.5 text-body text-white/80">{t.lead}</p>
        </div>
        <Link
          href="/fees/plans"
          className="inline-flex h-10 items-center rounded-lg bg-white/10 px-4 text-body font-medium text-white ring-1 ring-white/20 hover:bg-white/15"
        >
          {t.plansLink}
        </Link>
        {total !== null && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-caption text-white/80">{t.banner.today}</p>
              <p className="tabular font-display text-title font-bold text-white">
                {rupees(total).replace(/\.00$/, '')}
              </p>
            </div>
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20"
            >
              <Receipt className="size-5" />
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

/** Collected today, total collected, pending dues, students cleared. */
function FeesFigures({ institutionId }: { institutionId: string }) {
  const day = useQuery({
    queryKey: ['fees-day', institutionId],
    queryFn: () => api.get<DayCloseView>(`/finance/${institutionId}/day`),
    retry: false,
  });
  const sum = useQuery({
    queryKey: ['fees-summary', institutionId],
    queryFn: () => api.get<FinanceSummary>(`/finance/${institutionId}/summary`),
    retry: false,
  });
  if (!sum.data) return null;
  const todayPaise = day.data
    ? day.data.cash.paise + day.data.cheques.paise + day.data.digital.paise
    : 0;
  const s = sum.data;
  const money = (p: number) => rupees(p).replace(/\.00$/, '');
  return (
    <KeyFigures
      label={t.title}
      figures={[
        { label: t.banner.collectedToday, value: money(todayPaise), icon: TrendingUp },
        { label: t.banner.totalCollected, value: money(s.collectedPaise), icon: Wallet },
        {
          label: t.banner.pending,
          value: money(s.outstandingPaise),
          icon: AlertCircle,
          ...(s.outstandingPaise > 0 ? { valueTone: 'stop' as const } : {}),
        },
        { label: t.banner.cleared, value: `${s.cleared}/${s.students}`, icon: BadgeCheck },
      ]}
    />
  );
}

/** Some roles see only parts of the page: a 403 hides a panel instead of showing an error. */
const hidden = (e: unknown) => e instanceof ApiFailure && e.status === 403;

function Counter({ institutionId }: { institutionId: string }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);
  const found = useQuery({
    queryKey: ['fee-students', institutionId, q],
    queryFn: () =>
      api.get<CounterStudent[]>(
        `/finance/${institutionId}/students?search=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2,
  });
  if (hidden(found.error)) return null;
  return (
    <section aria-labelledby="counter-title" className="panel flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <IconTile icon={Wallet} area="go" />
        <div className="flex flex-col">
          <h2 id="counter-title" className="text-lead font-semibold text-ink">
            {t.collectTitle}
          </h2>
          <p className="text-body text-ink-muted">{t.collectBody}</p>
        </div>
      </div>
      <label
        id="counter"
        className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 shadow-[var(--shadow-card)] focus-within:border-navy-950"
      >
        <Search aria-hidden className="size-5 text-ink-muted" />
        <span className="sr-only">{t.searchLabel}</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchLabel}
          className="h-12 min-w-0 flex-1 bg-transparent text-lead text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      {q.length >= 2 &&
        (found.isPending ? (
          <p className="text-body text-ink-muted">{en.states.loading.title}</p>
        ) : found.isError ? (
          <p role="alert" className="text-body text-signal-stop-ink">
            {feeError(found.error)}
          </p>
        ) : found.data.length === 0 ? (
          <p className="text-body text-ink-muted">{t.noMatch}</p>
        ) : (
          <ul className="divide-y divide-line">
            {found.data.map((s) => (
              <li key={s.studentId}>
                <Link
                  href={`/fees/students/${s.studentId}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-paper"
                >
                  <Avatar name={s.name} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-navy-950">{s.name}</span>
                    {(s.placement || s.reference) && (
                      <span className="text-caption text-ink-muted">
                        {[s.placement, s.reference].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="tabular text-body text-ink">
                    {s.balancePaise > 0 ? rupees(s.balancePaise) : t.nothingDue}
                  </span>
                  {s.nextDue && s.balancePaise > 0 && (
                    <span className="text-caption text-ink-muted">
                      {t.nextDue(date(s.nextDue))}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function MyDay({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const key = ['fee-day', institutionId];
  const day = useQuery({
    queryKey: key,
    queryFn: () => api.get<DayCloseView>(`/finance/${institutionId}/day`),
  });
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');
  const [deposit, setDeposit] = useState('');
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () =>
      api.post<DayCloseView>(`/finance/${institutionId}/day/close`, {
        countedCashPaise: parseRupees(counted) ?? -1,
        depositRef: deposit || null,
        note: note || null,
      }),
    onSuccess: (d) => {
      setClosing(false);
      qc.setQueryData(key, d);
      onMessage(t.dayClosed(rupees(d.closed?.differencePaise ?? 0)));
    },
  });
  if (hidden(day.error)) return null;
  const d = day.data;
  const countedPaise = parseRupees(counted);
  const differs = d && countedPaise !== null && countedPaise !== d.cash.paise;
  return (
    <section aria-labelledby="my-day" className="panel flex flex-col">
      <h2 id="my-day" className="border-b border-line px-5 py-3 text-body font-semibold text-ink">
        {t.myDay}
      </h2>
      {day.isPending ? (
        <p className="px-5 py-4 text-body text-ink-muted">{en.states.loading.title}</p>
      ) : day.isError || !d ? (
        <p role="alert" className="px-5 py-4 text-body text-signal-stop-ink">
          {feeError(day.error)}
        </p>
      ) : (
        <div className="flex flex-col gap-4 p-5">
          <dl className="grid grid-cols-3 gap-3">
            {(
              [
                ['cash', d.cash],
                ['cheques', d.cheques],
                ['digital', d.digital],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col">
                <dt className="text-caption text-ink-muted">{t[k]}</dt>
                <dd className="tabular text-lead font-semibold text-ink">{rupees(v.paise)}</dd>
                <dd className="text-caption text-ink-muted">{t.count(v.count)}</dd>
              </div>
            ))}
          </dl>
          {d.closed ? (
            <p className="rounded-md bg-signal-go-tint px-3 py-2 text-body text-signal-go-ink">
              {t.dayClosed(rupees(d.closed.differencePaise))}
            </p>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setClosing(true)} aria-haspopup="dialog">
                {t.closeDay}
              </Button>
              {closing && (
                <FormModal
                  title={t.closeDay}
                  description={`${t.cash}: ${rupees(d.cash.paise)} · ${t.count(d.cash.count)}`}
                  size="md"
                  submitLabel={t.closeDay}
                  cancelLabel={en.form.cancel}
                  pending={close.isPending}
                  submitDisabled={countedPaise === null}
                  error={close.isError ? feeError(close.error) : null}
                  onClose={() => {
                    close.reset();
                    setClosing(false);
                  }}
                  onSubmit={() => close.mutate()}
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-caption font-medium text-ink">{t.countedCash}</span>
                    <input
                      inputMode="decimal"
                      required
                      value={counted}
                      onChange={(e) => setCounted(e.target.value)}
                      className={cx(fieldInput, 'tabular')}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-caption font-medium text-ink">{t.depositRef}</span>
                    <input
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      className={fieldInput}
                    />
                  </label>
                  {differs && (
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-caption font-medium text-ink">{t.differenceNote}</span>
                      <input
                        required
                        minLength={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className={fieldInput}
                      />
                    </label>
                  )}
                </FormModal>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Approvals({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const key = ['fee-approvals', institutionId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<Approval[]>(`/finance/${institutionId}/approvals`),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ personId: string }>('/people/me'),
  });
  const [dialog, setDialog] = useState<{ a: Approval; approve: boolean } | null>(null);
  const decide = useMutation({
    mutationFn: (v: { a: Approval; approve: boolean; text?: string }) =>
      api.post(
        `/finance/${v.a.kind === 'concession' ? 'concessions' : v.a.kind === 'refund' ? 'refunds' : 'reversals'}/${v.a.id}/decide`,
        {
          approve: v.approve,
          ...(v.a.kind === 'refund' && v.approve
            ? { payoutRef: v.text ?? null }
            : { note: v.text ?? null }),
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  if (hidden(list.error)) return null;
  return (
    <section aria-labelledby="approvals" className="panel">
      <h2
        id="approvals"
        className="border-b border-line px-5 py-3 text-body font-semibold text-ink"
      >
        {t.approvals}
      </h2>
      {list.isPending ? (
        <p className="px-5 py-4 text-body text-ink-muted">{en.states.loading.title}</p>
      ) : list.isError ? (
        <p role="alert" className="px-5 py-4 text-body text-signal-stop-ink">
          {feeError(list.error)}
        </p>
      ) : list.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noApprovals}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((a) => {
            const mine = a.requestedById === me.data?.personId;
            // Refunds follow the approval engine: decide only on one's step; pay out at the last.
            const step = a.approval;
            const mayDecide = step ? step.mine : !mine;
            const paysOut = a.kind === 'refund' && (!step || step.step === step.steps);
            return (
              <li key={`${a.kind}-${a.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body font-medium text-ink">
                    {t.kinds[a.kind]} ·{' '}
                    <Link
                      href={`/fees/students/${a.studentId}`}
                      className="text-navy-950 hover:underline"
                    >
                      {a.student}
                    </Link>
                    {a.amountPaise !== null && (
                      <span className="tabular"> · {rupees(a.amountPaise)}</span>
                    )}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {a.reason} · {t.requestedBy(a.requestedBy)}
                  </span>
                  {step?.status === 'pending' && (
                    <span className="text-caption text-ink-muted">
                      {en.workflow.progress(
                        step.step,
                        step.steps,
                        step.stepRoleName ?? en.workflow.anyApprover,
                      )}
                    </span>
                  )}
                  {mine && <span className="text-caption text-signal-warn-ink">{t.yours}</span>}
                </div>
                {mayDecide && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog({ a, approve: false })}
                    >
                      {t.reject}
                    </Button>
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() =>
                        paysOut
                          ? setDialog({ a, approve: true })
                          : decide.mutate({ a, approve: true })
                      }
                    >
                      {t.approve}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {decide.isError && (
        <p role="alert" className="px-5 pb-3 text-caption text-signal-stop-ink">
          {feeError(decide.error)}
        </p>
      )}
      {dialog && (
        <ReasonDialog
          title={dialog.approve ? t.payoutTitle : t.rejectTitle}
          hint={dialog.approve ? t.payoutHint : t.rejectHint}
          label={dialog.approve ? t.payoutRef : t.note}
          action={dialog.approve ? t.approve : t.reject}
          cancel={t.cancel}
          minLength={3}
          errorText={feeError}
          onClose={() => setDialog(null)}
          submit={async (text) => {
            await decide.mutateAsync({ a: dialog.a, approve: dialog.approve, text });
          }}
        />
      )}
    </section>
  );
}

function DuesPanel({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const dues = useQuery({
    queryKey: ['fee-dues', institutionId],
    queryFn: () => api.get<Dues>(`/finance/${institutionId}/dues`),
  });
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const ask = useMutation({
    mutationFn: () =>
      api.post<ReminderPreview>(`/finance/${institutionId}/reminders/preview`, {
        minDaysOverdue: 1,
      }),
    onSuccess: setPreview,
  });
  const send = useMutation({
    mutationFn: () =>
      api.post<{ messages: number }>(`/finance/${institutionId}/reminders`, { minDaysOverdue: 1 }),
    onSuccess: (r) => {
      setPreview(null);
      onMessage(t.remindDone(r.messages));
    },
  });
  if (hidden(dues.error)) return null;
  const d = dues.data;
  return (
    <section aria-labelledby="dues" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 id="dues" className="text-lead font-semibold text-ink">
            {t.dues}
          </h2>
          <p className="text-caption text-ink-muted">{t.duesLead}</p>
        </div>
        {d && d.defaulters.length > 0 && (
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void exportCsv(
                  'fee_dues',
                  institutionId,
                  `fee-dues-${d.onDate}`,
                  t.duesCsv,
                  d.defaulters.map((x) => [
                    x.reference,
                    x.name,
                    x.placement,
                    rupees(x.overduePaise).replace(/[₹,]/g, ''),
                    x.oldestDue,
                    x.daysOverdue,
                  ]),
                )
              }
            >
              <Download aria-hidden className="size-4" />
              {t.downloadDues}
            </Button>
            <Button variant="secondary" disabled={ask.isPending} onClick={() => ask.mutate()}>
              {t.remind}
            </Button>
          </span>
        )}
      </div>
      {dues.isPending ? (
        <StatePanel kind="loading" title={en.states.loading.title} />
      ) : dues.isError || !d ? (
        <StatePanel kind="error" title={en.states.error.title} body={feeError(dues.error)} />
      ) : (
        <>
          <AgingBar buckets={d.buckets} />
          <dl className="panel grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x">
            {Object.entries(d.buckets).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-5 py-3">
                <dt className="text-caption text-ink-muted">{t.buckets[k]}</dt>
                <dd
                  className={cx(
                    'tabular text-lead font-semibold',
                    k === '90_plus' && v.paise > 0 ? 'text-signal-stop-ink' : 'text-ink',
                  )}
                >
                  {rupees(v.paise)}
                </dd>
                <dd className="text-caption text-ink-muted">{v.students}</dd>
              </div>
            ))}
          </dl>
          {d.defaulters.length === 0 ? (
            <p className="text-body text-ink-muted">{t.noDues}</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {d.defaulters.slice(0, 20).map((x) => (
                <li key={x.studentId} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/fees/students/${x.studentId}`}
                      className="font-medium text-navy-950 hover:underline"
                    >
                      {x.name}
                    </Link>
                    {(x.placement || x.reference) && (
                      <span className="text-caption text-ink-muted">
                        {[x.placement, x.reference].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="text-caption text-ink-muted">{t.daysLate(x.daysOverdue)}</span>
                  <span className="tabular w-28 text-right text-body text-ink">
                    {rupees(x.overduePaise)}
                  </span>
                </li>
              ))}
              {d.defaulters.length > 20 && (
                <li className="px-5 py-2.5 text-caption text-ink-muted">
                  {t.moreDefaulters(d.defaulters.length - 20)}
                </li>
              )}
            </ul>
          )}
        </>
      )}
      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={t.remindTitle}
        actionLabel={t.remind}
        changes={t.remindChanges(preview?.minDaysOverdue ?? 1)}
        affected={[{ label: t.remindStudents, count: preview?.students ?? 0 }]}
        risks={[]}
        undo={t.remindUndo}
        busy={send.isPending}
        labels={en.preview}
        onConfirm={() => send.mutate()}
      />
    </section>
  );
}

function Reconciliation({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const key = ['fee-recon', institutionId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReconItem[]>(`/finance/${institutionId}/reconciliation`),
  });
  const check = useMutation({
    mutationFn: (paymentId: string) =>
      api.post<{ outcome: string }>(`/finance/payments/${paymentId}/check`),
    onSuccess: (r) => {
      onMessage(t.checked[r.outcome] ?? r.outcome);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  if (hidden(list.error) || (list.data && list.data.length === 0)) {
    return list.data ? <p className="text-caption text-ink-muted">{t.noRecon}</p> : null;
  }
  return (
    <section aria-labelledby="recon" className="panel">
      <h2 id="recon" className="border-b border-line px-5 py-3 text-body font-semibold text-ink">
        {t.reconciliation}
      </h2>
      {list.isPending ? (
        <p className="px-5 py-4 text-body text-ink-muted">{en.states.loading.title}</p>
      ) : list.isError ? (
        <p role="alert" className="px-5 py-4 text-body text-signal-stop-ink">
          {feeError(list.error)}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((r) => (
            <li key={r.paymentId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-ink">
                  {r.student} · <span className="tabular">{rupees(r.amountPaise)}</span>
                </span>
                <span className="text-caption text-ink-muted">
                  {t.reconStates[r.state]} · {date(r.createdAt)}
                </span>
              </span>
              {r.state === 'pending' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={check.isPending}
                  onClick={() => check.mutate(r.paymentId)}
                >
                  {t.checkNow}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const AGE_COLOUR: Record<string, string> = {
  current: 'bg-navy-200',
  '1_30': 'bg-signal-warn/60',
  '31_60': 'bg-signal-warn',
  '61_90': 'bg-signal-stop/70',
  '90_plus': 'bg-signal-stop',
};

/** Where the money owed sits, by lateness: one bar, widths by amount, with a legend. */
function AgingBar({ buckets }: { buckets: Dues['buckets'] }) {
  const entries = Object.entries(buckets);
  const total = entries.reduce((n, [, b]) => n + b.paise, 0);
  if (total === 0) return null;
  return (
    <figure className="panel flex flex-col gap-3 p-5">
      <figcaption className="text-caption font-medium text-ink-muted">{t.agingLabel}</figcaption>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-navy-50">
        {entries.map(([k, b]) =>
          b.paise > 0 ? (
            <div
              key={k}
              className={cx('h-full', AGE_COLOUR[k] ?? 'bg-navy-200')}
              style={{ width: `${(b.paise / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-caption text-ink-muted">
        {entries.map(([k, b]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cx('size-2 rounded-full', AGE_COLOUR[k] ?? 'bg-navy-200')}
            />
            {t.buckets[k]}: <span className="tabular text-ink">{rupees(b.paise)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
