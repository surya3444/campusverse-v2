'use client';

// The whole person on one screen (docs/specs/CONNECTED_SCHOOL.md): what transport, hostel,
// library, helpdesk, staff attendance, leave, appraisals, assets and payroll know about a student
// or a staff member. Each card comes from its own module under the viewer's own permission; a part
// they may not see is simply left out.
import type { ReviewRow } from '@campusverse/people-appraisals';
import type { AssetRow } from '@campusverse/shared-assets';
import type { TicketRow } from '@campusverse/shared-helpdesk';
import type { ChildHostel } from '@campusverse/shared-hostel';
import type { BorrowerLoans } from '@campusverse/shared-library';
import type { LeaveType, TypeBalance } from '@campusverse/shared-staff-attendance';
import { IconTile, Pill, cx, type Area } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  BedDouble,
  BookOpen,
  Bus,
  CalendarCheck,
  CalendarOff,
  LifeBuoy,
  Package,
  Star,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { formatDate } from '../setup/shared';

const c = en.connected;

type StudentServices = {
  transport: { direction: string; route: string; stop: string; stopAt: string }[] | null;
  hostel: ChildHostel | null;
  library: BorrowerLoans | null;
  requests: TicketRow[] | null;
};

export type Salary = {
  grossPaise: number;
  netPaise: number;
  lastSlip: { month: string; netPaise: number } | null;
} | null;

type StaffServices = {
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
  salary?: Salary | undefined;
};

