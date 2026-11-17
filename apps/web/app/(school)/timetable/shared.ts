import { ApiFailure } from '../../../lib/api';
import { en } from '../../../messages/en';

export const t = en.timetablePage;

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const date = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

/** The server's reason in words; a clash names the other section. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiFailure)) return String(t.errors.error);
  if (e.status === 403) return String(t.errors.forbidden);
  const w = t.errors[e.code] ?? t.errors.error;
  const other = (e.details as { other?: string } | null)?.other ?? '';
  return typeof w === 'function' ? w(other) : String(w);
}
