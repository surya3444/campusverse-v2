import type { ImportRow, TransportSetup } from '@campusverse/shared-transport';
import { parseCsv } from '../../../lib/csv';
import { ApiFailure } from '../../../lib/api';
import { en } from '../../../messages/en';

export const t = en.transportPage;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const date = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

export const errorText = (e: unknown): string => {
  if (e instanceof ApiFailure && e.code === 'crew_checks') {
    const d = e.details as { crew: 'driver' | 'attendant'; checks: string[] } | null;
    const checks = (d?.checks ?? []).map((c) => en.staffPages.checks.kinds[c] ?? c).join(', ');
    return t.crewChecks(d?.crew === 'attendant' ? t.crewAttendant : t.crewDriver, checks);
  }
  return (
    (e instanceof ApiFailure
      ? e.status === 403
        ? t.errors.forbidden
        : (t.errors[e.code] ?? t.errors.error)
      : t.errors.error) ?? ''
  );
};

/** What every tab of the transport screen gets. */
export type Ctx = {
  institutionId: string;
  data: TransportSetup;
  manageVehicles: boolean;
  manageRoutes: boolean;
  manageRiders: boolean;
  /** Runs bus trips: starts them, marks children, ends with the empty-bus check. */
  attend: boolean;
  /** Drives a bus: the driving screen. */
  drive: boolean;
  /** After a change: refresh and announce. */
  onDone: (message?: string) => void;
};

/**
 * Rows for the rider import from a sheet: admission no., route, direction (pickup, drop or both;
 * blank means pickup), stop. A first row that names the admission number column is a header.
 */
export function riderRows(text: string): ImportRow[] {
  const out: ImportRow[] = [];
  for (const [i, [reference = '', route = '', way = '', stop = '']] of parseCsv(text).entries()) {
    if (i === 0 && /admission/i.test(reference)) continue;
    const w = way.toLowerCase();
    const directions: ImportRow['direction'][] =
      w === 'both' ? ['pickup', 'drop'] : w === 'drop' ? ['drop'] : ['pickup'];
    for (const direction of directions) out.push({ reference, route, direction, stop });
  }
  return out;
}
