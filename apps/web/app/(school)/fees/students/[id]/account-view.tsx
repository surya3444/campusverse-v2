'use client';

import type { Account, Collected, Head } from '@campusverse/shared-finance';
import { Announcer, Button, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ApiFailure } from '../../../../../lib/api';
import { parseRupees, percent, rupees } from '../../../../../lib/money';
import { en } from '../../../../../messages/en';
import { useInstitution } from '../../../attendance/shared';
import { ReasonDialog } from '../../../reason-dialog';
import { INVOICE_CHIP, api, date, feeError, newIdempotencyKey, postOnce, t } from '../../shared';

const field =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';
type Method = 'cash' | 'cheque' | 'upi' | 'card';

export function AccountView({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const key = ['fee-account', studentId];
  const account = useQuery({
    queryKey: key,
    queryFn: () => api.get<Account>(`/finance/students/${studentId}`),
  });
  const [message, setMessage] = useState<string | null>(null);
  // Kept here, not in the form: after a full payment the form goes, the receipt link stays.
  const [done, setDone] = useState<Collected | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  if (account.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (account.isError) {
    return account.error instanceof ApiFailure && account.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={feeError(account.error)}
        action={en.states.error.action}
        onAction={() => void account.refetch()}
      />
    );
  }
  const a = account.data;
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/fees"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.title}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold text-ink">{a.name}</h1>
          <p className="text-body text-ink-muted">{t.account}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-caption text-ink-muted">{t.balance}</span>
          <span
            className={cx(
              'tabular text-title font-semibold',
              a.balancePaise > 0 ? 'text-ink' : 'text-signal-go-ink',
            )}
          >
            {rupees(a.balancePaise)}
          </span>
          {a.creditPaise > 0 && (
            <span className="text-caption text-ink-muted">{t.credit(rupees(a.creditPaise))}</span>
          )}
        </div>
      </div>

      {a.balancePaise > 0 && (
        <Collect
          studentId={studentId}
          due={a.balancePaise}
          onDone={(r) => {
            setDone(r);
            setMessage(t.collected(r.receiptNumber));
            void refresh();
          }}
        />
      )}
      {done && (
        <p className="flex flex-wrap items-center gap-3 rounded-md bg-signal-go-tint px-3 py-2 text-body text-signal-go-ink">
          <span className="flex-1">
            {t.collected(done.receiptNumber)}{' '}
            {done.creditPaise > 0 && t.credit(rupees(done.creditPaise))}
          </span>
          <Link href={`/fees/receipts/${done.receiptId}`} className="font-medium underline">
            {t.printReceipt}
          </Link>
        </p>
      )}

      <section aria-labelledby="invoices" className="flex flex-col gap-2">
        <h2 id="invoices" className="text-body font-semibold text-ink">
          {t.invoices}
        </h2>
        {a.invoices.length === 0 ? (
          <p className="text-body text-ink-muted">{t.noInvoices}</p>
        ) : (
          <ul className="panel divide-y divide-line">
            {a.invoices.map((i) => (
              <li key={i.id} className="flex flex-col gap-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 font-medium text-ink">
                    {i.label}{' '}
                    <span className="text-caption font-normal text-ink-muted">
                      · {date(i.dueOn)}
                    </span>
                  </span>
                  <span className="tabular text-body text-ink">
                    {rupees(i.paidPaise)} / {rupees(i.totalPaise)}
                  </span>
                  <span
                    className={cx(
                      'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                      INVOICE_CHIP[i.state],
                    )}
                  >
                    {t.invoiceStates[i.state]}
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5 text-caption text-ink-muted">
                  {i.lines.map((l, n) => (
                    <li key={n} className="flex gap-3">
                      <span className="flex-1">
                        {[l.head, t.lineKinds[l.kind]].filter(Boolean).join(' · ')}
                        {l.reason && ` (${l.reason})`}
                      </span>
                      <span className="tabular">{rupees(l.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Payments
        account={a}
        onDone={(m) => {
          setMessage(m);
          void refresh();
        }}
      />
      <Concessions
        account={a}
        onDone={(m) => {
          setMessage(m);
          void refresh();
        }}
      />
      <Announcer message={message} />
    </div>
  );
}

function Collect({
  studentId,
  due,
  onDone,
}: {
  studentId: string;
  due: number;
  onDone: (r: Collected) => void;
}) {
  const [amount, setAmount] = useState(() => rupees(due).replace('₹', ''));
  const [method, setMethod] = useState<Method>('cash');
  const [ref, setRef] = useState('');
  // One key per collection: a double click or a retry after a timeout returns the same receipt.
  const [key, setKey] = useState(newIdempotencyKey);
  const paise = parseRupees(amount);
  const collect = useMutation({
    mutationFn: () =>
      postOnce<Collected>('/finance/payments', key, {
        studentId,
        amountPaise: paise,
        method,
        instrumentRef: ref || null,
      }),
    onSuccess: (r) => {
      setKey(newIdempotencyKey());
      onDone(r);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    collect.mutate();
  };
  return (
    <form onSubmit={submit} aria-label={t.collect} className="panel flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.amount}</span>
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cx(field, 'tabular text-lead')}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.method}</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className={field}
          >
            {(['cash', 'upi', 'card', 'cheque'] as const).map((m) => (
              <option key={m} value={m}>
                {t.methods[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">
            {method === 'cheque' ? t.chequeNo : t.upiRef}
          </span>
          <input
            value={ref}
            required={method === 'cheque'}
            onChange={(e) => setRef(e.target.value)}
            className={field}
          />
        </label>
        <Button type="submit" size="lg" disabled={collect.isPending || !paise || paise <= 0}>
          {t.collectAction(paise ? rupees(paise) : '')}
        </Button>
      </div>
      {collect.isError && (
        <p role="alert" className="text-body text-signal-stop-ink">
          {feeError(collect.error)}
        </p>
      )}
    </form>
  );
}

function Payments({ account, onDone }: { account: Account; onDone: (m: string) => void }) {
  const [refund, setRefund] = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  return (
    <section aria-labelledby="payments" className="flex flex-col gap-2">
      <h2 id="payments" className="text-body font-semibold text-ink">
        {t.payments}
      </h2>
      {account.payments.length === 0 ? (
        <p className="text-body text-ink-muted">{t.noPayments}</p>
      ) : (
        <ul className="panel divide-y divide-line">
          {account.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="tabular w-28 font-medium text-ink">{rupees(p.amountPaise)}</span>
              <span className="flex-1 text-caption text-ink-muted">
                {t.methods[p.method]} · {date(p.at)} · {t.paymentStates[p.state]}
              </span>
              {p.receiptId && (
                <Link
                  href={`/fees/receipts/${p.receiptId}`}
                  className="text-caption text-navy-950 hover:underline"
                >
                  {t.receipt} {p.receiptNumber}
                </Link>
              )}
              {p.state === 'succeeded' && (
                <>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setAmount('');
                      setRefund(p.id);
                    }}
                  >
                    {t.refund}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setAmount('');
                      setReverse(p.id);
                    }}
                  >
                    {t.reverse}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {refund && (
        <ReasonDialog
          title={t.refundTitle}
          hint={t.refundHint}
          label={t.reason}
          action={t.refund}
          cancel={t.cancel}
          minLength={3}
          errorText={feeError}
          onClose={() => setRefund(null)}
          submit={async (reason) => {
            await api.post(`/finance/payments/${refund}/refunds`, {
              amountPaise: parseRupees(amount) ?? 0,
              reason,
            });
            onDone(t.requested);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.amount}</span>
            <input
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cx(field, 'tabular')}
            />
          </label>
        </ReasonDialog>
      )}
      {reverse && (
        <ReasonDialog
          title={t.reverseTitle}
          hint={t.reverseHint}
          label={t.reason}
          action={t.reverse}
          cancel={t.cancel}
          minLength={3}
          errorText={feeError}
          onClose={() => setReverse(null)}
          submit={async (reason) => {
            await api.post(`/finance/payments/${reverse}/reversal`, {
              reason,
              chargePaise: parseRupees(amount || '0') ?? 0,
            });
            onDone(t.requested);
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.bounceCharge}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cx(field, 'tabular')}
            />
          </label>
        </ReasonDialog>
      )}
    </section>
  );
}

function Concessions({ account, onDone }: { account: Account; onDone: (m: string) => void }) {
  const school = useInstitution();
  const heads = useQuery({
    queryKey: ['fee-heads', school.institutionId],
    queryFn: () => api.get<Head[]>(`/finance/${school.institutionId}/heads`),
    enabled: !!school.institutionId,
  });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [category, setCategory] = useState('sibling');
  const [headId, setHeadId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const valuePaise = parseRupees(value);
  return (
    <section aria-labelledby="concessions" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="concessions" className="text-body font-semibold text-ink">
          {t.concessions}
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t.addConcession}
        </Button>
      </div>
      {account.concessions.length === 0 ? (
        <p className="text-body text-ink-muted">{t.noConcessions}</p>
      ) : (
        <ul className="panel divide-y divide-line">
          {account.concessions.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-body">
              <span className="tabular w-24 font-medium text-ink">
                {c.kind === 'percent' ? percent(c.value) : rupees(c.value)}
              </span>
              <span className="flex-1 text-ink-muted">
                {t.categories[c.category]} · {c.head ?? t.allHeads} · {date(c.from)} –{' '}
                {date(c.until)} · {c.reason}
              </span>
              <span className="text-caption text-ink-muted">{t.concessionStates[c.state]}</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <ReasonDialog
          title={t.concessionTitle}
          hint={t.concessionHint}
          label={t.reason}
          action={t.addConcession}
          cancel={t.cancel}
          minLength={3}
          errorText={feeError}
          onClose={() => setOpen(false)}
          submit={async (reason) => {
            await api.post('/finance/concessions', {
              studentId: account.studentId,
              headId: headId || null,
              kind,
              // Percent is entered as "10" or "12.5" and stored as basis points; amounts as paise.
              value: valuePaise ?? 0,
              category,
              from,
              to,
              reason,
            });
            onDone(t.requested);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.concessionKind}</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}
                className={field}
              >
                <option value="percent">{t.concessionKinds.percent}</option>
                <option value="amount">{t.concessionKinds.amount}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.concessionValue}</span>
              <input
                inputMode="decimal"
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={cx(field, 'tabular')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.category}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={field}
              >
                {Object.entries(t.categories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.heads}</span>
              <select value={headId} onChange={(e) => setHeadId(e.target.value)} className={field}>
                <option value="">{t.allHeads}</option>
                {(heads.data ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.from}</span>
              <input
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.to}</span>
              <input
                type="date"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={field}
              />
            </label>
          </div>
        </ReasonDialog>
      )}
    </section>
  );
}
