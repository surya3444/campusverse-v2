import { loadEnv } from '@campusverse/config';
import { deriveKeys, parseFieldKeys } from '@campusverse/crypto';
import { createDb, createRedis, schema } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { fromBase32, hotp, stepAt } from '../domain/totp.js';
import {
  authenticate,
  completeMfa,
  confirmMfa,
  createOtp,
  disableMfa,
  mfaStatus,
  requestPhoneOtp,
  signInWithPhone,
  startMfaSetup,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const keys = deriveKeys(parseFieldKeys(env.FIELD_KEYS), 'identity-mfa');
const sent = new Map<string, string>();
const otp = createOtp({
  redis,
  pepper: env.AUTH_PEPPER,
  sender: { send: async (phone, code) => void sent.set(phone, code) },
});
const device = { label: 'Synthetic laptop' };
/** The code an authenticator app would show now, `drift` steps from now. */
const appCode = (secret: string, drift = 0) =>
  hotp(fromBase32(secret), stepAt(Date.now() / 1000) + drift);

afterAll(async () => {
  redis.disconnect();
  await close();
});

async function account() {
  const phone = `+919${randomInt(100_000_000, 999_999_999)}`;
  const [acc] = await db.insert(schema.account).values({}).returning({ id: schema.account.id });
  await db
    .insert(schema.loginIdentifier)
    .values({ kind: 'phone', value: phone, accountId: acc!.id });
  return { phone, accountId: acc!.id };
}
async function phoneSignIn(phone: string) {
  await requestPhoneOtp(db, otp, { phone, ip: `10.0.${randomInt(0, 255)}.${randomInt(1, 254)}` });
  return signInWithPhone(db, otp, { phone, code: sent.get(phone)!, device });
}

describe('two-step sign-in with an authenticator app', () => {
  it('is switched on only by a working code, then asked at every sign-in', async () => {
    const { phone, accountId } = await account();
    const { secret, uri } = await startMfaSetup(db, keys, { accountId, label: 'Synthetic staff' });
    expect(uri).toContain(`secret=${secret}`);
    // The secret is sealed: the database never holds it in the clear.
    const [row] = await db.execute<{ secret: Buffer }>(
      sql`select secret from identity.mfa_secret where account_id = ${accountId}`,
    );
    expect(row!.secret.includes(Buffer.from(secret))).toBe(false);

    // Not on yet: signing in still starts a session straight away.
    expect(await phoneSignIn(phone)).toHaveProperty('accessToken');
    await expect(confirmMfa(db, keys, { accountId, code: '000000' })).rejects.toMatchObject({
      code: 'wrong_code',
    });
    await confirmMfa(db, keys, { accountId, code: appCode(secret) });
    expect(await mfaStatus(db, accountId)).toEqual({ enabled: true });
    await expect(startMfaSetup(db, keys, { accountId, label: 'x' })).rejects.toMatchObject({
      code: 'already_on',
    });

    // Now sign-in stops at a challenge; the next step's code finishes it.
    const first = await phoneSignIn(phone);
    if (!first || !('mfa' in first)) throw new Error('expected a challenge');
    await expect(
      completeMfa(db, keys, { challenge: first.mfa.challenge, code: '000000' }),
    ).rejects.toMatchObject({ code: 'wrong_code' });
    const tokens = await completeMfa(db, keys, {
      challenge: first.mfa.challenge,
      code: appCode(secret, 1),
    });
    expect((await authenticate(db, tokens.accessToken))?.accountId).toBe(accountId);
    // The challenge is used, and the same code can't open another.
    await expect(
      completeMfa(db, keys, { challenge: first.mfa.challenge, code: appCode(secret, 1) }),
    ).rejects.toMatchObject({ code: 'challenge_ended' });
    const second = await phoneSignIn(phone);
    if (!second || !('mfa' in second)) throw new Error('expected a challenge');
    await expect(
      completeMfa(db, keys, { challenge: second.mfa.challenge, code: appCode(secret, 1) }),
    ).rejects.toMatchObject({ code: 'wrong_code' });

    // Switching it off needs a current code.
    await expect(disableMfa(db, keys, { accountId, code: '000000' })).rejects.toMatchObject({
      code: 'wrong_code',
    });
  });

  it('ends a challenge after five tries', async () => {
    const { phone, accountId } = await account();
    const { secret } = await startMfaSetup(db, keys, { accountId, label: 'Synthetic staff' });
    await confirmMfa(db, keys, { accountId, code: appCode(secret) });
    const c = await phoneSignIn(phone);
    if (!c || !('mfa' in c)) throw new Error('expected a challenge');
    for (let i = 0; i < 5; i++)
      await expect(
        completeMfa(db, keys, { challenge: c.mfa.challenge, code: '000000' }),
      ).rejects.toThrow();
    await expect(
      completeMfa(db, keys, { challenge: c.mfa.challenge, code: appCode(secret, 1) }),
    ).rejects.toMatchObject({ code: 'challenge_ended' });
  });
});
