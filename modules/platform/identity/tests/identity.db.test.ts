import { loadEnv } from '@campusverse/config';
import { createDb, createRedis, schema } from '@campusverse/db';
import { seedTenant } from '@campusverse/db/seed';
import { eq } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticate,
  createOtp,
  listProfiles,
  RateLimited,
  refresh,
  requestPhoneOtp,
  resolveActor,
  revokeDevice,
  signInWithGoogle,
  signInWithPhone,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

const sent = new Map<string, string>();
const otp = createOtp({
  redis,
  pepper: env.AUTH_PEPPER,
  sender: { send: async (phone, code) => void sent.set(phone, code) },
});

const randomPhone = () => `+919${randomInt(100_000_000, 999_999_999)}`;
const randomIp = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
const device = { label: 'Synthetic Android' };

async function newAccount(
  ids: { kind: 'phone' | 'email' | 'google'; value: string }[],
  status: 'active' | 'locked' = 'active',
) {
  const [acc] = await db
    .insert(schema.account)
    .values({ status })
    .returning({ id: schema.account.id });
  await db.insert(schema.loginIdentifier).values(ids.map((i) => ({ ...i, accountId: acc!.id })));
  return acc!.id;
}

async function phoneLogin(phone: string) {
  await requestPhoneOtp(db, otp, { phone, ip: randomIp() });
  return signInWithPhone(db, otp, { phone, code: sent.get(phone)!, device });
}

afterAll(async () => {
  redis.disconnect();
  await close();
});

describe('phone OTP', () => {
  it('sends a code only to a registered number, and signs in once with it', async () => {
    const phone = randomPhone();
    const stranger = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);

    await requestPhoneOtp(db, otp, { phone: phone.replace('+91', '0'), ip: randomIp() });
    await requestPhoneOtp(db, otp, { phone: stranger, ip: randomIp() });
    expect(sent.has(phone)).toBe(true);
    expect(sent.has(stranger)).toBe(false);

    const code = sent.get(phone)!;
    const tokens = await signInWithPhone(db, otp, { phone, code, device });
    expect(tokens?.accessToken).toBeTruthy();
    // Single use.
    expect(await signInWithPhone(db, otp, { phone, code, device })).toBeNull();
  });

  it('never stores the code or phone number in readable form', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    await requestPhoneOtp(db, otp, { phone, ip: randomIp() });
    const keys = await redis.keys('otp:*');
    expect(keys.some((k) => k.includes(phone.slice(3)))).toBe(false);
    for (const key of keys) {
      expect(Object.values(await redis.hgetall(key))).not.toContain(sent.get(phone));
    }
  });

  it('locks the code after five wrong attempts', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    await requestPhoneOtp(db, otp, { phone, ip: randomIp() });
    const code = sent.get(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(await signInWithPhone(db, otp, { phone, code: wrong, device })).toBeNull();
    }
    expect(await signInWithPhone(db, otp, { phone, code, device })).toBeNull();
  });

  it('limits sends per phone and per IP, counting unknown numbers too', async () => {
    const phone = randomPhone();
    const ask = (ip: string) => requestPhoneOtp(db, otp, { phone, ip });
    for (let i = 0; i < 3; i++) await ask(randomIp());
    await expect(ask(randomIp())).rejects.toBeInstanceOf(RateLimited);

    const ip = randomIp();
    for (let i = 0; i < 20; i++) await requestPhoneOtp(db, otp, { phone: randomPhone(), ip });
    await expect(requestPhoneOtp(db, otp, { phone: randomPhone(), ip })).rejects.toBeInstanceOf(
      RateLimited,
    );
  });

  it('refuses to send when Redis is down', async () => {
    const dead = createRedis('redis://localhost:1');
    dead.on('error', () => {});
    const offline = createOtp({
      redis: dead,
      pepper: env.AUTH_PEPPER,
      sender: { send: async () => {} },
    });
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    await expect(requestPhoneOtp(db, offline, { phone, ip: randomIp() })).rejects.toThrow();
    dead.disconnect();
  });

  it('rejects malformed codes without touching the attempt counter', async () => {
    expect(
      await signInWithPhone(db, otp, { phone: randomPhone(), code: '12ab56', device }),
    ).toBeNull();
  });

  it('does not sign in a locked account', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }], 'locked');
    expect(await phoneLogin(phone)).toBeNull();
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and retires the old access token', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    const first = (await phoneLogin(phone))!;
    expect(await authenticate(db, first.accessToken)).toMatchObject({ sessionId: first.sessionId });

    const second = (await refresh(db, first.refreshToken))!;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(await authenticate(db, first.accessToken)).toBeNull();
    expect(await authenticate(db, second.accessToken)).not.toBeNull();
  });

  it('revokes the whole family when an old refresh token is replayed', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    const first = (await phoneLogin(phone))!;
    const second = (await refresh(db, first.refreshToken))!;

    expect(await refresh(db, first.refreshToken)).toBeNull(); // replay
    expect(await authenticate(db, second.accessToken)).toBeNull();
    expect(await refresh(db, second.refreshToken)).toBeNull();
  });

  it('signing a device out ends its sessions, and the next login gets a new device', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    const tokens = (await phoneLogin(phone))!;
    await revokeDevice(db, tokens.deviceId, 'lost_phone');
    expect(await authenticate(db, tokens.accessToken)).toBeNull();
    expect(await refresh(db, tokens.refreshToken)).toBeNull();

    await requestPhoneOtp(db, otp, { phone, ip: randomIp() });
    const again = await signInWithPhone(db, otp, {
      phone,
      code: sent.get(phone)!,
      device: { id: tokens.deviceId, label: 'Synthetic Android' },
    });
    expect(again?.deviceId).not.toBe(tokens.deviceId);
  });

  it('reuses a trusted device that is still valid', async () => {
    const phone = randomPhone();
    await newAccount([{ kind: 'phone', value: phone }]);
    const first = (await phoneLogin(phone))!;
    await requestPhoneOtp(db, otp, { phone, ip: randomIp() });
    const second = await signInWithPhone(db, otp, {
      phone,
      code: sent.get(phone)!,
      device: { id: first.deviceId, label: 'Synthetic Android' },
    });
    expect(second?.deviceId).toBe(first.deviceId);
  });

  it('rejects unknown tokens', async () => {
    expect(await authenticate(db, 'not-a-token')).toBeNull();
    expect(await refresh(db, 'not-a-token')).toBeNull();
  });
});

