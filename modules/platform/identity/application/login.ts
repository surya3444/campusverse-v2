import { schema, type Db } from '@campusverse/db';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { normaliseIndianMobile } from '../domain/phone.js';
import type { Otp } from './otp.js';
import { startSession, trustDevice, type Tokens } from './sessions.js';

const { account, loginIdentifier } = schema;

export type DeviceInput = { id?: string; label: string };

async function activeAccountFor(
  db: Db,
  kind: 'phone' | 'email' | 'google',
  value: string,
): Promise<{ accountId: string; identifierId: string } | null> {
  const [row] = await db
    .select({ accountId: account.id, identifierId: loginIdentifier.id })
    .from(loginIdentifier)
    .innerJoin(account, eq(account.id, loginIdentifier.accountId))
    .where(
      and(
        eq(loginIdentifier.kind, kind),
        eq(loginIdentifier.value, value),
        eq(account.status, 'active'),
      ),
    );
  return row ?? null;
}

/**
 * Starts phone login. Limits are counted first, and a code is sent only to a number that
 * belongs to an active account. The caller always answers the same way, so this can't be
 * used to discover which numbers are registered.
 */
export async function requestPhoneOtp(
  db: Db,
  otp: Otp,
  input: { phone: string; ip: string },
): Promise<void> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone) return;
  await otp.checkSendLimits(phone, input.ip);
  if (await activeAccountFor(db, 'phone', phone)) await otp.issue(phone);
}

/** Completes phone login on this device. Null for a wrong, expired or used code. */
export async function signInWithPhone(
  db: Db,
  otp: Otp,
  input: { phone: string; code: string; device: DeviceInput },
): Promise<Tokens | null> {
  const phone = normaliseIndianMobile(input.phone);
  if (!phone || !/^\d{6}$/.test(input.code)) return null;
  if (!(await otp.verify(phone, input.code))) return null;
  const found = await activeAccountFor(db, 'phone', phone);
  if (!found) return null;
  await db
    .update(loginIdentifier)
    .set({ verifiedAt: new Date() })
    .where(eq(loginIdentifier.id, found.identifierId));
  const deviceId = await trustDevice(db, found.accountId, input.device);
  return startSession(db, found.accountId, deviceId);
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let googleKeys: JWTVerifyGetKey | undefined;

/**
 * Staff sign-in with a Google ID token. Only invited staff get in: the Google account must
 * already be linked, or its verified email must match an invited staff email, in which case
 * the Google identity is linked to that account now.
 */
export async function signInWithGoogle(
  db: Db,
  input: { idToken: string; clientId: string; device: DeviceInput; keys?: JWTVerifyGetKey },
): Promise<Tokens | null> {
  const keys =
    input.keys ??
    (googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')));
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(input.idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: input.clientId,
    }));
  } catch {
    return null;
  }
  if (typeof claims.sub !== 'string') return null;

  let found = await activeAccountFor(db, 'google', claims.sub);
  if (!found && claims.email_verified === true && typeof claims.email === 'string') {
    const invited = await activeAccountFor(db, 'email', claims.email.toLowerCase());
    if (invited) {
      const [linked] = await db
        .insert(loginIdentifier)
        .values({
          accountId: invited.accountId,
          kind: 'google',
          value: claims.sub,
          verifiedAt: new Date(),
        })
        .returning({ id: loginIdentifier.id });
      if (!linked) throw new Error('signInWithGoogle: insert returned no row');
      found = { accountId: invited.accountId, identifierId: linked.id };
    }
  }
  if (!found) return null;

  const deviceId = await trustDevice(db, found.accountId, input.device);
  return startSession(db, found.accountId, deviceId);
}
