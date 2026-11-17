// One sentence about a child's bus, from what the server says (shared/transport childBus).
import type { Messages } from './messages';

export type ChildBus = {
  direction: 'pickup' | 'drop';
  route: string;
  stop: string;
  stopAt: string;
  skipping: boolean;
  trip: { running: boolean; startedAt: string } | null;
  mark: { kind: string; at: string } | null;
  etaMin: number | null;
  bus: { lat: number; lng: number; at: string; minutesAgo: number } | null;
};

export type BusLine = {
  text: string;
  extra: string | null;
  tone: 'go' | 'warn' | 'stop' | undefined;
};

/** "07:25" as "7:25 am", the way the other times read. */
const clock = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** Null when there is nothing worth saying (the trip ended without a mark for this child). */
export function busLine(t: Messages, name: string, b: ChildBus): BusLine | null {
  const eta = b.etaMin !== null ? t.busEta(b.etaMin) : null;
  if (b.skipping && !b.mark) return { text: t.busSkipping(name), extra: null, tone: undefined };
  switch (b.mark?.kind) {
    case 'boarded':
      return { text: t.busBoarded(name, b.mark.at), extra: eta, tone: 'go' };
    case 'handed_to_school':
      return { text: t.busAtSchool(name, b.mark.at), extra: null, tone: 'go' };
    case 'dropped':
      return { text: t.busDropped(name, b.stop, b.mark.at), extra: null, tone: 'go' };
    case 'nobody_at_stop':
      return { text: t.busComingBack(name), extra: null, tone: 'stop' };
    case 'not_boarded':
      return { text: t.busNotOn(name), extra: null, tone: 'warn' };
  }
  if (b.trip?.running)
    return { text: t.busRunning(name, b.trip.startedAt), extra: eta, tone: undefined };
  if (b.trip) return null;
  const at = clock(b.stopAt);
  return {
    text:
      b.direction === 'pickup'
        ? t.busPlanned(name, b.stop, at)
        : t.busDropPlanned(name, b.stop, at),
    extra: null,
    tone: undefined,
  };
}

/** The bus on OpenStreetMap: no maps account, only the point leaves the phone. */
export const mapUrl = ({ lat, lng }: { lat: number; lng: number }) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
