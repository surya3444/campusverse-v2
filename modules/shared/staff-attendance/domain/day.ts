// Staff attendance with no I/O: where a check-in was, and what a day counts as. Clock times are
// India time (UTC+5:30, no daylight saving).

export type Settings = {
  startsAt: string;
  endsAt: string;
  lateAfterMinutes: number;
  earlyBeforeMinutes: number;
  fullDayMinutes: number;
};
export type Point = { lat: number; lng: number };
export type Tap = { direction: 'in' | 'out'; at: string };
export type DayStatus = 'present' | 'absent' | 'half_day' | 'on_leave' | 'on_duty';
export type Summary = {
  status: 'present' | 'half_day';
  firstIn: string;
  lastOut: string | null;
  late: boolean;
  leftEarly: boolean;
};

const IST_OFFSET_MS = 330 * 60_000;
const EARTH_METRES = 6_371_000;

export function distanceMetres(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_METRES * Math.asin(Math.sqrt(h)));
}

export function onCampus(at: Point, gate: Point, radiusMetres: number) {
  const distance = distanceMetres(at, gate);
  return { distance, inside: distance <= radiusMetres };
}

/** The calendar day in India for an instant. */
export const istDate = (iso: string) =>
  new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Minutes since midnight, India time. */
const istMinutes = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** One day's taps, as the day counts: null when there was no check-in at all. */
export function summariseDay(taps: Tap[], s: Settings): Summary | null {
  const sorted = [...taps].sort((a, b) => a.at.localeCompare(b.at));
  const firstIn = sorted.find((t) => t.direction === 'in')?.at;
  if (!firstIn) return null;
  const lastOut = sorted.filter((t) => t.direction === 'out' && t.at > firstIn).at(-1)?.at ?? null;
  const worked = lastOut
    ? (new Date(lastOut).getTime() - new Date(firstIn).getTime()) / 60_000
    : null;
  return {
    status: worked !== null && worked < s.fullDayMinutes ? 'half_day' : 'present',
    firstIn,
    lastOut,
    late: istMinutes(firstIn) > clock(s.startsAt) + s.lateAfterMinutes,
    leftEarly: lastOut !== null && istMinutes(lastOut) < clock(s.endsAt) - s.earlyBeforeMinutes,
  };
}

/** A month's totals; a half day counts as half a day worked. */
export function monthTotals(days: { status: DayStatus; late: boolean; leftEarly: boolean }[]) {
  const n = (s: DayStatus) => days.filter((d) => d.status === s).length;
  return {
    present: n('present'),
    half_day: n('half_day'),
    absent: n('absent'),
    on_leave: n('on_leave'),
    on_duty: n('on_duty'),
    late: days.filter((d) => d.late).length,
    leftEarly: days.filter((d) => d.leftEarly).length,
    worked: n('present') + n('on_duty') + n('half_day') / 2,
  };
}
