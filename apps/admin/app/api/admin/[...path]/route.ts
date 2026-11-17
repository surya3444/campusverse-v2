// Passes the portal's requests to the API's /admin routes with the staff session from the
// httpOnly cookie. Sign-in routes are not reachable through here.
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  CSRF_HEADER,
  CSRF_VALUE,
  sessionToken,
} from '../../../../lib/session';

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ code, message, requestId: '', retryable: false }, { status });

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path;
  if (path[0] === 'auth') return error(404, 'not_found', 'Not found');
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== CSRF_VALUE)
    return error(403, 'csrf', 'Request refused.');
  const token = await sessionToken();
  if (!token) return error(401, 'unauthenticated', 'Please sign in.');
  const body = req.method === 'GET' ? undefined : await req.arrayBuffer();
  const res = await fetch(
    `${API_URL}/api/v1/admin/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`,
    {
      method: req.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(req.headers.get('content-type')
          ? { 'content-type': req.headers.get('content-type') as string }
          : {}),
      },
      ...(body ? { body } : {}),
      cache: 'no-store',
    },
  );
  if (res.status === 401) await clearSession();
  return new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export { handle as GET, handle as POST };
