// Onboarding for an invited organisation admin: signed in, but with no organisation (so no
// profile) yet, which the /api/v1 pass-through needs. The token stays in its httpOnly cookie.
// When onboarding completes, the new profile is chosen and the admin goes on to setup.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  COOKIE,
  CSRF_HEADER,
  CSRF_VALUE,
  storeProfile,
  storeTokens,
  type Tokens,
} from '../../../../lib/session';

const STEPS = new Set(['', 'draft', 'complete', 'another']);

async function handle(req: NextRequest, { params }: { params: Promise<{ step?: string[] }> }) {
  const step = (await params).step?.join('/') ?? '';
  if (!STEPS.has(step) || (req.method === 'GET') !== (step === ''))
    return NextResponse.json({ code: 'not_found', message: 'Not found' }, { status: 404 });
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== CSRF_VALUE)
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  const jar = await cookies();
  const refreshToken = jar.get(COOKIE.refresh)?.value;
  if (!refreshToken)
    return NextResponse.json(
      { code: 'unauthenticated', message: 'Please sign in.' },
      { status: 401 },
    );

  const body = req.method === 'GET' ? undefined : await req.text();
  const send = (access: string | undefined) =>
    fetch(`${API_URL}/api/v1/onboarding${step ? `/${step}` : ''}`, {
      method: req.method,
      headers: {
        ...(access ? { authorization: `Bearer ${access}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
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
      return NextResponse.json(
        { code: 'session_ended', message: 'Please sign in again.' },
        { status: 401 },
      );
    }
    const { tokens } = (await refreshed.json()) as { tokens: Tokens };
    await storeTokens(tokens);
    res = await send(tokens.accessToken);
  }
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const json = (await res.json()) as { orgId?: string; personId?: string };
  if (step === 'complete' && res.ok && json.orgId && json.personId)
    await storeProfile(json.orgId, json.personId);
  return NextResponse.json(json, { status: res.status });
}

export { handle as GET, handle as POST };
