'use client';

import type { Receipt } from '@campusverse/shared-finance';
import { Button, StatePanel } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { ApiFailure } from '../../../../../lib/api';
import { rupees, rupeesInWords } from '../../../../../lib/money';
import { en } from '../../../../../messages/en';
import { api, date, feeError, t } from '../../shared';

type Snapshot = {
  number?: string;
  entity?: string;
  institution?: string;
  student?: string;
  placement?: string | null;
  admissionNumber?: string | null;
  balanceAfterPaise?: number;
  method?: string;
  instrumentRef?: string | null;
  lines?: { invoice: string; amountPaise: number }[];
  creditPaise?: number;
  reason?: string;
  payoutRef?: string;
};

/** The receipt exactly as issued: printed on one page, never recalculated. */
export function ReceiptView({ id }: { id: string }) {
  const r = useQuery({
    queryKey: ['fee-receipt', id],
    queryFn: () => api.get<Receipt>(`/finance/receipts/${id}`),
  });
  if (r.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (r.isError) {
    return r.error instanceof ApiFailure && r.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={feeError(r.error)} />
    );
  }
  const s = r.data.snapshot as Snapshot;
  const title =
    r.data.kind === 'reversal'
      ? t.creditNote
      : r.data.kind === 'refund'
        ? t.refundVoucher
        : t.receiptTitle;
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <div className="flex justify-end print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t.printReceipt}
        </Button>
      </div>
      <article className="panel flex flex-col gap-5 p-6 print:border-0 print:p-0">
        <header className="flex flex-col gap-1 border-b border-line pb-4">
          <span className="text-caption text-ink-muted">{s.entity}</span>
          <h1 className="text-title font-semibold text-ink">{s.institution}</h1>
          <span className="text-body font-medium text-ink">{title}</span>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body">
          <dt className="text-ink-muted">{t.receiptNo}</dt>
          <dd className="tabular font-medium text-ink">{r.data.number}</dd>
          <dt className="text-ink-muted">{t.date}</dt>
          <dd className="text-ink">{date(r.data.issuedAt)}</dd>
          <dt className="text-ink-muted">{t.student}</dt>
          <dd className="text-ink">{s.student ?? '—'}</dd>
          {s.placement && (
            <>
              <dt className="text-ink-muted">{t.receiptClass}</dt>
              <dd className="text-ink">{s.placement}</dd>
            </>
          )}
          {s.admissionNumber && (
            <>
              <dt className="text-ink-muted">{t.receiptAdmission}</dt>
              <dd className="tabular text-ink">{s.admissionNumber}</dd>
            </>
          )}
          {s.method && (
            <>
              <dt className="text-ink-muted">{t.method}</dt>
              <dd className="text-ink">
                {t.methods[s.method] ?? s.method}
                {s.instrumentRef ? ` · ${s.instrumentRef}` : ''}
              </dd>
            </>
          )}
          {r.data.issuedBy && (
            <>
              <dt className="text-ink-muted">{t.issuedBy}</dt>
              <dd className="text-ink">{r.data.issuedBy}</dd>
            </>
          )}
          {(s.reason || s.payoutRef) && (
            <>
              <dt className="text-ink-muted">{t.reason}</dt>
              <dd className="text-ink">{s.reason ?? s.payoutRef}</dd>
            </>
          )}
        </dl>
        {s.lines && s.lines.length > 0 && (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th scope="col" className="py-2 font-medium">
                  {t.towards}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t.paid}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-2 text-ink">{l.invoice}</td>
                  <td className="tabular py-2 text-right text-ink">{rupees(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex items-baseline justify-between border-t border-line-strong pt-3">
          <span className="text-body font-semibold text-ink">{t.receiptTotal}</span>
          <span className="tabular text-title font-semibold text-ink">
            {rupees(r.data.amountPaise)}
          </span>
        </div>
        <p className="-mt-3 text-caption text-ink-muted">{rupeesInWords(r.data.amountPaise)}</p>
        {s.balanceAfterPaise !== undefined && r.data.kind === 'receipt' && (
          <div className="flex items-baseline justify-between text-body">
            <span className="text-ink-muted">{t.balanceAfter}</span>
            <span className="tabular text-ink">{rupees(s.balanceAfterPaise)}</span>
          </div>
        )}
        {!!s.creditPaise && (
          <p className="text-caption text-ink-muted">{t.credit(rupees(s.creditPaise))}</p>
        )}
        <p className="text-caption text-ink-muted">{t.reprint}</p>
      </article>
    </div>
  );
}