function Card({
  icon,
  area,
  title,
  href,
  children,
}: {
  icon: LucideIcon;
  area: Area;
  title: string;
  href?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <IconTile icon={icon} area={area} size="sm" />
        <h3 className="flex-1 text-body font-semibold text-ink">{title}</h3>
        {href && (
          <Link href={href} className="text-caption font-medium text-navy-950 hover:underline">
            {c.open}
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-1 text-caption text-ink-muted">{children}</div>
    </section>
  );
}

const Line = ({ strong, children }: { strong?: boolean; children: ReactNode }) => (
  <p className={cx(strong && 'text-body font-medium text-ink')}>{children}</p>
);

function Grid({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold tracking-[0.16em] text-ink-muted uppercase">
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

const Loading = () => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-busy>
    {[1, 2, 3, 4].map((n) => (
      <div key={n} className="panel flex flex-col gap-3 p-4">
        <span className="skeleton h-8 w-8 rounded-md" />
        <span className="skeleton h-3 w-2/3" />
        <span className="skeleton h-3 w-1/2" />
      </div>
    ))}
  </div>
);

/** Transport, hostel, library and requests beside a student's record. */
export function StudentServicesPanel({
  studentId,
  institutionId,
}: {
  studentId: string;
  institutionId: string | null;
}) {
  const q = useQuery({
    queryKey: ['student-services', studentId, institutionId],
    queryFn: () =>
      api.get<StudentServices>(
        `/people/students/${studentId}/services?institutionId=${institutionId}`,
      ),
    enabled: !!institutionId,
  });
  if (!institutionId || q.isPending) return <Loading />;
  // The record still works without this panel; its own failure isn't the record's.
  if (q.isError) return null;
  const d = q.data;
  const open = d.requests?.filter((r) => r.state !== 'resolved') ?? [];
  const out = d.hostel?.outpasses.some((o) => o.state === 'out') ?? false;
  return (
    <Grid title={c.studentTitle}>
      {d.transport && (
        <Card icon={Bus} area="amber" title={c.transport} href="/transport">
          {d.transport.length === 0 ? (
            <Line>{c.noTransport}</Line>
          ) : (
            d.transport.map((b) => (
              <Line key={b.direction}>
                <span className="font-medium text-ink">{c.directions[b.direction]}</span>{' '}
                {c.busLine(b.route, b.stop, b.stopAt)}
              </Line>
            ))
          )}
        </Card>
      )}
      {d.hostel && (
        <Card icon={BedDouble} area="violet" title={c.hostel} href="/hostel">
          {d.hostel.stay ? (
            <>
              <Line strong>
                {c.bed(d.hostel.stay.hostel, d.hostel.stay.room, d.hostel.stay.bedNo)}
              </Line>
              <Line>{c.since(formatDate(d.hostel.stay.since))}</Line>
              {out && (
                <span>
                  <Pill tone="warn">{c.outNow}</Pill>
                </span>
              )}
            </>
          ) : (
            <Line>{c.noHostel}</Line>
          )}
        </Card>
      )}
      {d.library && (
        <Card icon={BookOpen} area="teal" title={c.library} href="/library">
          <Line strong>{c.loans(d.library.open.length)}</Line>
          {d.library.open.some((l) => l.daysLate > 0) && (
            <span>
              <Pill tone="stop">
                {c.lateBooks(d.library.open.filter((l) => l.daysLate > 0).length)}
              </Pill>
            </span>
          )}
          {d.library.owedPaise > 0 && <Line>{c.owed(rupees(d.library.owedPaise))}</Line>}
        </Card>
      )}
      {d.requests && (
        <Card icon={LifeBuoy} area="rose" title={c.requests} href="/helpdesk">
          {open.length === 0 ? (
            <Line>{c.noRequests}</Line>
          ) : (
            <>
              <Line strong>{c.openRequests(open.length)}</Line>
              {open.slice(0, 2).map((r) => (
                <Line key={r.ticketId}>
                  #{r.number} {r.subject}
                </Line>
              ))}
            </>
          )}
        </Card>
      )}
    </Grid>
  );
}

/** Attendance, leave, salary, appraisal, assets, requests and bus duty beside a staff record. */
export function StaffServicesPanel({
  personId,
  institutionId,
}: {
  personId: string;
  institutionId: string | null;
}) {
  const q = useQuery({
    queryKey: ['staff-services', personId, institutionId],
    queryFn: () =>
      api.get<StaffServices>(`/people/staff/${personId}/services?institutionId=${institutionId}`),
    enabled: !!institutionId,
  });
  if (!institutionId || q.isPending) return <Loading />;
  if (q.isError) return null;
  const d = q.data;
  const t = d.attendance?.totals;
  const open = d.requests?.filter((r) => r.state !== 'resolved') ?? [];
  const typeName = new Map(d.leave?.types.map((x) => [x.id, x.name]) ?? []);
  const review = d.appraisals?.[0];
  return (
    <Grid title={c.staffTitle}>
      {d.salary !== undefined && (
        <Card icon={Wallet} area="go" title={c.salary} href="/payroll">
          {d.salary ? (
            <>
              <Line strong>{c.gross(rupees(d.salary.grossPaise))}</Line>
              <Line>{c.net(rupees(d.salary.netPaise))}</Line>
              {d.salary.lastSlip && (
                <Line>
                  {c.lastSlip(d.salary.lastSlip.month, rupees(d.salary.lastSlip.netPaise))}
                </Line>
              )}
            </>
          ) : (
            <Line>{c.noSalary}</Line>
          )}
        </Card>
      )}
      {d.attendance !== null && (
        <Card icon={CalendarCheck} area="sky" title={c.attendance} href="/staff-attendance">
          {t && t.present + t.absent + t.half_day + t.on_leave > 0 ? (
            <Line strong>{c.days(t.present, t.absent, t.late)}</Line>
          ) : (
            <Line>{c.noDays}</Line>
          )}
        </Card>
      )}
      {d.leave && (
        <Card icon={CalendarOff} area="teal" title={c.leave} href="/staff-leave">
          {d.leave.balances
            .filter((b) => b.allowance !== null)
            .slice(0, 3)
            .map((b) => (
              <Line key={b.typeId}>
                {c.leaveLine(typeName.get(b.typeId) ?? '', String(b.left ?? '—'))}
              </Line>
            ))}
        </Card>
      )}
      {d.appraisals && (
        <Card icon={Star} area="violet" title={c.appraisal} href="/appraisals">
          {review ? (
            <>
              <Line strong>{review.cycle}</Line>
              <Line>{review.score ? c.score(review.score) : review.state}</Line>
            </>
          ) : (
            <Line>{c.noAppraisal}</Line>
          )}
        </Card>
      )}
      {d.transport && d.transport.length > 0 && (
        <Card icon={Bus} area="amber" title={c.duty} href="/transport">
          {d.transport.map((r) => (
            <Line key={r.routeId}>{c.dutyLine(r.name, r.as)}</Line>
          ))}
        </Card>
      )}
      {d.assets && (
        <Card icon={Package} area="navy" title={c.assets} href="/assets">
          {d.assets.length === 0 ? (
            <Line>{c.noAssets}</Line>
          ) : (
            d.assets.slice(0, 3).map((a) => (
              <Line key={a.itemId}>
                <span className="tabular font-medium text-ink">{a.tag}</span> {a.name}
              </Line>
            ))
          )}
        </Card>
      )}
      {d.requests && (
        <Card icon={LifeBuoy} area="rose" title={c.requests} href="/helpdesk">
          {open.length === 0 ? (
            <Line>{c.noRequests}</Line>
          ) : (
            <>
              <Line strong>{c.openRequests(open.length)}</Line>
              {open.slice(0, 2).map((r) => (
                <Line key={r.ticketId}>
                  #{r.number} {r.subject}
                </Line>
              ))}
            </>
          )}
        </Card>
      )}
    </Grid>
  );
}
