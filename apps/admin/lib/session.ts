// Server only. The staff session token lives in one httpOnly cookie on this app; the browser
// never reads it. The API ends it after 30 idle minutes or 8 hours.
import { appEnv, webEnv } from '@campusverse/config';
import { cookies } from 'next/headers';

export const COOKIE = 'cv_admin';
export const API_URL = webEnv().API_URL;
const secure = appEnv() !== 'development';

export async function storeSession(token: string, expiresAt: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** Mutating requests must carry this header. With SameSite=Strict cookies it closes CSRF. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'campusverse-admin';
