// Browser side: calls this app's /api/admin pass-through. Errors arrive in the API's one shape.

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

const HEADERS = { 'x-requested-with': 'campusverse-admin' };

async function read<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (res.status === 401 && typeof window !== 'undefined')
    window.location.assign(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
  throw new ApiFailure(res.status, body.code ?? 'error', body.message ?? 'Something went wrong.');
}

const post = (url: string, json?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

export const api = {
  get: <T>(path: string) =>
    fetch(`/api/admin${path}`, { cache: 'no-store' }).then((r) => read<T>(r)),
  post: <T>(path: string, json?: unknown) =>
    post(`/api/admin${path}`, json).then((r) => read<T>(r)),
};

/** Passkey steps go through /session, which keeps the token in an httpOnly cookie. */
export const session = (step: string, json: unknown = {}) =>
  post(`/session/${step}`, json).then(async (res) => {
    if (res.ok)
      return (res.status === 204 ? undefined : await res.json()) as Record<string, unknown>;
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiFailure(res.status, body.code ?? 'error', body.message ?? 'Something went wrong.');
  });
