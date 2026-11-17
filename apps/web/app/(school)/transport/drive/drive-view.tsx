'use client';

// The driver's screen: choose the bus, start the trip, then the phone shares where the bus is
// until the trip ends. Positions wait on the phone through dead zones and go when signal returns
// (the server keeps one point per moment, so a resend adds nothing). The driver never sees or
// marks children.
import type { TodayTrip } from '@campusverse/shared-transport';
import {
  Announcer,
  Button,
  EmptyState,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CarFront, LocateFixed, Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { useMe } from '../../common/me';
import { errorText, t } from '../shared';
import { SosButton } from '../sos';
import { StartWithReason, tripsKey, useStartTrip } from '../today-tab';

const v = t.drive;
const d = t.today;
const KEY = 'cv_drive_route';
/** Keep a point at most this often, and send what has gathered this often. */
const EVERY_MS = 15_000;
const SEND_MS = 30_000;

type Point = { at: string; lat: number; lng: number; speedKmh: number | null; accuracyM: number };
type Share = 'waiting' | 'sharing' | 'denied' | 'unsupported';

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

/** Watches the phone's position while `tripId` is set, and sends it in batches. */
function useShareLocation(institutionId: string, tripId: string | null) {
  const [state, setState] = useState<Share>('waiting');
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const buffer = useRef<Point[]>([]);
  const last = useRef<Point | null>(null);

  useEffect(() => {
    if (!tripId) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState('unsupported');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setState('sharing');
        const point: Point = {
          at: new Date(p.timestamp).toISOString(),
          lat: Math.round(p.coords.latitude * 1e6) / 1e6,
          lng: Math.round(p.coords.longitude * 1e6) / 1e6,
          speedKmh: p.coords.speed === null ? null : Math.round(p.coords.speed * 36) / 10,
          accuracyM: Math.round(p.coords.accuracy),
        };
        const prev = last.current;
        last.current = point;
        if (prev && Date.parse(point.at) - Date.parse(prev.at) < EVERY_MS) return;
        // ponytail: keeps the latest 120 points (30 min) through a dead zone; older ones drop.
        buffer.current = [...buffer.current, point].slice(-120);
        setQueued(buffer.current.length);
      },
      (e) => setState(e.code === e.PERMISSION_DENIED ? 'denied' : 'waiting'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    const send = async () => {
      const points = buffer.current;
      if (points.length === 0 || !navigator.onLine) return;
      try {
        await api.post(`/transport/trips/${tripId}/positions`, { institutionId, points });
        buffer.current = buffer.current.filter((p) => !points.includes(p));
        setQueued(buffer.current.length);
        setSentAt(timeFmt.format(new Date()));
      } catch (e) {
        // The trip ended elsewhere: nothing more to send.
        if (e instanceof ApiFailure && e.code === 'trip_ended') buffer.current = [];
      }
    };
    const timer = setInterval(() => void send(), SEND_MS);
    // The screen must stay on: a phone that sleeps stops sharing (browsers can't share in the
    // background; the Expo app can).
    let lock: { release: () => Promise<void> } | null = null;
    void (
      navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
      void send();
      void lock?.release();
    };
  }, [institutionId, tripId]);

  return { state, sentAt, queued, where: () => last.current };
}

export function DriveView() {
  const { institutionId: id } = useInstitution();
  const me = useMe();
  const qc = useQueryClient();
  const trips = useQuery({
    queryKey: tripsKey(id ?? ''),
    queryFn: () => api.get<TodayTrip[]>(`/transport/trips?institutionId=${id}`),
    enabled: !!id,
    refetchInterval: 15_000,
  });
  const [routeId, setRouteId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      setRouteId(localStorage.getItem(KEY));
    } catch {
      // Private window: choose each time.
    }
  }, []);
  const choose = (r: string | null) => {
    setRouteId(r);
    try {
      if (r) localStorage.setItem(KEY, r);
      else localStorage.removeItem(KEY);
    } catch {
      // Not remembered; fine.
    }
  };

  const bus = trips.data?.find((x) => x.routeId === routeId) ?? null;
  const running = bus?.trip && !bus.trip.endedAt ? bus.trip.id : null;
  const share = useShareLocation(id ?? '', running);
  const start = useStartTrip(id ?? '', false);
  const canDrive = me.can('transport.trip.drive') || me.can('transport.trip.attend');
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  const header = (
    <PageHeader
      icon={CarFront}
      art="transport"
      area="amber"
      eyebrow={
        me.can('transport.trip.read') ? (
          <Link href="/transport" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft aria-hidden className="size-3.5" />
            {t.trip.back}
          </Link>
        ) : (
          en.systems.groups.operations
        )
      }
      title={bus ? bus.name : v.title}
      description={
        bus
          ? [bus.direction === 'pickup' ? d.pickup : d.drop, bus.vehicle]
              .filter(Boolean)
              .join(' · ')
          : v.lead
      }
    />
  );

  if (!id || trips.isPending || me.isPending)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <SkeletonRows rows={4} label={en.states.loading.title} />
      </div>
    );
  if (trips.isError || !canDrive)
    return (
      <div className="flex flex-col gap-6">
        {header}
        {!canDrive || (trips.error instanceof ApiFailure && trips.error.status === 403) ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : offline ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )}
      </div>
    );

  if (!bus)
    return (
      <div className="flex flex-col gap-6">
        {header}
        {trips.data.length === 0 ? (
          <EmptyState art="transport" area="amber" title={d.empty} body={d.emptyBody} />
        ) : (
          <Section title={v.choose} flush>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:grid-cols-2">
              {trips.data.map((r) => (
                <li key={r.routeId}>
                  <button
                    type="button"
                    onClick={() => choose(r.routeId)}
                    className="flex min-h-14 w-full flex-col items-start rounded-lg border border-line px-4 py-3 text-left hover:border-navy-950 hover:bg-navy-50"
                  >
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="text-caption text-ink-muted">
                      {[
                        r.direction === 'pickup' ? d.pickup : d.drop,
                        r.firstAt && r.lastAt ? d.times(r.firstAt, r.lastAt) : null,
                        r.vehicle,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      <Section>
        <div className="flex flex-col gap-4">
          {!bus.trip ? (
            <>
              <p className="text-body text-ink">{v.notStarted}</p>
              {bus.blocked.length > 0 && (
                <Pill tone="stop">{d.papers(bus.blocked.join(', '))}</Pill>
              )}
              <Button
                className="min-h-14 text-title"
                disabled={start.isPending}
                onClick={() =>
                  bus.blocked.length > 0
                    ? setReasonFor(true)
                    : start.mutate({ routeId: bus.routeId })
                }
              >
                <Play aria-hidden className="size-6" />
                {d.start}
              </Button>
              {start.error && (
                <p role="alert" className="text-body text-signal-stop-ink">
                  {errorText(start.error)}
                </p>
              )}
            </>
          ) : running ? (
            <>
              <div role="status" className="flex items-center gap-3">
                <LocateFixed aria-hidden className="size-6 shrink-0 text-navy-950" />
                <div className="flex flex-col">
                  <span className="font-medium text-ink">
                    {share.state === 'sharing'
                      ? v.sharing
                      : share.state === 'denied'
                        ? v.denied
                        : share.state === 'unsupported'
                          ? v.unsupported
                          : v.waiting}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {[
                      share.sentAt ? v.sentAt(share.sentAt) : null,
                      share.queued > 0 && offline ? v.queued(share.queued) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || v.keepOpen}
                  </span>
                </div>
              </div>
              {bus.trip.sos && <Pill tone="stop">{t.sos.raised(bus.trip.sos.at)}</Pill>}
              <SosButton
                large
                institutionId={id}
                tripId={running}
                where={share.where}
                onSent={() => {
                  setMessage(t.sos.sent);
                  void qc.invalidateQueries({ queryKey: tripsKey(id) });
                }}
              />
            </>
          ) : (
            <p className="text-body text-ink">{v.ended}</p>
          )}
        </div>
      </Section>
      {!running && (
        <div>
          <Button variant="quiet" onClick={() => choose(null)}>
            {v.change}
          </Button>
        </div>
      )}
      {reasonFor && (
        <StartWithReason
          institutionId={id}
          route={bus}
          openSheet={false}
          onClose={() => setReasonFor(false)}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}
