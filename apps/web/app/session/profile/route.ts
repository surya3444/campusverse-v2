// Sign-in, step 3 (shared phones, several schools): choose who to act as. The choice is checked
// against the API's list for this login before it is stored.
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { API_URL, COOKIE, CSRF_HEADER, CSRF_VALUE, storeProfile } from '../../../lib/session';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  }
  const { orgId, personId } = (await req.json()) as { orgId?: string; personId?: string };
  const access = (await cookies()).get(COOKIE.access)?.value;
  if (!access || !orgId || !personId) {
    return NextResponse.json(
      { code: 'unauthenticated', message: 'Please sign in.' },
      { status: 401 },
    );
  }
  const res = await fetch(`${API_URL}/api/v1/auth/profiles`, {
    headers: { authorization: `Bearer ${access}` },
  });
  if (!res.ok)
    return NextResponse.json(
      { code: 'unauthenticated', message: 'Please sign in.' },
      { status: 401 },
    );
  const profiles = (await res.json()) as { orgId: string; personId: string }[];
  if (!profiles.some((p) => p.orgId === orgId && p.personId === personId)) {
    return NextResponse.json(
      { code: 'forbidden', message: 'Not one of your profiles.' },
      { status: 403 },
    );
  }
  await storeProfile(orgId, personId);
  return NextResponse.json({ ok: true });
}
