// Sign out: ends the session at the API, then clears the cookies whatever the API says.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, clearSession, COOKIE, CSRF_HEADER, CSRF_VALUE } from '../../../lib/session';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  }
  const access = (await cookies()).get(COOKIE.access)?.value;
  if (access) {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access}` },
    }).catch(() => undefined);
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
