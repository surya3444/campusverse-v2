'use client';

import type { TodayTrip } from '@campusverse/shared-transport';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CarFront as Steering, Play } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { errorText, t, type Ctx } from './shared';

const d = t.today;
const kinds = (k: string[]) => k.join(', ');
/** OpenStreetMap at the bus's position: no maps account, nothing sent but the point. */
export const osm = ({ lat, lng }: { lat: number; lng: number }) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

export const tripsKey = (institutionId: string) => ['transport-trips', institutionId];

/** What the trip is doing, in one pill. */
function status(trip: TodayTrip['trip']): [Tone, string] {
  if (!trip) return ['neutral', d.notStarted];
  if (!trip.endedAt) return ['warn', d.running(trip.startedAt)];
  return trip.checkOutcome === 'child_found'
    ? ['stop', d.childFound(trip.endedAt)]
    : ['go', d.endedEmpty(trip.endedAt)];
}

/** Every bus today: running, waiting or done, and where its children are. */
export function Today(ctx: Ctx) {
  const { institutionId, attend, drive } = ctx;
  const list = useQuery({
    queryKey: tripsKey(institutionId),
    queryFn: () => api.get<TodayTrip[]>(`/transport/trips?institutionId=${institutionId}`),
    refetchInterval: 30_000,
  });
  const [starting, setStarting] = useState<TodayTrip | null>(null);
  const start = useStartTrip(institutionId);

  if (list.isPending) return <SkeletonRows rows={4} label={en.states.loading.title} />;
  if (list.isError) return <StatePanel kind="error" title={en.states.error.title} />;
  if (list.data.length === 0)
    return <EmptyState art="transport" area="amber" title={d.empty} body={d.emptyBody} />;

  return (
    <Section
      flush
      {...(drive
        ? {
            actions: (
              <Link
                href="/transport/drive"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body font-medium text-navy-950 hover:bg-navy-50"
              >
                <Steering aria-hidden className="size-4" />
                {d.drive}
              </Link>
            ),
          }
        : {})}
    >
      {start.error && (
        <p role="alert" className="px-4 pt-3 text-body text-signal-stop-ink">
          {errorText(start.error)}
        </p>
      )}
      <ul className="divide-y divide-line">
        {list.data.map((r) => {
          const [tone, label] = status(r.trip);
          const c = r.counts;
          return (
            <li key={r.routeId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {r.name}
                  <span className="text-caption text-ink-muted">
                    {r.direction === 'pickup' ? d.pickup : d.drop}
                    {r.firstAt && r.lastAt ? ` · ${d.times(r.firstAt, r.lastAt)}` : ''}
                    {r.vehicle ? ` · ${r.vehicle}` : ''}
                  </span>
                </p>
                <p className="flex flex-wrap items-center gap-2 text-caption text-ink-muted tabular-nums">
                  <Pill tone={tone}>{label}</Pill>
                  {r.trip ? (
                    <>
                      <span>{d.progress(c.on_board, r.riders)}</span>
                      {c.dropped > 0 && <span>{d.dropped(c.dropped)}</span>}
                      {c.at_school > 0 && <span>{d.atSchool(c.at_school)}</span>}
                      {c.not_boarded > 0 && <span>{d.notBoarded(c.not_boarded)}</span>}
                    </>
                  ) : (
                    <span>{d.riders(r.riders)}</span>
                  )}
                  {r.trip?.sos && <Pill tone="stop">{t.sos.raised(r.trip.sos.at)}</Pill>}
                  {r.trip?.lastSeen && !r.trip.endedAt && (
                    <span className="inline-flex items-center gap-1">
                      {d.lastSeen(r.trip.lastSeen.at, r.trip.lastSeen.minutesAgo)}
                      <a
                        href={osm(r.trip.lastSeen)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={d.mapFor(r.name)}
                        className="font-medium text-navy-950 underline"
                      >
                        {d.map}
                      </a>
                    </span>
                  )}
                  {r.trip?.overridden ? (
                    <Pill tone="warn">{d.overridden}</Pill>
                  ) : (
                    !r.trip &&
                    r.blocked.length > 0 && <Pill tone="stop">{d.papers(kinds(r.blocked))}</Pill>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                {attend && !r.trip && (
                  <Button
                    size="sm"
                    disabled={start.isPending}
                    aria-label={d.startFor(r.name, r.direction === 'pickup' ? d.pickup : d.drop)}
                    onClick={() =>
                      r.blocked.length > 0 ? setStarting(r) : start.mutate({ routeId: r.routeId })
                    }
                  >
                    <Play aria-hidden className="size-3.5" />
                    {d.start}
                  </Button>
                )}
                <Link
                  href={`/transport/trip/${r.routeId}`}
                  aria-label={d.openFor(r.name, r.direction === 'pickup' ? d.pickup : d.drop)}
                  className="inline-flex items-center rounded-lg px-3 py-1.5 text-body font-medium text-navy-950 hover:bg-navy-50"
                >
                  {d.open}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      {starting && (
        <StartWithReason
          institutionId={institutionId}
          route={starting}
          onClose={() => setStarting(null)}
        />
      )}
    </Section>
  );
}

/** Starts a trip. The attendant goes on to its sheet; the driver stays on the driving screen. */
export function useStartTrip(institutionId: string, openSheet = true) {
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { routeId: string; overrideReason?: string }) =>
      api.post<{ id: string }>('/transport/trips', { institutionId, ...v }),
    onSuccess: (_r, v) =>
      openSheet
        ? router.push(`/transport/trip/${v.routeId}`)
        : qc.invalidateQueries({ queryKey: tripsKey(institutionId) }),
  });
}

/** Missing papers: the trip runs only with a reason, recorded with it. */
export function StartWithReason({
  institutionId,
  route,
  onClose,
  openSheet = true,
}: {
  institutionId: string;
  route: Pick<TodayTrip, 'routeId' | 'name' | 'blocked'>;
  onClose: () => void;
  openSheet?: boolean;
}) {
  const start = useStartTrip(institutionId, openSheet);
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title={d.startOverride(route.name)}
      description={d.overrideBody(kinds(route.blocked))}
      submitLabel={d.start}
      cancelLabel={t.cancel}
      pending={start.isPending}
      submitDisabled={reason.trim().length < 3}
      error={start.error ? errorText(start.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() =>
        start.mutate({ routeId: route.routeId, overrideReason: reason }, { onSuccess: onClose })
      }
    >
      <ModalField label={d.reason} wide>
        <textarea
          className={fieldInput}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
