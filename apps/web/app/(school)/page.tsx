import type { ViewState } from '@campusverse/ui';
import { hasProfile } from '../../lib/session';
import { PrincipalDay } from './principal-day';
import { Home as Today } from './home';

const STATES: ViewState[] = ['ready', 'loading', 'empty', 'error', 'offline', 'denied'];

/**
 * Signed in: today's real overview. Signed out, the design-review version with a synthetic school:
 * ?state= shows any of the Day Line's states, ?at=HH:MM pins the time.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (await hasProfile()) return <Today />;
  const params = await searchParams;
  const state = STATES.find((s) => s === params.state) ?? 'ready';
  const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(params.at ?? '') ? params.at : undefined;
  return <PrincipalDay state={state} {...(at ? { at } : {})} />;
}
