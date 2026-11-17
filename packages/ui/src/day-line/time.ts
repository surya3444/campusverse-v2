// Time maths for the Day Line. Pure, so it is tested without a browser.

/** 'HH:MM' (24-hour, school-local) to minutes since midnight. Throws on anything else. */
export function toMinutes(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Day Line: bad time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Where a time sits on the line, from 0 (start) to 1 (end), clamped. */
export function position(at: string, start: string, end: string): number {
  const s = toMinutes(start);
  const span = toMinutes(end) - s;
  if (span <= 0) throw new Error('Day Line: end must be after start');
  return Math.min(1, Math.max(0, (toMinutes(at) - s) / span));
}

/** The current time in India, as 'HH:MM'. Schools run on IST whatever the device says. */
export function nowInIndia(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Whole hours between start and end, for tick labels. */
export function hourTicks(start: string, end: string): string[] {
  const first = Math.ceil(toMinutes(start) / 60);
  const last = Math.floor(toMinutes(end) / 60);
  return Array.from(
    { length: last - first + 1 },
    (_, i) => `${String(first + i).padStart(2, '0')}:00`,
  );
}

/**
 * Puts markers on rows so their labels don't collide: a marker goes on the first row whose
 * previous marker is at least `gapMinutes` earlier. Returns the row index for each marker.
 */
export function stackRows(times: string[], gapMinutes: number, maxRows = 3): number[] {
  const order = times.map((t, i) => ({ m: toMinutes(t), i })).sort((a, b) => a.m - b.m);
  const lastOnRow: number[] = [];
  const rows = new Array<number>(times.length).fill(0);
  for (const { m, i } of order) {
    let row = lastOnRow.findIndex((last) => m - last >= gapMinutes);
    if (row === -1) row = lastOnRow.length < maxRows ? lastOnRow.length : maxRows - 1;
    lastOnRow[row] = m;
    rows[i] = row;
  }
  return rows;
}