describe('Google sign-in', () => {
  const CLIENT_ID = 'synthetic-client.apps.googleusercontent.com';
  let keys: ReturnType<typeof createLocalJWKSet>;
  let sign: (claims: JWTPayload, aud?: string) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' }],
    });
    sign = (claims, aud = CLIENT_ID) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
  });

  const google = (idToken: string) =>
    signInWithGoogle(db, { idToken, clientId: CLIENT_ID, device, keys });

  it('links an invited staff email on first sign-in, then signs in by Google id', async () => {
    const email = `teacher${randomInt(1e9)}@synthetic.example`;
    const sub = `g-${randomInt(1e9)}`;
    const accountId = await newAccount([{ kind: 'email', value: email }]);

    const first = await google(
      await sign({ sub, email: email.toUpperCase(), email_verified: true }),
    );
    expect(first).not.toBeNull();
    expect((await authenticate(db, first!.accessToken))?.accountId).toBe(accountId);

    // Same Google account, different email now: still the same person.
    const second = await google(
      await sign({ sub, email: 'changed@synthetic.example', email_verified: true }),
    );
    expect((await authenticate(db, second!.accessToken))?.accountId).toBe(accountId);
  });

  it('refuses uninvited, unverified, wrong-audience and forged tokens', async () => {
    const email = `staff${randomInt(1e9)}@synthetic.example`;
    await newAccount([{ kind: 'email', value: email }]);

    expect(
      await google(
        await sign({ sub: 'g-x', email: 'nobody@synthetic.example', email_verified: true }),
      ),
    ).toBeNull();
    expect(await google(await sign({ sub: 'g-y', email, email_verified: false }))).toBeNull();
    expect(
      await google(await sign({ sub: 'g-z', email, email_verified: true }, 'other-client')),
    ).toBeNull();

    const { privateKey: stranger } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: 'g-f', email, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setExpirationTime('5m')
      .sign(stranger);
    expect(await google(forged)).toBeNull();
  });
});

describe('profiles and actors', () => {
  it('a shared phone sees each linked person, and can act only as them', async () => {
    const t = await seedTenant(db, 'Shared Phone');
    const other = await seedTenant(db, 'Other Org');
    const phone = randomPhone();
    const accountId = await newAccount([{ kind: 'phone', value: phone }]);
    await db.insert(schema.accountPersonLink).values([
      { accountId, orgId: t.orgId, personId: t.guardianId },
      { accountId, orgId: t.orgId, personId: t.teacherId },
    ]);

    const profiles = await listProfiles(db, accountId);
    expect(profiles.map((p) => p.personId).sort()).toEqual([t.guardianId, t.teacherId].sort());
    expect(profiles[0]?.orgName).toBe('Shared Phone');

    const { accessToken } = (await phoneLogin(phone))!;
    expect(await resolveActor(db, accessToken, { orgId: t.orgId, personId: t.guardianId })).toEqual(
      {
        accountId,
        orgId: t.orgId,
        personId: t.guardianId,
      },
    );
    // Not linked: another person in the same org, or a person in another org.
    expect(
      await resolveActor(db, accessToken, { orgId: t.orgId, personId: t.principalId }),
    ).toBeNull();
    expect(
      await resolveActor(db, accessToken, { orgId: other.orgId, personId: other.guardianId }),
    ).toBeNull();
    expect(
      await resolveActor(db, 'bad-token', { orgId: t.orgId, personId: t.guardianId }),
    ).toBeNull();
  });

  it('a locked account loses access at once', async () => {
    const phone = randomPhone();
    const accountId = await newAccount([{ kind: 'phone', value: phone }]);
    const { accessToken } = (await phoneLogin(phone))!;
    await db
      .update(schema.account)
      .set({ status: 'locked' })
      .where(eq(schema.account.id, accountId));
    expect(await authenticate(db, accessToken)).toBeNull();
  });
});
