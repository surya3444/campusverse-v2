'use client';

// "Your attendance" on the home screen, for anyone on staff here: check in and out with where
// you are (if the browser shares it). The office's register has the final word.
import type { MyDay } from '@campusverse/shared-staff-attendance';
import { Button, IconTile, Pill } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, MapPin } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { uuidv7 } from '../../../lib/sync-queue';
import { en } from '../../../messages/en';

const t = en.checkIn;
const time = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function where(): Promise<{ lat: number; lng: number; accuracyMetres: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((ok) =>
    navigator.geolocation.getCurrentPosition(
      (p) =>
        ok({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyMetres: Math.round(p.coords.accuracy),
        }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    ),
  );
}

export function CheckInCard({ institutionId }: { institutionId: string }) {
  const today = istToday();
  const day = useQuery({
    queryKey: ['my-day', institutionId, today],
    queryFn: () =>
      api.get<MyDay>(`/staff-attendance/me?institutionId=${institutionId}&date=${today}`),
  });
  const [locating, setLocating] = useState(false);
  const [result, setResult] = useState<{
    onCampus: boolean | null;
    distance: number | null;
    located: boolean;
  } | null>(null);
  const tap = useMutation({
    mutationFn: async (direction: 'in' | 'out') => {
      setLocating(true);
      const location = await where();
      setLocating(false);
      const r = await api.post<{ onCampus: boolean | null; distance: number | null }>(
        '/staff-attendance/check',
        {
          institutionId,
          direction,
          eventId: uuidv7(),
          source: 'web',
          location,
        },
      );
      return { ...r, located: location !== null };
    },
    onSuccess: (r) => {
      setResult(r);
      void day.refetch();
    },
  });
  if (!day.data?.onStaff) return null;
  const d = day.data;
  const last = d.taps.at(-1);
  const inNow = last?.direction === 'in';
  const firstIn = d.taps.find((x) => x.direction === 'in');
  const lastOut = [...d.taps].reverse().find((x) => x.direction === 'out');
  const error =
    tap.error instanceof ApiFailure
      ? (t.errors[tap.error.status === 403 ? 'forbidden' : tap.error.code] ?? t.errors.error)
      : tap.isError
        ? t.errors.error
        : null;

  return (
    <section
      aria-labelledby="my-attendance"
      className="panel flex flex-wrap items-center gap-4 p-5"
    >
      <IconTile icon={Clock} area="teal" size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="my-attendance" className="text-lead font-semibold text-ink">
          {t.title}
        </h2>
        <p className="text-body text-ink-muted">
          {d.day?.source === 'register'
            ? t.marked(en.staffAttendance.statuses[d.day.status]?.toLowerCase() ?? '')
            : firstIn
              ? [
                  t.inSince(time.format(new Date(firstIn.at))),
                  lastOut && !inNow ? t.outAt(time.format(new Date(lastOut.at))) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t.notIn}
        </p>
        <p role="status" className="flex flex-wrap items-center gap-2 text-caption">
          {d.day?.late && <Pill tone="warn">{t.late}</Pill>}
          {result && result.onCampus !== null && (
            <span
              className={
                result.onCampus
                  ? 'inline-flex items-center gap-1 text-signal-go-ink'
                  : 'inline-flex items-center gap-1 text-signal-warn-ink'
              }
            >
              <MapPin aria-hidden className="size-3.5" />
              {result.onCampus ? t.onCampus : t.offCampus(result.distance ?? 0)}
            </span>
          )}
          {result && !result.located && <span className="text-ink-muted">{t.noLocation}</span>}
          {error && <span className="text-signal-stop-ink">{error}</span>}
        </p>
      </div>
      <Button
        onClick={() => tap.mutate(inNow ? 'out' : 'in')}
        disabled={tap.isPending}
        variant={inNow ? 'secondary' : 'primary'}
        className="h-11 px-5"
      >
        {inNow ? (
          <LogOut aria-hidden className="size-4" />
        ) : (
          <LogIn aria-hidden className="size-4" />
        )}
        {locating ? t.locating : inNow ? t.checkOut : t.checkIn}
      </Button>
    </section>
  );
}
