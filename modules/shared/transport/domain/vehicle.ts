// Vehicle papers and route shape: pure rules, no database.

export const DOCUMENT_KINDS = [
  'registration',
  'fitness',
  'insurance',
  'permit',
  'pollution',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Without these in date the vehicle can't be put on a trip (spec: Vehicles). */
export const BLOCKING_KINDS: readonly DocumentKind[] = ['fitness', 'insurance', 'permit'];
export const WARN_DAYS = 30;

export type DocumentStatus = 'valid' | 'expiring' | 'expired';

const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** Valid through `validUntil` inclusive; within WARN_DAYS of it is "expiring". */
export function documentStatus(validUntil: string, today: string): DocumentStatus {
  const left = dayNumber(validUntil) - dayNumber(today);
  if (left < 0) return 'expired';
  return left <= WARN_DAYS ? 'expiring' : 'valid';
}

export type Readiness = {
  /** The document of each kind that is valid longest, or null when none is recorded. */
  documents: Record<DocumentKind, { validUntil: string; status: DocumentStatus } | null>;
  /** Blocking kinds missing or expired. */
  blocked: DocumentKind[];
};

export function vehicleReadiness(
  docs: { kind: string; validUntil: string }[],
  today: string,
): Readiness {
  const documents = Object.fromEntries(
    DOCUMENT_KINDS.map((k) => [k, null]),
  ) as Readiness['documents'];
  for (const d of docs) {
    if (!(DOCUMENT_KINDS as readonly string[]).includes(d.kind)) continue;
    const kind = d.kind as DocumentKind;
    const best = documents[kind];
    if (!best || d.validUntil > best.validUntil)
      documents[kind] = { validUntil: d.validUntil, status: documentStatus(d.validUntil, today) };
  }
  return {
    documents,
    blocked: BLOCKING_KINDS.filter((k) => (documents[k]?.status ?? 'expired') === 'expired'),
  };
}

export type RouteStopInput = { stopId: string; plannedAt: string };
export type StopsProblem = 'no_stops' | 'stop_repeated' | 'times_out_of_order';

/** A route visits each stop once, in time order ("HH:MM"). */
export function checkStops(stops: RouteStopInput[]): StopsProblem | null {
  if (stops.length === 0) return 'no_stops';
  if (new Set(stops.map((s) => s.stopId)).size !== stops.length) return 'stop_repeated';
  for (let i = 1; i < stops.length; i++)
    if ((stops[i]?.plannedAt ?? '') < (stops[i - 1]?.plannedAt ?? '')) return 'times_out_of_order';
  return null;
}

/** "ts 09 ab 1234" → "TS09AB1234"; null when it can't be a registration number. */
export function normaliseRegistration(text: string): string | null {
  const r = text.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{4,12}$/.test(r) ? r : null;
}
