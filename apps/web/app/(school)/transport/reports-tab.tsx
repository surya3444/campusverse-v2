'use client';

import type {
  BoardingLog,
  DocumentKind,
  RidershipRow,
  Vehicle,
} from '@campusverse/shared-transport';
import { Button, Pill, Section, SkeletonRows, StatePanel } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { date, t, type Ctx } from './shared';

const r = t.reports;
const c = r.cols;
const way = (d: string) => (d === 'pickup' ? t.today.pickup : t.today.drop);
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const BLOCKING: DocumentKind[] = ['fitness', 'insurance', 'permit'];

/** The day's boarding log, a month's riders, and papers due: each downloadable (and logged). */
export function Reports(ctx: Ctx) {
  return (
    <div className="flex flex-col gap-6">
      <Boarding institutionId={ctx.institutionId} />
      <Ridership institutionId={ctx.institutionId} />
      <Papers {...ctx} />
    </div>
  );
}

function Table({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-body">
        <thead>
          <tr className="border-b border-line text-left text-caption text-ink-muted">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">{children}</tbody>
      </table>
    </div>
  );
}

const td = 'px-4 py-2.5';

function Boarding({ institutionId }: { institutionId: string }) {
  const [day, setDay] = useState(todayIso);
  const log = useQuery({
    queryKey: ['transport-boarding', institutionId, day],
    queryFn: () =>
      api.get<BoardingLog>(
        `/transport/reports/boarding?institutionId=${institutionId}&date=${day}`,
      ),
    enabled: !!day,
  });
  const head = [c.time, c.route, c.student, c.class, c.mark, c.stop, c.by];
  const download = () =>
    log.data &&
    exportCsv(
      'transport_boarding',
      institutionId,
      `boarding-log-${day}`,
      [c.date, c.time, c.route, c.direction, c.student, c.class, c.admission, c.mark, c.stop, c.by],
      log.data.marks.map((m) => [
        day,
        m.at,
        m.route,
        way(m.direction),
        m.name,
        m.label ?? '',
        m.reference ?? '',
        t.trip.marks[m.kind] ?? m.kind,
        m.stop ?? '',
        m.by,
      ]),
    );
  return (
    <Section
      title={r.boarding}
      description={r.boardingBody}
      flush
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            {r.date}
            <input
              type="date"
              className={fieldInput}
              value={day}
              max={todayIso()}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!log.data?.marks.length}
            onClick={() => void download()}
          >
            <Download aria-hidden className="size-3.5" />
            {r.download}
          </Button>
        </div>
      }
    >
      {log.isPending ? (
        <SkeletonRows rows={3} label={en.states.loading.title} />
      ) : log.isError ? (
        <StatePanel kind="error" title={en.states.error.title} />
      ) : log.data.trips.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-muted">{r.noTrips}</p>
      ) : (
        <>
          <ul className="divide-y divide-line border-b border-line">
            {log.data.trips.map((x) => (
              <li
                key={`${x.route}-${x.direction}`}
                className="flex flex-wrap items-center gap-2 px-4 py-2.5"
              >
                <span className="font-medium text-ink">
                  {r.trip(x.route, way(x.direction), x.startedAt, x.endedAt)}
                </span>
                <Pill
                  tone={x.checkOutcome === 'child_found' ? 'stop' : x.checkOutcome ? 'go' : 'warn'}
                >
                  {x.checkOutcome ? r.checked[x.checkOutcome] : r.notChecked}
                </Pill>
                {x.sosAt && <Pill tone="stop">{r.sos(x.sosAt, x.sosNote)}</Pill>}
                {x.overrideReason && <Pill tone="warn">{r.override(x.overrideReason)}</Pill>}
                {x.checkNote && <span className="text-caption text-ink-muted">{x.checkNote}</span>}
              </li>
            ))}
          </ul>
          <Table label={r.boarding} head={head}>
            {log.data.marks.map((m, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className={td}>{m.at}</td>
                <td className={td}>{m.route}</td>
                <td className={td}>{m.name}</td>
                <td className={td}>{m.label ?? ''}</td>
                <td className={td}>{t.trip.marks[m.kind]}</td>
                <td className={td}>{m.stop ?? ''}</td>
                <td className={td}>{m.by}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

function Ridership({ institutionId }: { institutionId: string }) {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const rows = useQuery({
    queryKey: ['transport-ridership', institutionId, month],
    queryFn: () =>
      api.get<RidershipRow[]>(
        `/transport/reports/ridership?institutionId=${institutionId}&month=${month}`,
      ),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
  const head = [c.route, c.direction, c.riders, c.days, c.boarded, c.notBoarded, c.childFound];
  const cells = (x: RidershipRow) => [
    x.route,
    way(x.direction),
    x.riders,
    x.tripDays,
    x.boarded,
    x.notBoarded,
    x.childFound,
  ];
  return (
    <Section
      title={r.ridership}
      description={r.ridershipBody}
      flush
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            {r.month}
            <input
              type="month"
              className={fieldInput}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!rows.data?.length}
            onClick={() =>
              void exportCsv(
                'transport_ridership',
                institutionId,
                `transport-riders-${month}`,
                head,
                (rows.data ?? []).map(cells),
              )
            }
          >
            <Download aria-hidden className="size-3.5" />
            {r.download}
          </Button>
        </div>
      }
    >
      {rows.isPending ? (
        <SkeletonRows rows={3} label={en.states.loading.title} />
      ) : rows.isError ? (
        <StatePanel kind="error" title={en.states.error.title} />
      ) : rows.data.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-muted">{r.noRoutes}</p>
      ) : (
        <Table label={r.ridership} head={head}>
          {rows.data.map((x) => (
            <tr key={`${x.route}-${x.direction}`} className="border-b border-line last:border-0">
              {cells(x).map((v, i) => (
                <td key={i} className={td}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

type Due = { vehicle: Vehicle; kind: DocumentKind; until: string | null; status: string };

function Papers({ institutionId, data }: Ctx) {
  const v = t.vehicles;
  const due: Due[] = data.vehicles
    .filter((x) => x.active)
    .flatMap((x) =>
      (Object.entries(x.documents) as [DocumentKind, Vehicle['documents'][DocumentKind]][])
        .filter(([k, d]) => (d ? d.status !== 'valid' : BLOCKING.includes(k)))
        .map(([kind, d]) => ({
          vehicle: x,
          kind,
          until: d?.validUntil ?? null,
          status: d?.status ?? 'missing',
        })),
    );
  const statusText = (d: Due) =>
    d.status === 'missing'
      ? r.missing
      : v.status[d.status as 'expiring' | 'expired'](date(d.until ?? ''));
  const head = [c.vehicle, c.document, c.validUntil, c.status];
  return (
    <Section
      title={r.papers}
      description={r.papersBody}
      flush
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={due.length === 0}
          onClick={() =>
            void exportCsv(
              'transport_papers',
              institutionId,
              'vehicle-papers-due',
              head,
              due.map((d) => [
                d.vehicle.registration,
                v.documents[d.kind] ?? d.kind,
                d.until ?? '',
                statusText(d),
              ]),
            )
          }
        >
          <Download aria-hidden className="size-3.5" />
          {r.download}
        </Button>
      }
    >
      {due.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-muted">{r.noPapers}</p>
      ) : (
        <Table label={r.papers} head={head}>
          {due.map((d) => (
            <tr key={`${d.vehicle.id}-${d.kind}`} className="border-b border-line last:border-0">
              <td className={td}>{d.vehicle.registration}</td>
              <td className={td}>{v.documents[d.kind]}</td>
              <td className={td}>{d.until ? date(d.until) : ''}</td>
              <td className={td}>
                <Pill tone={d.status === 'expiring' ? 'warn' : 'stop'}>{statusText(d)}</Pill>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
