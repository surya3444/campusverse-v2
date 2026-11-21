// Two-step sign-in with an authenticator app (rule book §12.4 decision 10, "MFA for staff"). A
// person adds it from their profile: a secret is made, shown once as a QR code, and switched on
// only after the first code from their app works. From then on, signing in (phone code or Google)
// stops at a challenge, and a session starts only after a fresh code from the app.
import { open, seal, type FieldKeys } from '@campusverse/crypto';
import type { Db } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { base32, matchStep, otpauthUri } from '../domain/totp.js';
import { startSession, type Tokens } from './sessions.js';

const CHALLENGE_MS = 5 * 60_000;
const CHALLENGE_TRIES = 5;
const secretCtx = (accountId: string) => `mfa:${accountId}`;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);

export class MfaError extends Error {
  constructor(readonly code: 'wrong_code' | 'not_set_up' | 'already_on' | 'challenge_ended') {
    super(`mfa: ${code}`);
    this.name = 'MfaError';
  }
}

/** What a sign-in returns when the account has two-step sign-in on. */
export type MfaChallenge = { mfa: { challenge: string } };

async function secretOf(db: Db, keys: FieldKeys, accountId: string) {
  const [row] = await db.execute<{ secret: Buffer; on: boolean; lastStep: string | null }>(sql`
    select secret, enabled_at is not null as on, last_step::text as "lastStep"
    from identity.mfa_secret where account_id = ${accountId}`);
  if (!row) return null;
  return {
    secret: Buffer.from(open(keys, row.secret, secretCtx(accountId)), 'base64'),
    on: row.on,
    lastStep: row.lastStep === null ? null : Number(row.lastStep),
  };
}

export async function mfaStatus(db: Db, accountId: string): Promise<{ enabled: boolean }> {
  const [row] = await db.execute<{ on: boolean }>(sql`
    select enabled_at is not null as on from identity.mfa_secret where account_id = ${accountId}`);
  return { enabled: row?.on ?? false };
}

/**
 * Makes a new secret for this account (replacing an unfinished one) and returns what the app
 * scans. Refused while two-step sign-in is on: turn it off first.
 */
export async function startMfaSetup(
  db: Db,
  keys: FieldKeys,
  input: { accountId: string; label: string },
): Promise<{ secret: string; uri: string }> {
  if ((await mfaStatus(db, input.accountId)).enabled) throw new MfaError('already_on');
  const raw = randomBytes(20);
  const sealed = seal(keys, raw.toString('base64'), secretCtx(input.accountId));
  await db.execute(sql`
    insert into identity.mfa_secret (account_id, secret) values (${input.accountId}, ${sealed})
    on conflict (account_id) do update set secret = excluded.secret, enabled_at = null,
      last_step = null, created_at = now()`);
  const secret = base32(raw);
  return { secret, uri: otpauthUri(secret, input.label) };
}

/** Switches two-step sign-in on once a code from the app works. */
export async function confirmMfa(
  db: Db,
  keys: FieldKeys,
  input: { accountId: string; code: string },
): Promise<void> {
  const s = await secretOf(db, keys, input.accountId);
  if (!s) throw new MfaError('not_set_up');
  if (s.on) throw new MfaError('already_on');
  const step = matchStep(s.secret, input.code, nowSeconds(), s.lastStep);
  if (step === null) throw new MfaError('wrong_code');
  await db.execute(sql`
    update identity.mfa_secret set enabled_at = now(), last_step = ${step}
    where account_id = ${input.accountId}`);
}

/** Switches it off; a current code from the app is needed, so a borrowed session can't. */
export async function disableMfa(
  db: Db,
  keys: FieldKeys,
  input: { accountId: string; code: string },
): Promise<void> {
  const s = await secretOf(db, keys, input.accountId);
  if (!s?.on) throw new MfaError('not_set_up');
  if (matchStep(s.secret, input.code, nowSeconds(), s.lastStep) === null)
    throw new MfaError('wrong_code');
  await db.execute(sql`delete from identity.mfa_secret where account_id = ${input.accountId}`);
}

/**
 * After the first step of sign-in: a session straight away, or a challenge when the account has
 * two-step sign-in on. The challenge token is returned once; only its hash is kept.
 */
export async function sessionOrChallenge(
  db: Db,
  accountId: string,
  deviceId: string,
): Promise<Tokens | MfaChallenge> {
  if (!(await mfaStatus(db, accountId)).enabled) return startSession(db, accountId, deviceId);
  const challenge = randomBytes(32).toString('base64url');
  await db.execute(sql`
    insert into identity.mfa_challenge (token_hash, account_id, device_id, expires_at)
    values (${hash(challenge)}, ${accountId}, ${deviceId}, now() + make_interval(secs => ${CHALLENGE_MS / 1000}))`);
  return { mfa: { challenge } };
}

/**
 * Completes a challenged sign-in with a code from the app. Five tries, five minutes, once. A
 * wrong code is counted before the answer, and the code's time step can't be used again.
 */
export async function completeMfa(
  db: Db,
  keys: FieldKeys,
  input: { challenge: string; code: string },
): Promise<Tokens> {
  const [c] = await db.execute<{ id: string; accountId: string; deviceId: string }>(sql`
    update identity.mfa_challenge set tries = tries + 1
    where token_hash = ${hash(input.challenge)} and used_at is null and expires_at > now()
      and tries < ${CHALLENGE_TRIES}
    returning id::text, account_id::text as "accountId", device_id::text as "deviceId"`);
  if (!c) throw new MfaError('challenge_ended');
  const s = await secretOf(db, keys, c.accountId);
  if (!s?.on) throw new MfaError('challenge_ended');
  const step = matchStep(s.secret, input.code, nowSeconds(), s.lastStep);
  if (step === null) throw new MfaError('wrong_code');
  // Both guarded, so two tabs racing with the same code can't both win.
  const used = await db.execute(sql`
    update identity.mfa_secret set last_step = ${step}
    where account_id = ${c.accountId} and (last_step is null or last_step < ${step})
    returning 1`);
  const done = await db.execute(sql`
    update identity.mfa_challenge set used_at = now() where id = ${c.id} and used_at is null
    returning 1`);
  if (used.length === 0 || done.length === 0) throw new MfaError('wrong_code');
  return startSession(db, c.accountId, c.deviceId);
}
