'use client';

// The staff member's 360 (docs/specs/CONNECTED_SCHOOL.md, decision 0022): stat cards under the
// hero and the Overview and Salary tabs. Each part comes from its own module under the viewer's
// own permission (GET /people/staff/:id/services); a part they may not see is left out.
import type { ReviewRow } from '@campusverse/people-appraisals';
import type { SalaryRow } from '@campusverse/people-payroll';
import type { AssetRow } from '@campusverse/shared-assets';
import type { TicketRow } from '@campusverse/shared-helpdesk';
import type { LeaveType, TypeBalance } from '@campusverse/shared-staff-attendance';
import { Pill } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Bus, CalendarCheck, CalendarOff, LifeBuoy, Package, Star, Wallet } from 'lucide-react';
import Link from 'next/link';
import { ApiFailure, api } from '../../../../lib/api';
import { rupees } from '../../../../lib/money';
import { en } from '../../../../messages/en';
import { Meter, ProfilePanel, Ring, StatCard, StatRow } from '../../common/profile360';
import { formatDate } from '../../setup/shared';

const t = en.staffRecord.p360;
const c = en.connected;

export type StaffServices = {
  month: string;
  attendance: {
    totals: { present: number; absent: number; late: number; half_day: number; on_leave: number };
  } | null;
  leave: { year: number; types: LeaveType[]; balances: TypeBalance[] } | null;
  appraisals: ReviewRow[] | null;
  assets: AssetRow[] | null;
  requests: TicketRow[] | null;
  transport:
    | { routeId: string; name: string; direction: string; as: string; vehicle: string | null }[]
    | null;
  salary?: {
    grossPaise: number;
    netPaise: number;
    lastSlip: { month: string; netPaise: number } | null;
  } | null;
};

export function useStaff360(personId: string, institutionId: string | null) {
  return useQuery({
    queryKey: ['staff-services', personId, institutionId],
    queryFn: () =>
      api.get<StaffServices>(`/people/staff/${personId}/services?institutionId=${institutionId}`),
    enabled: !!institutionId,
  });
}

const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

