'use client';

// Government Reports › APAAR from UDISE+ (rule book §15: "APAAR capture with consent; …
// reconciliation"; P0 item 15): upload the portal's list, see each row's outcome, store the IDs
// that may be stored.
import type { ApaarReconciliation } from '@campusverse/school-returns';
import { Button, FormModal, Pill, Section, type Tone } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';

const t = en.apaarSync;
const TONE: Record<string, Tone> = { store: 'go', no_consent: 'warn' };
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function ApaarSync({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const check = useMutation({
    mutationFn: (text: string) =>
      api.post<ApaarReconciliation>('/returns/apaar', { institutionId, csv: text, apply: false }),
  });
  const apply = useMutation({
    mutationFn: () =>
      api.post<ApaarReconciliation>('/returns/apaar', { institutionId, csv, apply: true }),
    onSuccess: (r) => {
      setConfirming(false);
      onMessage(t.stored(r.stored));
      if (csv) check.mutate(csv);
    },
  });
  const r = check.data;
  const ready = r?.counts.store ?? 0;
  return (
    <Section
      id="apaar-sync"
      title={t.title}
      description={t.lead}
      actions={
        <span className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label={t.chooseFor}
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const text = await file.text();
              setCsv(text);
              check.mutate(text);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={check.isPending}
            onClick={() => input.current?.click()}
          >
            {check.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden className="size-4" />
            )}
            {check.isPending ? t.checking : t.choose}
          </Button>
          {r && ready > 0 && (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {t.store(ready)}
            </Button>
          )}
        </span>
      }
      flush
    >
      {check.error && (
        <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
          {errorText(check.error)}
        </p>
      )}
      {r && (
        <>
          <p className="flex flex-wrap gap-2 px-6 pb-3">
            {Object.entries(r.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <Pill key={k} tone={TONE[k] ?? 'stop'}>
                  {n} · {t.outcomes[k]}
                </Pill>
              ))}
          </p>
          {/* Focusable so keyboard users can scroll it on a phone. */}
          <div className="overflow-x-auto" tabIndex={0}>
            <table className="w-full min-w-[640px] text-body">
              <caption className="sr-only">{t.title}</caption>
              <thead>
                <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t.table.line}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t.table.portal}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t.table.student}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t.table.outcome}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.rows.map((row) => (
                  <tr key={row.line}>
                    <td className="tabular px-5 py-2 text-ink-muted">{row.line}</td>
                    <th scope="row" className="px-5 py-2 text-left font-normal text-ink">
                      {row.portalName}
                      <span className="tabular block text-caption text-ink-muted">{row.pen}</span>
                    </th>
                    <td className="px-5 py-2 text-ink">{row.name ?? '—'}</td>
                    <td className="px-5 py-2">
                      <Pill tone={TONE[row.outcome] ?? 'stop'}>{t.outcomes[row.outcome]}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {confirming && (
        <FormModal
          title={t.storeTitle}
          submitLabel={t.store(ready)}
          cancelLabel={en.form.cancel}
          pending={apply.isPending}
          error={apply.isError ? errorText(apply.error) : null}
          onClose={() => setConfirming(false)}
          onSubmit={() => apply.mutate()}
        >
          <p className="text-body text-ink sm:col-span-2">{t.storeLead(ready)}</p>
        </FormModal>
      )}
    </Section>
  );
}
