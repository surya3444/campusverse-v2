'use client';

import type { CertificateSummary } from '@campusverse/school-certificates';
import type { AttendanceDay } from '@campusverse/school-attendance';
import type { Approval, DayCloseView, Dues, FinanceSummary } from '@campusverse/shared-finance';
import type { StudentListItem } from '@campusverse/people-records';
import type { Pipeline } from '@campusverse/school-admissions';
import type { TrendDay } from '@campusverse/school-attendance';
import type { CoverDay, DayPlan } from '@campusverse/school-timetable';
import type { TodayTrip, TransportSetup } from '@campusverse/shared-transport';
import {
  DayLine,
  KeyFigures,
  PageHeader,
  StatePanel,
  useNowInIndia,
  type AttentionItem,
  type DayLineBlock,
  type DayLineMarker,
  type KeyFigure,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarCheck,
  CalendarClock,
  GraduationCap,
  IndianRupee,
  Megaphone,
  Bell,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiFailure, api } from '../../lib/api';
import { en } from '../../messages/en';
import { useInstitution } from './attendance/shared';
import { CheckInCard } from './common/check-in';
import { yearLabels } from './admissions/pipeline-view';
import {
  AttentionRibbon,
  DashPanel,
  Donut,
  QuickPills,
  SetupChecklist,
  Stage,
  StageArrow,
  WeeklyBars,
} from './dashboard-kit';

