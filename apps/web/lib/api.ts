// Browser side: calls the web server's /api/v1 pass-through. Errors arrive in the API's one
// shape and are thrown as ApiFailure, so screens show a message by its code.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

const HEADERS = { 'x-requested-with': 'campusverse' };

async function read<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    details?: unknown;
  };
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  throw new ApiFailure(
    res.status,
    body.code ?? 'error',
    body.message ?? 'Something went wrong.',
    body.details,
  );
}

function send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, json?: unknown): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...HEADERS,
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  }).then((r) => read<T>(r));
}

export const api = {
  get: <T>(path: string) => fetch(`/api/v1${path}`, { cache: 'no-store' }).then((r) => read<T>(r)),
  post: <T>(path: string, json?: unknown) => send<T>('POST', path, json),
  put: <T>(path: string, json?: unknown) => send<T>('PUT', path, json),
  delete: <T>(path: string) => send<T>('DELETE', path),
  /** Multipart; fields go before the file, so the server reads them with it. */
  upload: <T>(path: string, file: File, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file);
    return fetch(`/api/v1${path}`, { method: 'POST', headers: HEADERS, body: form }).then((r) =>
      read<T>(r),
    );
  },
};

/** Sign-in calls go to the web server's /session routes, which keep tokens out of the browser. */
export const session = {
  post: <T>(
    path:
      | 'otp'
      | 'signup'
      | 'verify'
      | 'mfa'
      | 'profile'
      | 'logout'
      | 'onboarding/draft'
      | 'onboarding/complete'
      | 'onboarding/another',
    json: unknown,
  ) =>
    fetch(`/session/${path}`, {
      method: 'POST',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(json),
    }).then(async (res) => {
      if (res.status === 204) return undefined as T;
      if (res.ok) return (await res.json()) as T;
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new ApiFailure(
        res.status,
        body.code ?? 'error',
        body.message ?? 'Something went wrong.',
      );
    }),
};
