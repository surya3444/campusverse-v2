// Server only. The browser never sees tokens: they live in httpOnly cookies, and the web server
// adds them when it passes requests on to the API.
import { appEnv, webEnv } from '@campusverse/config';
import { cookies } from 'next/headers';

export const COOKIE = {
  access: 'cv_at',
  refresh: 'cv_rt',
  device: 'cv_device',
  org: 'cv_org',
  person: 'cv_person',
  /** A sign-in waiting for the authenticator code (five minutes). */
  mfa: 'cv_mfa',
} as const;

export const API_URL = webEnv().API_URL;
const secure = appEnv() !== 'development';
const base = { httpOnly: true, sameSite: 'strict' as const, secure, path: '/' };

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export async function storeTokens(t: Tokens) {
  const jar = await cookies();
  jar.set(COOKIE.access, t.accessToken, { ...base, expires: new Date(t.accessExpiresAt) });
  jar.set(COOKIE.refresh, t.refreshToken, { ...base, expires: new Date(t.refreshExpiresAt) });
  // The trusted device outlives sessions, so signing in again on this browser reuses it.
  jar.set(COOKIE.device, t.deviceId, { ...base, maxAge: 365 * 24 * 3600 });
}

export async function storeProfile(orgId: string, personId: string) {
  const jar = await cookies();
  jar.set(COOKIE.org, orgId, { ...base, maxAge: 30 * 24 * 3600 });
  jar.set(COOKIE.person, personId, { ...base, maxAge: 30 * 24 * 3600 });
}

/** Keeps a sign-in challenge until the authenticator code arrives (five minutes). */
export async function storeMfaChallenge(challenge: string) {
  (await cookies()).set(COOKIE.mfa, challenge, { ...base, maxAge: 300 });
}

/** The waiting challenge (kept for retries; the API counts tries and ends it after five). */
export async function takeMfaChallenge(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(COOKIE.mfa)?.value ?? null;
  return value;
}

export async function dropMfaChallenge() {
  (await cookies()).delete(COOKIE.mfa);
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.org, COOKIE.person]) jar.delete(name);
}

/** True when there is a session and a chosen profile; pages use it to send people to /login. */
export async function hasProfile(): Promise<boolean> {
  const jar = await cookies();
  return !!jar.get(COOKIE.refresh) && !!jar.get(COOKIE.org) && !!jar.get(COOKIE.person);
}

export { clientIp } from './client-ip';

/** Mutating requests must carry this header. With SameSite=Strict cookies it closes CSRF. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'campusverse';