const h = en.home;
const dateInIndia = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const hhmm = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat('en-IN');
const d = en.home.dash;
/** Rupees as the reference shows them on the dashboard: ₹12.4L, ₹1.2Cr, ₹8,450. */
export function shortRupees(paise: number): string {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(1)}Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)}L`;
  return inr.format(Math.round(r));
}
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' });
type Readiness = { ready: boolean; checks: { key: string; ok: boolean; blocking: boolean }[] };

/** Each part of today comes from its own module; a part this person may not see is left out. */
function usePart<T>(key: string, path: string | null) {
  return useQuery({
    queryKey: ['today', key, path],
    queryFn: () => api.get<T>(path ?? ''),
    enabled: !!path,
    retry: (n, e) => !(e instanceof ApiFailure && e.status === 403) && n < 1,
  });
}

/** The signed-in home: today's real figures, the day so far, and what needs attention. */
export function Today() {
  const router = useRouter();
  const now = useNowInIndia();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ name: string; personId: string }>('/people/me'),
  });
  const school = useInstitution();
  const id = school.institutionId;
  const att = usePart<AttendanceDay>('attendance', id ? `/school/attendance/${id}/day` : null);
  const ready = usePart<Readiness>('readiness', id ? `/school/setup/${id}/readiness` : null);
  const cash = usePart<DayCloseView>('cash', id ? `/finance/${id}/day` : null);
  const dues = usePart<Dues>('dues', id ? `/finance/${id}/dues` : null);
  const approvals = usePart<Approval[]>('approvals', id ? `/finance/${id}/approvals` : null);
  const lessons = usePart<DayPlan>(
    'lessons',
    id ? `/school/timetable/day?institutionId=${id}` : null,
  );
  const cover = usePart<CoverDay>(
    'cover',
    id ? `/school/timetable/cover?institutionId=${id}` : null,
  );
  const buses = usePart<TodayTrip[]>('buses', id ? `/transport/trips?institutionId=${id}` : null);
  const fleet = usePart<TransportSetup>(
    'fleet',
    id ? `/transport/setup?institutionId=${id}` : null,
  );
  const trend = usePart<TrendDay[]>('trend', id ? `/school/attendance/${id}/trend` : null);
  const summary = usePart<FinanceSummary>('summary', id ? `/finance/${id}/summary` : null);
  const roll = usePart<StudentListItem[]>(
    'roll',
    id ? `/people/students?institutionId=${id}` : null,
  );
  const pipe = usePart<Pipeline>(
    'pipeline',
    id ? `/school/admissions/${id}?year=${yearLabels()[0] ?? ''}` : null,
  );
  const certs = usePart<CertificateSummary[]>(
    'certificates',
    id ? `/school/certificates/institution/${id}` : null,
  );

  if (school.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (school.isError || !id)
    return <StatePanel kind="error" title={h.errorTitle} body={h.errorBody} />;

  const a = att.data;
  const sections = a?.sections ?? [];
  const marked = sections.filter((s) => s.state === 'submitted' || s.state === 'signed_off');
  const unmarked = a?.holiday ? [] : sections.filter((s) => s.state === 'not_taken');
  const enrolled = sections.reduce((n, s) => n + s.students, 0);
  const present = marked.reduce((n, s) => n + s.students - s.absent, 0);
  const collected = cash.data
    ? cash.data.cash.paise + cash.data.cheques.paise + cash.data.digital.paise
    : null;
  const receipts = cash.data
    ? cash.data.cash.count + cash.data.cheques.count + cash.data.digital.count
    : 0;
  const overdue = dues.data
    ? Object.values(dues.data.buckets).reduce(
        (x, b) => ({ paise: x.paise + b.paise, students: x.students + b.students }),
        {
          paise: 0,
          students: 0,
        },
      )
    : null;

  const sum = summary.data;
  const students = roll.data?.filter((x) => x.status === 'active').length;
  const attendancePct =
    marked.length > 0 && enrolled > 0
      ? Math.round((present / marked.reduce((n, x) => n + x.students, 0)) * 100)
      : 0;
  const figures: KeyFigure[] = [
    ...(roll.data
      ? [
          {
            label: d.stats.students,
            value: num.format(students ?? 0),
            note: d.stats.studentsNote,
            icon: GraduationCap,
          },
        ]
      : []),
    ...(sum
      ? [
          {
            label: d.stats.collected,
            value: shortRupees(sum.collectedPaise),
            note: d.stats.collectedNote(
              sum.billedPaise ? Math.round((sum.collectedPaise / sum.billedPaise) * 100) : 0,
            ),
            icon: Wallet,
          },
        ]
      : collected !== null
        ? [
            {
              label: h.collected,
              value: inr.format(collected / 100),
              note: h.collectedToday(receipts),
              icon: Wallet,
            },
          ]
        : []),
    ...(a
      ? [
          {
            label: d.stats.attendance,
            value: `${attendancePct}%`,
            note:
              unmarked.length > 0
                ? d.stats.needsAttention
                : d.stats.attendanceNote(marked.length, sections.length),
            tone: unmarked.length > 0 ? ('stop' as const) : ('neutral' as const),
            icon: UserCheck,
          },
        ]
      : []),
    ...(sum
      ? [
          {
            label: d.stats.outstanding,
            value: shortRupees(sum.outstandingPaise),
            note: (
              <Link
                href="/fees"
                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
              >
                <Bell aria-hidden className="size-3" />
                {d.stats.sendReminders} →
              </Link>
            ),
            ...(sum.outstandingPaise > 0 ? { valueTone: 'stop' as const } : {}),
            icon: AlertCircle,
          },
        ]
      : overdue
        ? [
            {
              label: h.overdue,
              value: inr.format(overdue.paise / 100),
              note: h.overdueNote(overdue.students),
              icon: AlertCircle,
            },
          ]
        : []),
  ];

  const inProgress = (certs.data ?? []).filter((c) =>
    ['requested', 'clearance_pending', 'ready_for_review', 'approved'].includes(c.state),
  );
  // Buses: an SOS or a child found comes first; then a bus still open past its last stop.
  const trips = buses.data ?? [];
  const late = (b: TodayTrip) =>
    !!b.trip && !b.trip.endedAt && !!b.lastAt && now > plusMinutes(b.lastAt, 30);
  const papersDue = (fleet.data?.vehicles ?? [])
    .filter((v) => v.active)
    .reduce(
      (n, v) =>
        n +
        Object.values(v.documents).filter((d) => d && d.status !== 'valid').length +
        v.blocked.filter((k) => !v.documents[k]).length,
      0,
    );
  const openTransport = { label: h.openTransport, onSelect: () => router.push('/transport') };
  const attention: AttentionItem[] = [
    ...trips
      .filter((b) => b.trip?.sos && !b.trip.endedAt)
      .map((b) => ({
        id: `sos-${b.routeId}`,
        tone: 'stop' as const,
        title: h.sosTitle(b.name, b.trip?.sos?.at ?? ''),
        ...(b.trip?.sos?.note ? { detail: b.trip.sos.note } : {}),
        action: openTransport,
      })),
    ...trips
      .filter((b) => b.trip?.checkOutcome === 'child_found')
      .map((b) => ({
        id: `found-${b.routeId}`,
        tone: 'stop' as const,
        title: h.childFoundTitle(b.name),
        action: openTransport,
      })),
    ...trips.filter(late).map((b) => ({
      id: `late-${b.routeId}`,
      tone: 'stop' as const,
      title: h.notClearedTitle(b.name),
      action: openTransport,
    })),
    ...((cover.data?.open ?? 0) > 0
      ? [
          {
            id: 'cover',
            tone: 'stop' as const,
            title: h.coverTitle(cover.data?.open ?? 0),
            action: { label: h.openCover, onSelect: () => router.push('/timetable?tab=cover') },
          },
        ]
      : []),
    ...(papersDue > 0
      ? [
          {
            id: 'papers',
            tone: 'warn' as const,
            title: h.papersTitle(papersDue),
            action: openTransport,
          },
        ]
      : []),
    ...(unmarked.length > 0
      ? [
          {
            id: 'unmarked',
            tone: 'warn' as const,
            title: h.unmarkedTitle(unmarked.length),
            detail: unmarked.map((s) => s.label).join(', '),
            action: { label: h.openAttendance, onSelect: () => router.push('/attendance') },
          },
        ]
      : []),
    ...(a && a.pendingLeave > 0
      ? [
          {
            id: 'leave',
            tone: 'neutral' as const,
            title: h.leaveTitle(a.pendingLeave),
            action: { label: h.openAttendance, onSelect: () => router.push('/attendance') },
          },
        ]
      : []),
    ...(a && a.openConflicts > 0
      ? [
          {
            id: 'conflicts',
            tone: 'warn' as const,
            title: h.conflictsTitle(a.openConflicts),
            action: { label: h.openAttendance, onSelect: () => router.push('/attendance') },
          },
        ]
      : []),
    ...((approvals.data?.length ?? 0) > 0
      ? [
          {
            id: 'approvals',
            tone: 'neutral' as const,
            title: h.approvalsTitle(approvals.data?.length ?? 0),
            action: { label: h.openFees, onSelect: () => router.push('/fees') },
          },
        ]
      : []),
    ...(inProgress.length > 0
      ? [
          {
            id: 'certificates',
            tone: 'neutral' as const,
            title: h.certificatesTitle(inProgress.length),
            action: { label: h.openCertificates, onSelect: () => router.push('/certificates') },
          },
        ]
      : []),
  ];

  // The day so far: when each register was marked.
  const markers: DayLineMarker[] = [
    ...marked
      .filter((s) => s.submittedAt)
      .map((s) => ({
        id: `marked-${s.sectionId}`,
        at: hhmm.format(new Date(s.submittedAt ?? '')),
        label: h.markedAt(s.label),
        tone: 'go' as const,
      })),
    ...(a?.holiday
      ? [{ id: 'holiday', at: '09:00', label: h.holiday(a.holiday), tone: 'neutral' as const }]
      : []),
  ];
  // Each bus as a block on the Transport lane: planned, running (to now) or done.
  const lineBlocks: DayLineBlock[] = trips
    .filter((b) => b.trip || b.firstAt)
    .map((b) => {
      const start = b.trip?.startedHm ?? b.firstAt ?? '00:00';
      const end =
        b.trip?.endedHm ??
        (b.trip ? (now > (b.lastAt ?? now) ? now : (b.lastAt ?? now)) : (b.lastAt ?? start));
      return {
        id: `bus-${b.routeId}`,
        lane: 'transport',
        label: b.name,
        start,
        end: end > start ? end : plusMinutes(start, 5),
        tone:
          b.trip?.checkOutcome === 'child_found' || (b.trip?.sos && !b.trip.endedAt) || late(b)
            ? ('stop' as const)
            : b.trip?.endedAt
              ? ('go' as const)
              : b.trip
                ? ('warn' as const)
                : ('neutral' as const),
      };
    });
  // The day's periods on the Classes lane; the viewer's own lessons by section and subject.
  // Mine: my own lessons, unless someone covers them; and lessons I cover.
  const mine = (n: number) =>
    lessons.data?.lessons.find(
      (l) =>
        l.period === n &&
        (l.cover
          ? l.cover.personId === me.data?.personId
          : l.teacherPersonId === me.data?.personId),
    );
  const periodBlocks: DayLineBlock[] = (lessons.data?.periods ?? []).map((p) => {
    const l = mine(p.number);
    return {
      id: `period-${p.number}`,
      lane: 'classes',
      label:
        p.kind === 'break'
          ? (p.label ?? en.timetablePage.breakRow)
          : l
            ? l.cover
              ? h.coverLabel(l.section, l.subject)
              : `${l.section} · ${l.subject}`
            : en.timetablePage.period(p.ordinal ?? p.number),
      start: p.startsAt,
      end: p.endsAt,
      tone: l ? ('go' as const) : ('neutral' as const),
    };
  });
  lineBlocks.push(...periodBlocks);
  // Exam papers that day (with a time on the date sheet); the invigilator sees theirs as such.
  const examBlocks: DayLineBlock[] = (lessons.data?.exams ?? []).flatMap((x, i) =>
    x.startsAt && x.endsAt
      ? [
          {
            id: `exam-${i}`,
            lane: 'exams',
            label:
              x.invigilatorPersonId === me.data?.personId
                ? h.invigilationLabel(x.className, x.subject)
                : h.examLabel(x.className, x.subject),
            start: x.startsAt,
            end: x.endsAt,
            tone:
              x.invigilatorPersonId === me.data?.personId ? ('go' as const) : ('neutral' as const),
          },
        ]
      : [],
  );
  lineBlocks.push(...examBlocks);
  const lanes = [
    ...(periodBlocks.length > 0 ? [{ id: 'classes', label: en.dayLine.lanes.classes }] : []),
    ...(examBlocks.length > 0 ? [{ id: 'exams', label: en.dayLine.lanes.exams }] : []),
    ...(lineBlocks.some((b) => b.lane === 'transport')
      ? [{ id: 'transport', label: en.dayLine.lanes.transport }]
      : []),
    { id: 'attendance', label: en.dayLine.lanes.attendance },
  ];
  const showLine = markers.length > 0 || lineBlocks.length > 0;
  // Early and late buses widen the line to whole hours around them.
  const lineStart = [...lineBlocks.map((b) => `${b.start.slice(0, 2)}:00`), '07:00'].sort()[0];
  const lineEnd = [...lineBlocks.map((b) => plusMinutes(b.end, 59).slice(0, 2) + ':00'), '17:00']
    .sort()
    .at(-1);
  const loading = att.isPending && !att.isError;
  const checks = ready.data?.checks ?? [];
  const hour = Number(now.slice(0, 2));

  const weekDays = (trend.data ?? [])
    .filter(
      (x) =>
        x.present + x.absent + x.leave > 0 || new Date(`${x.onDate}T00:00:00Z`).getUTCDay() !== 0,
    )
    .map((x) => ({
      label: weekday.format(new Date(`${x.onDate}T00:00:00Z`)),
      present: x.present,
      absent: x.absent,
    }));
  const anyWeek = weekDays.some((x) => x.present + x.absent > 0);
  const genders = (['male', 'female', 'other', 'unknown'] as const).map((g) => ({
    key: g,
    label: d.distribution.genders[g] ?? g,
    value: (roll.data ?? []).filter(
      (x) =>
        x.status === 'active' &&
        (g === 'unknown' ? !x.gender || x.gender === 'not_stated' : x.gender === g),
    ).length,
    color:
      g === 'male' ? '#2563eb' : g === 'female' ? '#ec4899' : g === 'other' ? '#8b5cf6' : '#9aa8bf',
  }));
  const genderTotal = genders.reduce((n, g) => n + g.value, 0);
  const largest = [...sections].sort((x, y) => y.students - x.students).slice(0, 4);
  const counts = pipe.data?.counts;
  const leads = counts ? Object.values(counts).reduce((n, v) => n + v, 0) : 0;
  const converted = counts?.enrolled ?? 0;
  const conversion = leads ? Math.round((converted / leads) * 100) : 0;
  const modes = cash.data
    ? (
        [
          ['cash', cash.data.cash.paise],
          ['cheques', cash.data.cheques.paise],
          ['digital', cash.data.digital.paise],
        ] as const
      ).filter(([, v]) => v > 0)
    : [];
  const modeTotal = modes.reduce((n, [, v]) => n + v, 0);
  const collectionRate = sum?.billedPaise
    ? Math.round((sum.collectedPaise / sum.billedPaise) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-10 pb-12">
      <PageHeader
        eyebrow={`${school.institutionName ?? ''}${school.institutionName ? ' · ' : ''}${dateInIndia.format(new Date())}`}
        title={
          me.data ? h.greetingName(en.greeting(hour), me.data.name.split(' ')[0] ?? '') : h.title
        }
        icon={Sparkles}
        dark
      />

      {ready.data && !ready.data.ready && (
        <SetupChecklist
          checks={checks.map((c) => ({
            key: c.key,
            ok: c.ok,
            href: h.setupSteps[c.key]?.href ?? '/setup',
            title: h.setupSteps[c.key]?.title ?? c.key,
          }))}
        />
      )}

      {school.institutionId && <CheckInCard institutionId={school.institutionId} />}

      {figures.length > 0 || loading ? (
        <KeyFigures variant="strip" figures={figures} label={h.figures} loading={loading} />
      ) : null}

      <AttentionRibbon items={attention} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {trend.data !== undefined && trend.data !== null && (
          <DashPanel
            className="lg:col-span-2"
            eyebrow={d.weekly.eyebrow}
            title={
              <>
                {attendancePct}%{' '}
                <span className="text-body font-normal text-ink-muted">{d.weekly.today}</span>
              </>
            }
            action={{ label: d.weekly.report, href: '/attendance' }}
          >
            {anyWeek ? (
              <WeeklyBars days={weekDays} />
            ) : (
              <p className="py-20 text-center text-body text-ink-muted italic">{d.weekly.empty}</p>
            )}
          </DashPanel>
        )}
        {cash.data && (
          <DashPanel
            tint
            eyebrow={d.pulse.eyebrow}
            aside={<span className="tabular text-[10px] text-ink-muted">{now}</span>}
          >
            <div className="flex flex-col gap-6 px-6 py-6">
              <div>
                <p className="text-caption text-ink-muted">{d.pulse.collection}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="tabular font-display text-[2.25rem] leading-none font-bold tracking-tight text-ink">
                    {shortRupees(collected ?? 0)}
                  </span>
                  <span className="text-caption text-ink-muted">· {d.pulse.txn(receipts)}</span>
                </p>
              </div>
              <div className="flex flex-col gap-3 border-t border-line pt-5">
                <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
                  {d.pulse.byMode}
                </p>
                {modes.length === 0 ? (
                  <p className="text-caption text-ink-muted italic">{d.pulse.none}</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {modes.map(([k, v]) => (
                      <li key={k} className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-caption">
                          <span className="text-ink">{d.pulse.modes[k]}</span>
                          <span className="tabular text-ink-muted">{shortRupees(v)}</span>
                        </span>
                        <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-navy-50">
                          <span
                            className="block h-full rounded-full bg-linear-to-r from-navy-950 to-cyan-400"
                            style={{ width: `${modeTotal ? (v / modeTotal) * 100 : 0}%` }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </DashPanel>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {roll.data && (
          <DashPanel
            eyebrow={d.distribution.eyebrow}
            aside={
              <span className="tabular text-caption text-ink-muted">
                {d.distribution.total(genderTotal)}
              </span>
            }
          >
            <div className="flex flex-col gap-5 px-6 py-5">
              {genderTotal === 0 ? (
                <p className="py-10 text-center text-body text-ink-muted">{d.distribution.empty}</p>
              ) : (
                <>
                  <Donut
                    parts={genders.map((g) => ({ label: g.label, value: g.value, color: g.color }))}
                    total={genderTotal}
                    label={d.distribution.students}
                  />
                  <ul className="grid grid-cols-2 gap-2 text-caption">
                    {genders
                      .filter((g) => g.value > 0)
                      .map((g) => (
                        <li key={g.key} className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 rounded-sm"
                            style={{ backgroundColor: g.color }}
                          />
                          <span className="text-ink-muted">{g.label}</span>
                          <span className="tabular ml-auto font-medium text-ink">{g.value}</span>
                        </li>
                      ))}
                  </ul>
                  {largest.length > 0 && (
                    <div className="border-t border-line pt-4">
                      <p className="mb-2 text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
                        {d.distribution.largest}
                      </p>
                      <ul className="flex flex-col gap-1.5 text-caption">
                        {largest.map((x) => (
                          <li key={x.sectionId} className="flex items-center justify-between">
                            <span className="truncate pr-2 text-ink">{x.label}</span>
                            <span className="tabular text-ink-muted">{x.students}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </DashPanel>
        )}
        {pipe.data && (
          <DashPanel
            eyebrow={d.pipeline.eyebrow}
            action={{ label: d.pipeline.open, href: '/admissions' }}
          >
            <div className="flex flex-col gap-6 px-6 py-6">
              <div className="flex items-center gap-2">
                <Stage value={leads} label={d.pipeline.leads} />
                <StageArrow />
                <Stage value={converted} label={d.pipeline.converted} go />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-caption">
                  <span className="text-ink-muted">{d.pipeline.rate}</span>
                  <span className="tabular font-display font-semibold text-ink">{conversion}%</span>
                </div>
                <span aria-hidden className="h-2 overflow-hidden rounded-full bg-navy-50">
                  <span
                    className="block h-full rounded-full bg-linear-to-r from-navy-950 via-cyan-400 to-signal-go"
                    style={{ width: `${Math.min(100, conversion)}%` }}
                  />
                </span>
              </div>
            </div>
          </DashPanel>
        )}
        {sum && (
          <DashPanel eyebrow={d.finance.eyebrow} action={{ label: d.finance.dues, href: '/fees' }}>
            <div className="flex flex-col gap-5 px-6 py-6">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.22em] text-ink-muted uppercase">
                  {d.finance.billed}
                </p>
                <p className="tabular mt-1 font-display text-[1.875rem] leading-none font-bold text-ink">
                  {shortRupees(sum.billedPaise)}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span aria-hidden className="flex h-2 overflow-hidden rounded-full bg-navy-50">
                  <span className="h-full bg-signal-go" style={{ width: `${collectionRate}%` }} />
                  <span
                    className="h-full bg-signal-stop/70"
                    style={{ width: `${sum.billedPaise ? 100 - collectionRate : 0}%` }}
                  />
                </span>
                <p className="text-caption font-medium text-ink">
                  {d.finance.rate(collectionRate)}
                </p>
              </div>
              <ul className="flex flex-col divide-y divide-line text-body">
                <li className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-ink-muted">
                    <span aria-hidden className="size-2 rounded-full bg-signal-go" />
                    {d.finance.collected}
                  </span>
                  <span className="tabular font-semibold text-signal-go-ink">
                    {shortRupees(sum.collectedPaise)}
                  </span>
                </li>
                <li className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-ink-muted">
                    <span aria-hidden className="size-2 rounded-full bg-signal-stop" />
                    {d.finance.outstanding}
                  </span>
                  <span className="tabular font-semibold text-signal-stop-ink">
                    {shortRupees(sum.outstandingPaise)}
                  </span>
                </li>
              </ul>
            </div>
          </DashPanel>
        )}
      </div>

      {showLine && (
        <DayLine
          loading={loading}
          now={now}
          start={lineStart ?? '07:00'}
          end={lineEnd ?? '17:00'}
          lanes={lanes}
          blocks={lineBlocks}
          markers={markers}
          labels={en.dayLine}
        />
      )}

      <QuickPills
        items={[
          { key: 'attendance', href: '/attendance', icon: CalendarCheck },
          { key: 'fee', href: '/fees', icon: IndianRupee },
          { key: 'student', href: '/admissions?new=1', icon: UserPlus },
          { key: 'notice', href: '/notices/new', icon: Megaphone },
          { key: 'staff', href: '/staff', icon: Users },
          { key: 'timetable', href: '/timetable', icon: CalendarClock },
        ]}
      />
    </div>
  );
}

/** "16:30" plus minutes, as "HH:MM" (capped at the end of the day). */
function plusMinutes(hm: string, m: number): string {
  const [h = 0, mm = 0] = hm.split(':').map(Number);
  const t = Math.min(h * 60 + mm + m, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
