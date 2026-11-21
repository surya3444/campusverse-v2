'use client';

// Voluntary donations to the trust (owner's brief, 21 Nov 2026): their own receipts, never a fee
// and never for a seat. A family with an admission in progress is refused by the server.
import type { DonationReceipt, Donations } from '@campusverse/shared-finance';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  Segmented,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartHandshake, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { parseRupees, rupees, shortRupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { date } from '../fees/shared';

export const d = en.donations;
export const donationError = (e: unknown): string =>
  d.errors[e instanceof ApiFailure ? e.code : 'error'] ?? d.errors.error ?? '';
const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function DonationsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const [fy, setFy] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const list = useQuery({
    queryKey: ['donations', id, fy],
    queryFn: () => api.get<Donations>(`/finance/${id}/donations${fy ? `?fy=${fy}` : ''}`),
    enabled: !!id,
  });

  if (school.isPending || list.isPending)
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (list.isError || school.isError || !id)
    return list.error instanceof ApiFailure && list.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={donationError(list.error ?? school.error)}
        action={en.states.error.action}
        onAction={() => void list.refetch()}
      />
    );
  const v = list.data;
  const top = v.byFund[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={HeartHandshake}
        area="go"
        eyebrow={en.systems.groups.finance}
        title={d.title}
        description={d.lead}
        actions={
          can('finance.donation.record') ? (
            <Button onClick={() => setRecording(true)} aria-haspopup="dialog">
              <Plus aria-hidden className="size-4" />
              {d.record}
            </Button>
          ) : undefined
        }
      >
        {v.years.length > 1 && (
          <Segmented
            label={d.year}
            value={v.financialYear}
            onChange={setFy}
            options={v.years.map((y) => ({ value: y, label: y }))}
          />
        )}
      </PageHeader>

      <p className="flex items-start gap-3 rounded-xl border border-line bg-navy-50/50 px-4 py-3 text-body text-ink">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-navy-950" />
        {d.rule}
      </p>

      <KeyFigures
        variant="strip"
        label={`${d.figures} · ${v.financialYear}`}
        figures={[
          {
            label: d.total,
            value: shortRupees(v.totalPaise),
            valueTone: 'navy',
            note: v.financialYear,
          },
          { label: d.count, value: String(v.count) },
          { label: d.donors, value: String(v.donors) },
          {
            label: d.topFund,
            value: top ? shortRupees(top.amountPaise) : d.none,
            note: top?.fund,
          },
        ]}
      />

      {v.donations.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={HeartHandshake}
            area="go"
            title={d.emptyTitle}
            body={d.emptyBody}
            actions={
              can('finance.donation.record') ? (
                <Button onClick={() => setRecording(true)}>{d.record}</Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Section title={`${d.title} · ${v.financialYear}`} flush>
            <div
              role="region"
              aria-label={d.title}
              tabIndex={0}
              className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:outline-none"
            >
              <table className="w-full text-body">
                <thead>
                  <tr className="border-y border-line bg-paper text-left text-caption text-ink-muted">
                    <th scope="col" className="px-6 py-2 font-medium">
                      {d.number}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {d.donor}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {d.fund}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {d.date}
                    </th>
                    <th scope="col" className="px-6 py-2 text-right font-medium">
                      {d.amount}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {v.donations.map((x) => (
                    <tr key={x.id} className={x.cancelled ? 'text-ink-muted' : undefined}>
                      <th scope="row" className="px-6 py-2.5 text-left font-normal">
                        <Link
                          href={`/donations/${x.id}`}
                          aria-label={d.open(x.number)}
                          className="tabular font-mono text-caption font-medium text-navy-950 hover:underline"
                        >
                          {x.number}
                        </Link>
                      </th>
                      <td className="px-3 py-2.5">
                        <span className={x.cancelled ? 'line-through' : 'text-ink'}>
                          {x.donorName}
                        </span>
                        {x.cancelled && (
                          <span className="ml-2 align-middle">
                            <Pill tone="stop">{d.cancelled}</Pill>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">{x.fund}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">
                        {date(x.receivedOn)}
                      </td>
                      <td
                        className={`tabular px-6 py-2.5 text-right font-medium ${x.cancelled ? 'line-through' : 'text-ink'}`}
                      >
                        {rupees(x.amountPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={d.funds}>
            <ul className="flex flex-col gap-3">
              {v.byFund.map((f) => (
                <li key={f.fund} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body font-medium text-ink">{f.fund}</span>
                    <span className="tabular text-body text-ink">{rupees(f.amountPaise)}</span>
                  </div>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-navy-50">
                    <span
                      className="block h-full rounded-full bg-signal-go"
                      style={{ width: `${(f.amountPaise / Math.max(v.totalPaise, 1)) * 100}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {recording && (
        <DonationDialog institutionId={id} funds={v.funds} onClose={() => setRecording(false)} />
      )}
    </div>
  );
}

function DonationDialog({
  institutionId,
  funds,
  onClose,
}: {
  institutionId: string;
  funds: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const f = d.form;
  const [kind, setKind] = useState<'person' | 'organisation'>('person');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [fund, setFund] = useState(funds[0] ?? 'General fund');
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [voluntary, setVoluntary] = useState(false);
  const paise = parseRupees(amount);
  const digits = phone.replace(/\D/g, '').slice(-10);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>(`/finance/${institutionId}/donations`, {
        donorKind: kind,
        donorName: name.trim(),
        donorPhone: digits ? `+91${digits}` : null,
        donorEmail: email.trim() || null,
        donorAddress: address.trim() || null,
        fund: fund.trim(),
        amountPaise: paise,
        method,
        instrumentRef: reference.trim() || null,
        receivedOn,
        note: note.trim() || null,
        voluntary,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['donations'] });
      router.push(`/donations/${r.id}`);
    },
  });
  const ready =
    name.trim() &&
    paise &&
    paise > 0 &&
    voluntary &&
    (kind === 'organisation' || digits.length === 10 || email.trim()) &&
    (method === 'cash' || reference.trim());
  return (
    <FormModal
      title={f.title}
      description={f.lead}
      submitLabel={f.save}
      cancelLabel={en.form.cancel}
      size="lg"
      pending={save.isPending}
      submitDisabled={!ready}
      error={save.isError ? donationError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <div className="col-span-full">
        <Segmented
          label={f.donorKind}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'person', label: f.kinds.person ?? '' },
            { value: 'organisation', label: f.kinds.organisation ?? '' },
          ]}
        />
      </div>
      <ModalField label={f.donorName} wide>
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.donorPhone} hint={kind === 'person' ? f.donorPhoneHint : f.optional}>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={`${fieldInput} tabular`}
        />
      </ModalField>
      <ModalField label={f.donorEmail} hint={f.optional}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.donorAddress} hint={f.optional} wide>
        <input
          maxLength={300}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.amount}>
        <input
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${fieldInput} tabular`}
        />
      </ModalField>
      <ModalField label={f.fund} hint={f.fundHint}>
        <input
          required
          maxLength={60}
          list="donation-funds"
          value={fund}
          onChange={(e) => setFund(e.target.value)}
          className={fieldInput}
        />
        <datalist id="donation-funds">
          {funds.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </ModalField>
      <ModalField label={f.receivedOn}>
        <input
          type="date"
          required
          max={todayIso()}
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.method}>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={fieldInput}>
          {Object.entries(f.methods).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </ModalField>
      {method !== 'cash' && (
        <ModalField label={f.reference} hint={f.referenceHint} wide>
          <input
            required
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={fieldInput}
          />
        </ModalField>
      )}
      <ModalField label={f.note} hint={f.optional} wide>
        <input
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <label className="col-span-full flex items-start gap-3 rounded-lg border border-line bg-paper px-3 py-2.5 text-body text-ink">
        <input
          type="checkbox"
          checked={voluntary}
          onChange={(e) => setVoluntary(e.target.checked)}
          className="mt-0.5 size-4 accent-[#04266d]"
        />
        {f.voluntary}
      </label>
    </FormModal>
  );
}

export type { DonationReceipt };
