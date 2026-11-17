'use client';

// The student's 360 (docs/specs/CONNECTED_SCHOOL.md, decision 0022): stat cards under the hero
// and the Overview, Academics, Fees and Attendance tabs. Each part comes from its own module under
// the viewer's own permission; a part they may not see is left out (null), never an error.
import type { StudentRecord } from '@campusverse/people-records';
import type { StudentAttendance } from '@campusverse/school-attendance';
import type { StudentResult } from '@campusverse/school-exams';
import type { Account } from '@campusverse/shared-finance';
import type { TicketRow } from '@campusverse/shared-helpdesk';
import type { ChildHostel } from '@campusverse/shared-hostel';
import type { BorrowerLoans } from '@campusverse/shared-library';
import { EmptyState, Pill, cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BedDouble,
  BookOpen,
  Bus,
  CalendarCheck,
  CalendarClock,
  GraduationCap,
  IndianRupee,
  LifeBuoy,
  Phone,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { Meter, ProfilePanel, Ring, StatCard, StatRow } from '../../common/profile360';
import { formatDate } from '../../setup/shared';

const t = en.students.p360;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

type Services = {
  transport: { direction: string; route: string; stop: string; stopAt: string }[] | null;
  hostel: ChildHostel | null;
  library: BorrowerLoans | null;
  requests: TicketRow[] | null;
};

/** A part the viewer may not see comes back as null. */
const optional = <T,>(path: string) =>
  api.get<T>(path).catch((e: unknown) => {
    if (e instanceof ApiFailure && (e.status === 403 || e.status === 404)) return null;
    throw e;
  });

export function useStudent360(studentId: string, institutionId: string | null) {
  const attendance = useQuery({
    queryKey: ['student-attendance', studentId],
    queryFn: () => optional<StudentAttendance>(`/school/attendance/students/${studentId}`),
  });
  const fees = useQuery({
    queryKey: ['fee-account', studentId],
    queryFn: () => optional<Account>(`/finance/students/${studentId}`),
  });
  const results = useQuery({
    queryKey: ['student-results', studentId],
    queryFn: () => optional<StudentResult[]>(`/school/exams/students/${studentId}/results`),
  });
  const services = useQuery({
    queryKey: ['student-services', studentId, institutionId],
    queryFn: () =>
      optional<Services>(`/people/students/${studentId}/services?institutionId=${institutionId}`),
    enabled: !!institutionId,
  });
  return { attendance, fees, results, services };
}
export type Student360 = ReturnType<typeof useStudent360>;

const pctOf = (a: StudentAttendance | null | undefined) =>
  a && a.basisPoints !== null ? a.basisPoints / 100 : null;
const feeTotals = (f: Account | null | undefined) => {
  const live = f?.invoices.filter((i) => i.state !== 'written_off' && i.state !== 'adjusted') ?? [];
  const total = live.reduce((n, i) => n + i.totalPaise, 0);
  const paid = live.reduce((n, i) => n + Math.min(i.paidPaise, i.totalPaise), 0);
  return { total, paid, due: f?.balancePaise ?? total - paid };
};

/** The six stat cards under the hero. */
export function StudentStats({ d }: { d: Student360 }) {
  const s = t.stats;
  const att = d.attendance.data;
  const pct = pctOf(att);
  const latest = d.results.data?.[0];
  const fee = feeTotals(d.fees.data);
  const svc = d.services.data;
  const bus = svc?.transport?.[0];
  const stay = svc?.hostel?.stay;
  const loans = svc?.library?.open ?? [];
  const late = loans.filter((l) => l.daysLate > 0).length;
  return (
    <StatRow>
      <StatCard label={s.attendance} icon={CalendarCheck}>
        <div className="flex items-center gap-3">
          <Ring
            value={pct}
            tone={pct !== null && pct < 75 ? 'stop' : 'go'}
            label={pct === null ? s.notMarked : `${Math.round(pct)}%`}
          />
          <p className="text-caption leading-snug text-ink-muted">
            {att === undefined
              ? '…'
              : !att || pct === null
                ? s.notMarked
                : s.ofDays(att.workingDays)}
          </p>
        </div>
      </StatCard>
      <StatCard label={s.exams} icon={GraduationCap}>
        <p className="tabular font-display text-title font-bold text-ink">
          {latest?.percent ? `${Number(latest.percent).toFixed(1)}%` : '—'}
        </p>
        <p className="truncate text-caption text-ink-muted">
          {latest ? s.lastExam(latest.exam) : s.noResults}
        </p>
      </StatCard>
      <StatCard label={s.fees} icon={IndianRupee}>
        {d.fees.data === null ? (
          <p className="text-caption text-ink-muted">—</p>
        ) : (
          <>
            <p
              className={cx(
                'text-lead font-bold',
                fee.total === 0
                  ? 'text-ink-muted'
                  : fee.due > 0
                    ? 'text-signal-stop-ink'
                    : 'text-signal-go-ink',
              )}
            >
              {fee.total === 0
                ? s.nothingBilled
                : fee.due > 0
                  ? s.due(rupees(fee.due))
                  : s.fullyPaid}
            </p>
            <span className="mt-2 block">
              <Meter value={fee.total ? (fee.paid / fee.total) * 100 : 0} />
            </span>
            <p className="tabular mt-1 text-[11px] text-ink-muted">
              {s.paidOf(rupees(fee.paid), rupees(fee.total))}
            </p>
          </>
        )}
      </StatCard>
      <StatCard label={s.transport} icon={Bus}>
        <p className="truncate text-body font-semibold text-ink">{bus ? bus.route : s.noBus}</p>
        <p className="truncate text-caption text-ink-muted">
          {bus ? `${bus.stop} · ${bus.stopAt}` : s.notResident}
        </p>
      </StatCard>
      <StatCard label={s.hostel} icon={BedDouble}>
        <p className="truncate text-body font-semibold text-ink">
          {stay ? `${stay.hostel}` : s.notResident}
        </p>
        <p className="truncate text-caption text-ink-muted">
          {stay ? `Room ${stay.room} · bed ${stay.bedNo}` : '—'}
        </p>
      </StatCard>
      <StatCard label={s.library} icon={BookOpen}>
        <p className="text-body font-semibold text-ink">{s.booksOut(loans.length)}</p>
        {late > 0 ? (
          <p className="text-caption font-medium text-signal-stop-ink">{s.overdueBooks(late)}</p>
        ) : (
          <p className="text-caption text-ink-muted">
            {svc?.library?.owedPaise ? rupees(svc.library.owedPaise) : '—'}
          </p>
        )}
      </StatCard>
    </StatRow>
  );
}

function ExamList({ results }: { results: StudentResult[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {results.slice(0, 5).map((r) => {
        const p = r.percent ? Number(r.percent) : null;
        return (
          <li key={r.examId}>
            <div className="flex items-baseline justify-between gap-3 text-body">
              <span className="truncate text-ink">{r.exam}</span>
              <span className="tabular shrink-0">
                <span className="font-semibold text-ink">
                  {p === null ? '—' : `${p.toFixed(1)}%`}
                </span>
                {r.grade && <span className="text-ink-muted"> · {r.grade}</span>}
              </span>
            </div>
            <span className="mt-1.5 block">
              <Meter value={p ?? 0} tone={p !== null && p < 33 ? 'stop' : 'navy'} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Overview: academics, attendance and requests on the left; fees, family and journey on the right. */
export function StudentOverview({ record: r, d }: { record: StudentRecord; d: Student360 }) {
  const p = t.panels;
  const att = d.attendance.data;
  const pct = pctOf(att);
  const results = d.results.data;
  const fees = d.fees.data;
  const fee = feeTotals(fees);
  const requests = d.services.data?.requests;
  const open = requests?.filter((x) => x.state !== 'resolved') ?? [];
  const journey = [
    ...r.memberships.map((m) => ({ at: m.from, text: p.joined(m.institutionName) })),
    ...r.memberships
      .filter((m) => m.until && m.until < today())
      .map((m) => ({ at: m.until ?? '', text: p.left(m.institutionName) })),
    ...(r.timeline ?? [])
      .slice(0, 6)
      .map((e) => ({ at: e.at.slice(0, 10), text: en.students.event(e.action, e.detail) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {results !== null && (
          <ProfilePanel
            title={p.academics}
            icon={GraduationCap}
            description={r.placements[0]?.displayLabel}
          >
            {results && results.length > 0 ? (
              <ExamList results={results} />
            ) : (
              <p className="text-body text-ink-muted">{p.noExams}</p>
            )}
          </ProfilePanel>
        )}
        {att !== null && (
          <ProfilePanel title={p.attendance} icon={CalendarCheck}>
            {!att || pct === null ? (
              <p className="text-body text-ink-muted">{p.noAttendance}</p>
            ) : (
              <div className="flex flex-wrap items-start gap-6">
                <div className="flex items-center gap-3">
                  <Ring
                    value={pct}
                    size={72}
                    tone={pct < 75 ? 'stop' : 'go'}
                    label={`${Math.round(pct)}%`}
                  />
                  <div>
                    <p
                      className={cx(
                        'tabular font-display text-title font-bold',
                        pct < 75 ? 'text-signal-stop-ink' : 'text-signal-go-ink',
                      )}
                    >
                      {pct.toFixed(1)}%
                    </p>
                    <p className="text-caption text-ink-muted">{t.stats.ofDays(att.workingDays)}</p>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-caption font-medium text-ink-muted">{p.absences}</p>
                  {att.recentAbsences.length === 0 ? (
                    <p className="text-body text-ink-muted">{p.noAbsences}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {att.recentAbsences.slice(0, 12).map((day) => (
                        <span
                          key={day}
                          className="tabular rounded-md border border-signal-stop/20 bg-signal-stop/10 px-2 py-0.5 text-caption text-signal-stop-ink"
                        >
                          {formatDate(day)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </ProfilePanel>
        )}
        {requests && (
          <ProfilePanel title={p.requests} icon={LifeBuoy}>
            {open.length === 0 ? (
              <p className="text-body text-ink-muted">{en.connected.noRequests}</p>
            ) : (
              <ul className="divide-y divide-line">
                {open.slice(0, 5).map((x) => (
                  <li key={x.ticketId} className="flex items-center gap-3 py-2.5">
                    <span className="tabular text-caption text-ink-muted">#{x.number}</span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{x.subject}</span>
                    {x.overdue && <Pill tone="stop">{en.fees.invoiceStates.overdue}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </ProfilePanel>
        )}
      </div>
      <div className="flex flex-col gap-6">
        {fees !== null && (
          <ProfilePanel
            title={p.fees}
            icon={IndianRupee}
            action={
              <Link
                href={`/fees/students/${r.person.id}`}
                className="text-caption font-medium text-navy-950 hover:underline"
              >
                {t.fees.open}
              </Link>
            }
          >
            <div className="flex items-center gap-4">
              <Ring
                value={fee.total ? Math.round((fee.paid / fee.total) * 100) : null}
                size={64}
                tone={fee.due > 0 ? 'stop' : 'go'}
                label={p.paid}
              />
              <div>
                <p
                  className={cx(
                    'font-display text-title font-bold',
                    fee.total === 0
                      ? 'text-ink-muted'
                      : fee.due > 0
                        ? 'text-signal-stop-ink'
                        : 'text-signal-go-ink',
                  )}
                >
                  {fee.total === 0 ? t.stats.nothingBilled : fee.due > 0 ? rupees(fee.due) : p.paid}
                </p>
                <p className="text-caption text-ink-muted">
                  {fee.due > 0 ? p.outstanding(rupees(fee.due)) : p.nothingOutstanding} ·{' '}
                  {t.stats.paidOf(rupees(fee.paid), rupees(fee.total))}
                </p>
              </div>
            </div>
            <div>
              <p className="mb-2 text-caption font-medium text-ink-muted">{p.receipts}</p>
              {fees && fees.payments.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {fees.payments.slice(0, 4).map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 text-body">
                      <span className="text-ink">
                        <span className="tabular font-semibold">{rupees(x.amountPaise)}</span>
                        <span className="text-caption text-ink-muted">
                          {' '}
                          · {x.receiptNumber ?? x.method}
                        </span>
                      </span>
                      <span className="tabular text-caption text-ink-muted">
                        {formatDate(x.at.slice(0, 10))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-body text-ink-muted">{p.noReceipts}</p>
              )}
            </div>
          </ProfilePanel>
        )}
        {r.guardians && (
          <ProfilePanel title={p.family} icon={Users}>
            {r.guardians.length === 0 ? (
              <p className="text-body text-ink-muted">{p.noFamily}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {r.guardians.map((g) => (
                  <li key={g.linkId} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-caption font-semibold text-ink"
                    >
                      {g.name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((x) => x[0])
                        .join('')
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium text-ink">
                        {g.name}
                        {g.primary && (
                          <span className="ml-1.5 text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
                            {p.primary}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-caption text-ink-muted capitalize">
                        {g.relationship}
                      </p>
                    </div>
                    {g.phone && (
                      <a
                        href={`tel:${g.phone}`}
                        aria-label={`${g.name}: ${g.phone}`}
                        className="rounded-lg p-2 text-ink-muted hover:bg-navy-50 hover:text-ink"
                      >
                        <Phone aria-hidden className="size-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ProfilePanel>
        )}
        <ProfilePanel title={p.journey} icon={CalendarClock} description={p.journeyLead}>
          <ol className="flex flex-col gap-3">
            {journey.slice(0, 8).map((j, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-950 text-white"
                >
                  <GraduationCap className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{j.text}</p>
                  <p className="tabular text-caption text-ink-muted">{formatDate(j.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </ProfilePanel>
      </div>
    </div>
  );
}

/** Fee history: every invoice and payment. */
export function StudentFees({ studentId, d }: { studentId: string; d: Student360 }) {
  const f = t.fees;
  const fees = d.fees.data;
  if (fees === undefined) return null;
  if (fees === null)
    return <EmptyState compact icon={IndianRupee} title={en.states.denied.title} />;
  return (
    <div className="flex flex-col gap-6">
      <ProfilePanel
        title={f.invoices}
        icon={IndianRupee}
        action={
          <Link
            href={`/fees/students/${studentId}`}
            className="text-caption font-medium text-navy-950 hover:underline"
          >
            {f.open}
          </Link>
        }
      >
        {fees.invoices.length === 0 ? (
          <p className="text-body text-ink-muted">{f.none}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">{f.columns.item}</th>
                  <th className="px-5 py-3 text-left">{f.columns.due}</th>
                  <th className="px-5 py-3 text-right">{f.columns.total}</th>
                  <th className="px-5 py-3 text-right">{f.columns.paid}</th>
                  <th className="px-5 py-3 text-right">{f.columns.state}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {fees.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="px-5 py-3 text-ink">
                      {i.label}
                      <span className="block text-caption text-ink-muted">
                        {i.lines
                          .filter((l) => l.head)
                          .map((l) => l.head)
                          .join(', ')}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3 text-ink-muted">{formatDate(i.dueOn)}</td>
                    <td className="tabular px-5 py-3 text-right text-ink">
                      {rupees(i.totalPaise)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-ink">{rupees(i.paidPaise)}</td>
                    <td className="px-5 py-3 text-right">
                      <Pill
                        tone={
                          i.paidPaise >= i.totalPaise ? 'go' : i.dueOn < today() ? 'stop' : 'warn'
                        }
                      >
                        {en.fees.invoiceStates[i.state] ?? i.state.replaceAll('_', ' ')}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ProfilePanel>
      <ProfilePanel title={f.payments} icon={IndianRupee}>
        {fees.payments.length === 0 ? (
          <p className="text-body text-ink-muted">{t.panels.noReceipts}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">{f.payColumns.at}</th>
                  <th className="px-5 py-3 text-left">{f.payColumns.method}</th>
                  <th className="px-5 py-3 text-left">{f.payColumns.receipt}</th>
                  <th className="px-5 py-3 text-right">{f.payColumns.amount}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {fees.payments.map((x) => (
                  <tr key={x.id}>
                    <td className="tabular px-5 py-3 text-ink">{formatDate(x.at.slice(0, 10))}</td>
                    <td className="px-5 py-3 text-ink-muted capitalize">
                      {x.method.replaceAll('_', ' ')}
                    </td>
                    <td className="tabular px-5 py-3 text-ink">
                      {x.receiptId ? (
                        <Link
                          href={`/fees/receipts/${x.receiptId}`}
                          className="text-navy-950 hover:underline"
                        >
                          {x.receiptNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-medium text-ink">
                      {rupees(x.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ProfilePanel>
    </div>
  );
}

/** Academics: results and where the student has been enrolled. */
export function StudentAcademics({ record: r, d }: { record: StudentRecord; d: Student360 }) {
  const a = t.academics;
  const results = d.results.data;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ProfilePanel title={a.results} icon={GraduationCap}>
        {!results || results.length === 0 ? (
          <p className="text-body text-ink-muted">{t.panels.noExams}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">{a.columns.exam}</th>
                  <th className="px-5 py-3 text-left">{a.columns.published}</th>
                  <th className="px-5 py-3 text-right">{a.columns.percent}</th>
                  <th className="px-5 py-3 text-right">{a.columns.grade}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {results.map((x) => (
                  <tr key={x.examId}>
                    <td className="px-5 py-3 text-ink">
                      {x.exam}
                      <span className="block text-caption text-ink-muted">
                        {x.subjects
                          .slice(0, 6)
                          .map((s) => `${s.subject} ${s.shown}`)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3 text-ink-muted">
                      {formatDate(x.publishedAt.slice(0, 10))}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-medium text-ink">
                      {x.percent ? `${Number(x.percent).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-ink">{x.grade ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ProfilePanel>
      <ProfilePanel title={a.placements} icon={CalendarClock}>
        <ol className="flex flex-col gap-3">
          {r.memberships.map((m, i) => (
            <li key={i} className="flex flex-col">
              <span className="text-body font-medium text-ink">{m.institutionName}</span>
              <span className="tabular text-caption text-ink-muted">
                {formatDate(m.from)} – {m.until ? formatDate(m.until) : a.current}
              </span>
            </li>
          ))}
          {r.placements.map((pl) => (
            <li key={pl.institutionId + pl.displayLabel} className="flex flex-col">
              <span className="text-body font-medium text-ink">{pl.displayLabel}</span>
              <span className="text-caption text-ink-muted">
                {pl.reference ? en.students.admissionShort(pl.reference) : ''}
              </span>
            </li>
          ))}
        </ol>
      </ProfilePanel>
    </div>
  );
}
