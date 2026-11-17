// Self-serve sign-up (rule book §11): open an invite and send a code. Always answers the same way.
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, clientIp, CSRF_HEADER, CSRF_VALUE } from '../../../lib/session';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  }
  const ip = clientIp(req.headers);
  const res = await fetch(`${API_URL}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: await req.text(),
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
