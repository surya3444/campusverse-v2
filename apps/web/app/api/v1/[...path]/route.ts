// Passes browser requests on to the API with the session from httpOnly cookies. Refreshes an
// expired access token once and retries. Sign-in endpoints are not reachable through here:
// tokens only ever travel between this server and the API.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  clientIp,
  COOKIE,
  CSRF_HEADER,
  CSRF_VALUE,
  storeTokens,
  type Tokens,
} from '../../../../lib/session';

const PASS_HEADERS = ['content-type', 'content-disposition', 'retry-after'];

function error(status: number, code: string, message: string) {
  return NextResponse.json({ code, message, requestId: '', retryable: false }, { status });
}

async function publicCall(req: NextRequest, path: string[]) {
  const ip = clientIp(req.headers);
  const res = await fetch(`${API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}`, {
    method: req.method,
    headers: {
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...(req.headers.get('content-type')
        ? { 'content-type': req.headers.get('content-type') as string }
        : {}),
    },
    ...(req.method === 'GET' ? {} : { body: await req.arrayBuffer() }),
    cache: 'no-store',
  });
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers,
  });
}

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  if (path[0] === 'auth') return error(404, 'not_found', 'Not found');
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return error(403, 'csrf', 'Request refused.');
  }

  // The public online application form: no session, only the visitor's address for rate limits.
  if (path[0] === 'public' && path[1] === 'apply') return publicCall(req, path);

  const jar = await cookies();
  const org = jar.get(COOKIE.org)?.value;
  const person = jar.get(COOKIE.person)?.value;
  const refreshToken = jar.get(COOKIE.refresh)?.value;
  if (!org || !person || !refreshToken) return error(401, 'unauthenticated', 'Please sign in.');

  const body = req.method === 'GET' ? undefined : await req.arrayBuffer();
  const ip = clientIp(req.headers);
  const send = (access: string | undefined) =>
    fetch(`${API_URL}/api/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`, {
      method: req.method,
      headers: {
        ...(access ? { authorization: `Bearer ${access}` } : {}),
        'x-org-id': org,
        'x-person-id': person,
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        ...(req.headers.get('content-type')
          ? { 'content-type': req.headers.get('content-type') as string }
          : {}),
        // Money writes carry it: a retried request returns the same result (finance counter).
        ...(req.headers.get('idempotency-key')
          ? { 'idempotency-key': req.headers.get('idempotency-key') as string }
          : {}),
      },
      ...(body ? { body } : {}),
      cache: 'no-store',
    });

  let res = await send(jar.get(COOKIE.access)?.value);
  if (res.status === 401) {
    const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!refreshed.ok) {
      await clearSession();
      return error(401, 'session_ended', 'Your session ended. Please sign in again.');
    }
    const { tokens } = (await refreshed.json()) as { tokens: Tokens };
    await storeTokens(tokens);
    res = await send(tokens.accessToken);
  }

  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
