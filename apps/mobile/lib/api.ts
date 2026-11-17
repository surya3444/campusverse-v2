// Calls the API as a device: Bearer token plus the chosen profile (x-org-id, x-person-id).
// An expired access token is refreshed once; if that fails, the session is over.
import { API_URL } from './config';
import { store } from './store';

export type Tokens = { accessToken: string; refreshToken: string; deviceId: string };
export type Profile = { orgId: string; personId: string; orgName: string; personName: string };
export type Session = { tokens: Tokens; profile: Profile | null };

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

const KEY = 'cv_session';
let current: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export const session = {
  get: () => current,
  async load(): Promise<Session | null> {
    const raw = await store.get(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
    return current;
  },
  async save(s: Session | null) {
    current = s;
    if (s) await store.set(KEY, JSON.stringify(s));
    else await store.remove(KEY);
    for (const l of listeners) l(s);
  },
  subscribe(l: (s: Session | null) => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

async function raw(path: string, init: RequestInit, auth: boolean): Promise<Response> {
  const s = current;
  // The API refuses a JSON content type with an empty body, so only say JSON when there is one
  // (a file upload sets its own multipart type).
  const headers: Record<string, string> =
    typeof init.body === 'string' ? { 'content-type': 'application/json' } : {};
  if (auth && s) {
    headers.authorization = `Bearer ${s.tokens.accessToken}`;
    if (s.profile) {
      headers['x-org-id'] = s.profile.orgId;
      headers['x-person-id'] = s.profile.personId;
    }
  }
  return fetch(`${API_URL}/api/v1${path}`, { ...init, headers: { ...headers, ...init.headers } });
}

async function refreshed(): Promise<boolean> {
  const s = current;
  if (!s) return false;
  const res = await raw(
    '/auth/refresh',
    { method: 'POST', body: JSON.stringify({ refreshToken: s.tokens.refreshToken }) },
    false,
  );
  if (!res.ok) return false;
  const { tokens } = (await res.json()) as { tokens: Tokens };
  await session.save({ ...s, tokens });
  return true;
}

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  let res = await raw(path, init, auth);
  if (res.status === 401 && auth && (await refreshed())) res = await raw(path, init, auth);
  if (res.status === 401 && auth) await session.save(null);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiFailure(res.status, body.code ?? 'error', body.message ?? 'Something went wrong.');
  }
  const body = await res.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body?: unknown) =>
    call<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  put: <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  /**
   * One file as multipart. On a phone the picker gives a uri (sent as { uri, name, type }, which
   * React Native's FormData reads); on the web it gives a File.
   */
  upload: <T>(
    path: string,
    file: { uri: string; name: string; type: string; web?: Blob | null },
  ) => {
    const form = new FormData();
    form.append(
      'file',
      file.web ?? ({ uri: file.uri, name: file.name, type: file.type } as unknown as Blob),
      file.name,
    );
    return call<T>(path, { method: 'POST', body: form });
  },
  /** Sign-in calls carry no session. */
  public: <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body) }, false),
};
