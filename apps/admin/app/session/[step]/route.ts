// Passkey enrolment and sign-in pass through here, so the session token goes straight into an
// httpOnly cookie and never reaches the page.
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  CSRF_HEADER,
  CSRF_VALUE,
  sessionToken,
  storeSession,
} from '../../../lib/session';

const STEPS: Record<string, string> = {
  'enrol-options': 'enrol/options',
  'enrol-verify': 'enrol/verify',
  'sign-in-options': 'sign-in/options',
  'sign-in-verify': 'sign-in/verify',
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  // Sign-out is a plain form post (works before scripts load); the browser vouches it is ours.
  const sameSite =
    req.headers.get(CSRF_HEADER) === CSRF_VALUE ||
    (step === 'sign-out' && req.headers.get('sec-fetch-site') === 'same-origin');
  if (!sameSite)
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  if (step === 'sign-out') {
    const token = await sessionToken();
    if (token)
      await fetch(`${API_URL}/api/v1/admin/auth/sign-out`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
    await clearSession();
    return NextResponse.redirect(new URL('/sign-in', req.url), 303);
  }
  const path = STEPS[step];
  if (!path) return NextResponse.json({ code: 'not_found', message: 'Not found' }, { status: 404 });
  const res = await fetch(`${API_URL}/api/v1/admin/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
  });
  const body = (await res.json()) as { token?: string; expiresAt?: string; staff?: unknown };
  if (res.ok && body.token && body.expiresAt) {
    await storeSession(body.token, body.expiresAt);
    return NextResponse.json({ staff: body.staff });
  }
  return NextResponse.json(body, { status: res.status });
}
