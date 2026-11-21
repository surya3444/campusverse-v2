// Sign-in, step 3 when two-step sign-in is on: the code from the authenticator app finishes the
// challenge kept in an httpOnly cookie by step 2. Same result as step 2 without it.
import { MfaCode } from '@campusverse/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import {
  API_URL,
  clearSession,
  CSRF_HEADER,
  CSRF_VALUE,
  dropMfaChallenge,
  storeProfile,
  storeTokens,
  takeMfaChallenge,
  type Tokens,
} from '../../../lib/session';

type Profile = { orgId: string; personId: string; orgName: string; personName: string };

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== CSRF_VALUE)
    return NextResponse.json({ code: 'csrf', message: 'Request refused.' }, { status: 403 });
  const challenge = await takeMfaChallenge();
  if (!challenge)
    return NextResponse.json({ code: 'challenge_ended', message: 'Start again.' }, { status: 401 });
  const body = MfaCode.safeParse(await req.json());
  if (!body.success)
    return NextResponse.json({ code: 'wrong_code', message: 'Check the code.' }, { status: 400 });
  const res = await fetch(`${API_URL}/api/v1/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge, code: body.data.code }),
  });
  if (!res.ok)
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  const { tokens, profiles } = (await res.json()) as { tokens: Tokens; profiles: Profile[] };
  await clearSession();
  await dropMfaChallenge();
  await storeTokens(tokens);
  const only = profiles.length === 1 ? profiles[0] : undefined;
  if (only) await storeProfile(only.orgId, only.personId);
  return NextResponse.json({ profiles, chosen: !!only });
}