/** The six stat cards under the hero. */
export function StaffStats({ d }: { d: StaffServices | undefined }) {
  const s = t.stats;
  const a = d?.attendance?.totals;
  const days = a ? a.present + a.absent + a.half_day + a.on_leave : 0;
  const types = new Map(d?.leave?.types.map((x) => [x.id, x]) ?? []);
  const leave = d?.leave?.balances.filter((b) => b.allowance !== null) ?? [];
  const review = d?.appraisals?.[0];
  const open = d?.requests?.filter((r) => r.state !== 'resolved') ?? [];
  return (
    <StatRow>
      <StatCard label={s.salary} icon={Wallet}>
        {d?.salary === undefined ? (
          <p className="text-caption text-ink-muted">—</p>
        ) : d.salary ? (
          <>
            <p className="tabular font-display text-lead font-bold text-ink">
              {rupees(d.salary.grossPaise)}
            </p>
            <p className="tabular text-caption text-ink-muted">
              {s.net(rupees(d.salary.netPaise))}
            </p>
          </>
        ) : (
          <p className="text-body font-semibold text-signal-warn-ink">{s.noSalary}</p>
        )}
      </StatCard>
      <StatCard label={s.month} icon={CalendarCheck}>
        {a && days > 0 ? (
          <div className="flex items-center gap-3">
            <Ring
              value={Math.round(((a.present + a.half_day / 2) / days) * 100)}
              tone={a.absent > 2 ? 'stop' : 'go'}
              label={s.present(a.present)}
            />
            <p className="text-caption leading-snug text-ink-muted">
              {s.present(a.present)}
              <br />
              {s.absentLate(a.absent, a.late)}
            </p>
          </div>
        ) : (
          <p className="text-caption text-ink-muted">{d?.attendance === null ? '—' : s.nothing}</p>
        )}
      </StatCard>
      <StatCard label={s.leave} icon={CalendarOff}>
        {leave.length === 0 ? (
          <p className="text-caption text-ink-muted">—</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {leave.slice(0, 3).map((b) => (
              <li key={b.typeId} className="flex justify-between gap-2 text-caption">
                <span className="truncate text-ink-muted">{types.get(b.typeId)?.code ?? ''}</span>
                <span className="tabular font-semibold text-ink">{b.left ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </StatCard>
      <StatCard label={s.appraisal} icon={Star}>
        <p className="tabular font-display text-lead font-bold text-ink">
          {review?.score ? `${review.score} / 5` : '—'}
        </p>
        <p className="truncate text-caption text-ink-muted">
          {review ? review.cycle : s.noAppraisal}
        </p>
      </StatCard>
      <StatCard label={s.assets} icon={Package}>
        <p className="text-body font-semibold text-ink">
          {d?.assets ? s.assetsCount(d.assets.length) : '—'}
        </p>
        <p className="truncate text-caption text-ink-muted">
          {d?.assets?.[0] ? `${d.assets[0].tag} ${d.assets[0].name}` : ''}
        </p>
      </StatCard>
      <StatCard label={s.requests} icon={LifeBuoy}>
        <p className="text-body font-semibold text-ink">
          {d?.requests ? (open.length ? s.open(open.length) : s.none) : '—'}
        </p>
        <p className="truncate text-caption text-ink-muted">{open[0]?.subject ?? ''}</p>
      </StatCard>
    </StatRow>
  );
}

/** Overview: salary, this month, leave and appraisals on the left; duty, assets, requests right. */
export function StaffOverview({ d }: { d: StaffServices | undefined }) {
  const p = t.panels;
  if (!d) return null;
  const a = d.attendance?.totals;
  const types = new Map(d.leave?.types.map((x) => [x.id, x]) ?? []);
  const open = d.requests?.filter((r) => r.state !== 'resolved') ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {d.salary !== undefined && (
          <ProfilePanel
            title={p.salary}
            icon={Wallet}
            description={p.salaryLead}
            action={
              <Link
                href="/payroll"
                className="text-caption font-medium text-navy-950 hover:underline"
              >
                {en.payroll.title}
              </Link>
            }
          >
            {d.salary ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-navy-950/[0.05] p-4">
                  <p className="text-caption font-medium tracking-wider text-ink-muted uppercase">
                    {en.payroll.gross}
                  </p>
                  <p className="tabular mt-1 font-display text-title font-bold text-ink">
                    {rupees(d.salary.grossPaise)}
                  </p>
                </div>
                <div className="rounded-xl bg-navy-950/[0.05] p-4">
                  <p className="text-caption font-medium tracking-wider text-ink-muted uppercase">
                    {en.payroll.net}
                  </p>
                  <p className="tabular mt-1 font-display text-title font-bold text-ink">
                    {rupees(d.salary.netPaise)}
                  </p>
                </div>
                <div className="rounded-xl bg-navy-950/[0.05] p-4">
                  <p className="text-caption font-medium tracking-wider text-ink-muted uppercase">
                    {en.payroll.tabs.mine}
                  </p>
                  <p className="tabular mt-1 text-body font-semibold text-ink">
                    {d.salary.lastSlip
                      ? `${monthName(d.salary.lastSlip.month)} · ${rupees(d.salary.lastSlip.netPaise)}`
                      : '—'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-body text-ink-muted">{c.noSalary}</p>
            )}
          </ProfilePanel>
        )}
        {d.attendance !== null && (
          <ProfilePanel title={`${p.attendance} · ${monthName(d.month)}`} icon={CalendarCheck}>
            {a && a.present + a.absent + a.half_day + a.on_leave > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ['present', a.present],
                    ['half_day', a.half_day],
                    ['on_leave', a.on_leave],
                    ['absent', a.absent],
                    ['late', a.late],
                  ] as const
                ).map(([k, n]) => (
                  <div key={k} className="rounded-lg bg-navy-50/60 p-3 text-center">
                    <p className="text-[11px] text-ink-muted">
                      {k === 'late'
                        ? en.staffAttendance.late
                        : (en.staffAttendance.statuses[k] ?? k)}
                    </p>
                    <p className="tabular text-lead font-semibold text-ink">{n}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-body text-ink-muted">{c.noDays}</p>
            )}
          </ProfilePanel>
        )}
        {d.leave && (
          <ProfilePanel title={p.leave} icon={CalendarOff}>
            <ul className="flex flex-col gap-3">
              {d.leave.balances
                .filter((b) => b.allowance !== null)
                .map((b) => {
                  const total = (b.allowance ?? 0) + b.carried + b.adjusted;
                  return (
                    <li key={b.typeId}>
                      <div className="flex items-baseline justify-between gap-3 text-body">
                        <span className="text-ink">{types.get(b.typeId)?.name ?? ''}</span>
                        <span className="tabular text-ink-muted">
                          <span className="font-semibold text-ink">{b.left ?? '—'}</span> / {total}
                        </span>
                      </div>
                      <span className="mt-1.5 block">
                        <Meter value={total ? ((b.left ?? 0) / total) * 100 : 0} tone="navy" />
                      </span>
                    </li>
                  );
                })}
            </ul>
          </ProfilePanel>
        )}
        {d.appraisals && (
          <ProfilePanel title={p.appraisals} icon={Star}>
            {d.appraisals.length === 0 ? (
              <p className="text-body text-ink-muted">{c.noAppraisal}</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.appraisals.map((r) => (
                  <li key={r.reviewId} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{r.cycle}</span>
                    <Pill tone={r.state === 'acknowledged' || r.state === 'done' ? 'go' : 'warn'}>
                      {en.appraisals.state[r.state] ?? r.state}
                    </Pill>
                    <span className="tabular w-16 text-right text-body font-semibold text-ink">
                      {r.score ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ProfilePanel>
        )}
      </div>
      <div className="flex flex-col gap-6">
        {d.transport && d.transport.length > 0 && (
          <ProfilePanel title={p.duty} icon={Bus}>
            <ul className="flex flex-col gap-2">
              {d.transport.map((r) => (
                <li key={r.routeId} className="flex items-center justify-between gap-3 text-body">
                  <span className="text-ink">{r.name}</span>
                  <span className="text-caption text-ink-muted">
                    {c.dutyLine('', r.as).replace(' · ', '')}
                    {r.vehicle ? ` · ${r.vehicle}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </ProfilePanel>
        )}
        {d.assets && (
          <ProfilePanel title={p.assets} icon={Package}>
            {d.assets.length === 0 ? (
              <p className="text-body text-ink-muted">{c.noAssets}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.assets.map((x) => (
                  <li key={x.itemId} className="flex items-center gap-3 text-body">
                    <span className="tabular rounded-md bg-navy-50 px-2 py-0.5 text-caption font-medium text-ink">
                      {x.tag}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">{x.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </ProfilePanel>
        )}
        {d.requests && (
          <ProfilePanel title={p.requests} icon={LifeBuoy}>
            {open.length === 0 ? (
              <p className="text-body text-ink-muted">{c.noRequests}</p>
            ) : (
              <ul className="divide-y divide-line">
                {open.slice(0, 5).map((x) => (
                  <li key={x.ticketId} className="flex items-center gap-3 py-2.5">
                    <span className="tabular text-caption text-ink-muted">#{x.number}</span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{x.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </ProfilePanel>
        )}
      </div>
    </div>
  );
}

/** Salary and payslips: the salary history (people who manage salaries). */
export function StaffSalary({
  personId,
  institutionId,
}: {
  personId: string;
  institutionId: string | null;
}) {
  const p = t.panels;
  const q = useQuery({
    queryKey: ['payroll-salary-history', personId],
    queryFn: () =>
      api
        .get<SalaryRow[]>(`/payroll/salaries/${personId}?institutionId=${institutionId}`)
        .catch((e: unknown) => {
          if (e instanceof ApiFailure && e.status === 403) return null;
          throw e;
        }),
    enabled: !!institutionId,
  });
  if (q.data === null) return <p className="text-body text-ink-muted">{en.states.denied.title}</p>;
  const rows = q.data ?? [];
  const gross = (r: SalaryRow) => r.basic + r.da + r.hra + r.conveyance + r.special + r.other;
  return (
    <ProfilePanel
      title={p.history}
      icon={Wallet}
      action={
        <Link href="/payroll" className="text-caption font-medium text-navy-950 hover:underline">
          {en.payroll.setSalary}
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-body text-ink-muted">{p.noHistory}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left">{en.payroll.from}</th>
                {(['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const).map((k) => (
                  <th key={k} className="px-5 py-3 text-right">
                    {en.payroll.earnings[k]}
                  </th>
                ))}
                <th className="px-5 py-3 text-right">{en.payroll.gross}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="tabular px-5 py-3 text-ink">{formatDate(r.effectiveFrom)}</td>
                  {(['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const).map((k) => (
                    <td key={k} className="tabular px-5 py-3 text-right text-ink-muted">
                      {r[k] ? rupees(r[k]) : '—'}
                    </td>
                  ))}
                  <td className="tabular px-5 py-3 text-right font-semibold text-ink">
                    {rupees(gross(r))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ProfilePanel>
  );
}
