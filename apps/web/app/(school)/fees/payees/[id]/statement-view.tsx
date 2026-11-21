'use client';

// One body's statement: what is billed and collected for it, student by student (the list the
// university asks for), and every payment made to it with its reference.
import type { PayeeStatement } from '@campusverse/shared-finance';
import {
  Announcer,
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Section,
  StatePanel,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Landmark, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../../lib/api';
import { downloadCsv } from '../../../../../lib/csv';
import { rupees, shortRupees } from '../../../../../lib/money';
import { en } from '../../../../../messages/en';
import { useMe } from '../../../common/me';
import { date } from '../../shared';
import { RemitDialog, YearSwitch, c, payeeError } from '../payees-view';

export function StatementView({ id }: { id: string }) {
  const { can } = useMe();
  const asked = useSearchParams().get('year') ?? undefined;
  const [year, setYear] = useState<string | undefined>(asked);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const s = useQuery({
    queryKey: ['fee-payee', id, year],
    queryFn: () => api.get<PayeeStatement>(`/finance/payees/${id}${year ? `?year=${year}` : ''}`),
  });
  if (s.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (s.isError)
    return s.error instanceof ApiFailure && s.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={payeeError(s.error)}
        action={en.states.error.action}
        onAction={() => void s.refetch()}
      />
    );
  const { payee: p, students, remittances } = s.data;
  const shown = s.data.year ?? 'all';
  const exportList = () =>
    downloadCsv(
      `${p.shortName}-${shown}-students`,
      [c.student, c.placement, c.reference, c.billed, c.collected, c.due],
      students.map((x) => [
        x.name,
        x.placement,
        x.reference,
        x.billedPaise / 100,
        x.collectedPaise / 100,
        Math.max(0, x.billedPaise - x.collectedPaise) / 100,
      ]),
    );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/fees/payees"
        className="inline-flex items-center gap-2 self-start rounded-lg px-1 text-body font-medium text-ink hover:text-navy-950"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {c.back}
      </Link>
      <PageHeader
        icon={Landmark}
        area="go"
        eyebrow={c.kinds[p.kind] ?? ''}
        title={p.name}
        description={c.statementLead(p.shortName)}
        actions={
          can('finance.remittance.record') && p.toRemitPaise > 0 ? (
            <Button onClick={() => setPaying(true)} aria-haspopup="dialog">
              <Send aria-hidden className="size-4" />
              {c.payOn(p.shortName)}
            </Button>
          ) : undefined
        }
      >
        <YearSwitch years={s.data.years} value={shown} onChange={setYear} />
      </PageHeader>

      <KeyFigures
        variant="strip"
        label={c.figures}
        figures={[
          {
            label: c.held,
            value: shortRupees(p.toRemitPaise),
            note: c.heldNote,
            valueTone: 'navy',
          },
          { label: c.billed, value: shortRupees(p.billedPaise), note: c.heads(p.heads) },
          { label: c.collected, value: shortRupees(p.collectedPaise), note: c.collectedNote },
          { label: c.remitted, value: shortRupees(p.remittedPaise), note: c.remittedNote },
        ]}
      />

      <Section title={c.remittances} description={c.remittancesLead} flush>
        {remittances.length === 0 ? (
          <EmptyState icon={Send} area="go" title={c.noRemittances} compact />
        ) : (
          <div
            role="region"
            aria-label={c.remittances}
            tabIndex={0}
            className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:outline-none"
          >
            <table className="w-full text-body">
              <thead>
                <tr className="border-y border-line bg-paper text-left text-caption text-ink-muted">
                  <th scope="col" className="px-6 py-2 font-medium">
                    {c.paidOn}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {c.reference}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {c.remitYear}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {c.by}
                  </th>
                  <th scope="col" className="px-6 py-2 text-right font-medium">
                    {c.amount}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {remittances.map((r) => (
                  <tr key={r.id}>
                    <td className="px-6 py-2.5 whitespace-nowrap text-ink">{date(r.paidOn)}</td>
                    <td className="px-3 py-2.5 font-mono text-caption text-ink">
                      {r.reference}
                      {r.note && <span className="block font-sans text-ink-muted">{r.note}</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-ink-muted">{r.periodLabel ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{r.recordedBy}</td>
                    <td className="tabular px-6 py-2.5 text-right font-medium text-ink">
                      {rupees(r.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title={c.students}
        description={c.studentsLead}
        actions={
          students.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={exportList}>
              <Download aria-hidden className="size-4" />
              {c.download}
            </Button>
          ) : undefined
        }
        flush
      >
        {students.length === 0 ? (
          <EmptyState icon={Landmark} area="go" title={c.noStudents} compact />
        ) : (
          <div
            role="region"
            aria-label={c.students}
            tabIndex={0}
            className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:outline-none"
          >
            <table className="w-full text-body">
              <thead>
                <tr className="border-y border-line bg-paper text-left text-caption text-ink-muted">
                  <th scope="col" className="px-6 py-2 font-medium">
                    {c.student}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {c.placement}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {c.billed}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {c.collected}
                  </th>
                  <th scope="col" className="px-6 py-2 text-right font-medium">
                    {c.due}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {students.map((x) => {
                  const due = Math.max(0, x.billedPaise - x.collectedPaise);
                  return (
                    <tr key={x.studentId}>
                      <th scope="row" className="px-6 py-2.5 text-left font-medium">
                        <Link
                          href={`/fees/students/${x.studentId}`}
                          className="text-navy-950 hover:underline"
                        >
                          {x.name}
                        </Link>
                      </th>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {[x.placement, x.reference].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-ink">
                        {rupees(x.billedPaise)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-ink">
                        {rupees(x.collectedPaise)}
                      </td>
                      <td
                        className={`tabular px-6 py-2.5 text-right ${due > 0 ? 'font-medium text-signal-stop-ink' : 'text-ink-muted'}`}
                      >
                        {rupees(due)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {paying && (
        <RemitDialog
          payee={p}
          years={s.data.years}
          year={s.data.year}
          onClose={() => setPaying(false)}
          onDone={(m) => {
            setPaying(false);
            setMessage(m);
            void s.refetch();
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}
