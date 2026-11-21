'use client';

// A donation receipt as issued: printed on one page, with the voluntary statement. Cancelled
// receipts stay, stamped, with who cancelled and why.
import type { DonationReceipt } from '@campusverse/shared-finance';
import { Announcer, Button, StatePanel } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees, rupeesInWords } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { ReasonDialog } from '../../reason-dialog';
import { date } from '../../fees/shared';
import { d, donationError } from '../donations-view';

export function DonationReceiptView({ id }: { id: string }) {
  const r = useQuery({
    queryKey: ['donation', id],
    queryFn: () => api.get<DonationReceipt>(`/finance/donations/${id}`),
  });
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const t = d.receipt;
  if (r.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (r.isError)
    return r.error instanceof ApiFailure && r.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={donationError(r.error)} />
    );
  const x = r.data;
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href="/donations"
          className="inline-flex items-center gap-2 rounded-lg px-1 text-body font-medium text-ink hover:text-navy-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t.back}
        </Link>
        <span className="flex-1" />
        {x.canCancel && (
          <Button variant="secondary" onClick={() => setCancelling(true)} aria-haspopup="dialog">
            <XCircle aria-hidden className="size-4" />
            {t.cancel}
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t.print}
        </Button>
      </div>
      <article className="panel relative flex flex-col gap-5 overflow-hidden p-6 print:border-0 print:p-0">
        {x.cancelled && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-10 right-6 rotate-[-8deg] rounded-md border-2 border-signal-stop px-3 py-1 font-display text-lead font-bold tracking-wide text-signal-stop-ink uppercase"
          >
            {t.cancelledStamp}
          </span>
        )}
        <header className="flex flex-col gap-1 border-b border-line pb-4">
          <span className="text-caption text-ink-muted">{x.entity}</span>
          <h1 className="text-title font-semibold text-ink">{x.institution}</h1>
          <span className="text-body font-medium text-ink">
            {t.title}
            {x.cancelled && ` · ${t.cancelledStamp}`}
          </span>
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-ink-muted">{t.number}</dt>
          <dd className="tabular font-medium text-ink">{x.number}</dd>
          <dt className="text-ink-muted">{t.date}</dt>
          <dd className="text-ink">{date(x.receivedOn)}</dd>
          <dt className="text-ink-muted">{t.donor}</dt>
          <dd className="text-ink">
            {x.donorName}
            {x.donorAddress && <span className="block text-ink-muted">{x.donorAddress}</span>}
          </dd>
          <dt className="text-ink-muted">{t.fund}</dt>
          <dd className="text-ink">{x.fund}</dd>
          <dt className="text-ink-muted">{t.method}</dt>
          <dd className="text-ink">
            {d.form.methods[x.method] ?? x.method}
            {x.instrumentRef ? ` · ${x.instrumentRef}` : ''}
          </dd>
        </dl>
        <div className="flex items-baseline justify-between border-t border-line-strong pt-3">
          <span className="text-body font-semibold text-ink">{t.total}</span>
          <span className="tabular text-title font-semibold text-ink">{rupees(x.amountPaise)}</span>
        </div>
        <p className="-mt-3 text-caption text-ink-muted">{rupeesInWords(x.amountPaise)}</p>
        <p className="rounded-lg bg-paper px-3 py-2 text-body text-ink">{t.voluntary}</p>
        <p className="text-caption text-ink-muted">{t.recordedBy(x.recordedBy)}</p>
        {x.cancelled && x.cancelledBy && (
          <p className="text-caption text-signal-stop-ink">
            {t.cancelledBy(x.cancelledBy, x.cancelReason ?? '')}
          </p>
        )}
      </article>
      {cancelling && (
        <ReasonDialog
          title={t.cancelTitle}
          hint={t.cancelHint}
          label={t.cancelReason}
          action={t.cancel}
          cancel={en.form.cancel}
          minLength={3}
          errorText={donationError}
          onClose={() => setCancelling(false)}
          submit={async (reason) => {
            await api.post(`/finance/donations/${id}/cancel`, { reason });
            setCancelling(false);
            setMessage(t.cancelled);
            await r.refetch();
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}
