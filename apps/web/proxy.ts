// Visitors who aren't signed in see the landing page at /, with the address left as /. Signed
// in (a session and a chosen profile, as lib/session's hasProfile), / is today's overview. The
// design review of the home screen stays at /?state=… and /?at=… for screenshots and tests.
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const signedIn =
    req.cookies.has('cv_rt') && req.cookies.has('cv_org') && req.cookies.has('cv_person');
  if (signedIn || searchParams.has('state') || searchParams.has('at')) return NextResponse.next();
  return NextResponse.rewrite(new URL('/welcome', req.url));
}

export const config = { matcher: '/' };
