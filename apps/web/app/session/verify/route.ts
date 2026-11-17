// Sign-in, step 2: check the code. Tokens go into httpOnly cookies; the browser gets only the
// profiles this login can act as. With exactly one, it is chosen straight away.
import { OtpVerify } from '@campusverse/contracts';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  clientIp,
  COOKIE,
  CSRF_HEADER,
  CSRF_VALUE,
  storeProfile,
  storeTokens,
  type Tokens,
} from '../../../lib/session';

type Profile = { orgId: string; personId: string; orgName: string; personName: string };

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE) {
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  }
  const input = (await req.json()) as { phone?: string; code?: string };
  const deviceId = (await cookies()).get(COOKIE.device)?.value;
  const body = OtpVerify.safeParse({
    phone: input.phone,
    code: input.code,
    device: { label: 'Web browser', ...(deviceId ? { id: deviceId } : {}) },
  });
  if (!body.success)
    return NextResponse.json({ code: 'invalid_code', message: 'Check the code.' }, { status: 400 });

  const ip = clientIp(req.headers);
  const res = await fetch(`${API_URL}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body.data),
  });
  if (!res.ok)
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });

  const { tokens, profiles } = (await res.json()) as { tokens: Tokens; profiles: Profile[] };
  // A new sign-in starts clean: a profile chosen by an earlier sign-in on this browser (another
  // account) must not carry over, or a new account skips onboarding and its calls are refused.
  await clearSession();
  await storeTokens(tokens);
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) await storeProfile(only.orgId, only.personId);
  return NextResponse.json({ profiles, chosen: !!only });
}
