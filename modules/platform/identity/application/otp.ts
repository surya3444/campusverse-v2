import type { Redis } from '@campusverse/db';
import { keyedHash, newOtpCode, sameHash } from '../domain/secrets.js';

/** Delivers a code. Real providers (MSG91, WhatsApp) arrive with the notification engine. */
export type OtpSender = { send(phone: string, code: string): Promise<void> };

export class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests');
    this.name = 'RateLimited';
  }
}

const CODE_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;
const SENDS_PER_PHONE = 3;
const SENDS_PER_IP = 20;

// Atomic: count the attempt only if a live code exists, so an expired key is never recreated.
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local n = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return { n, redis.call('HGET', KEYS[1], 'code') }`;

/**
 * Phone OTP state lives only in Redis, hashed with the pepper. If Redis is unavailable every
 * call throws, so no code is sent or accepted without its limits.
 */
export function createOtp({
  redis,
  pepper,
  sender,
  scope = 'otp',
}: {
  redis: Redis;
  pepper: string;
  sender: OtpSender;
  /** Keeps codes apart by purpose: a code for the online application form never signs anyone in. */
  scope?: string;
}) {
  const codeKey = (phone: string) => `${scope}:${keyedHash(pepper, phone)}`;

  async function limit(key: string, max: number) {
    const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const fullKey = `${key}:${window}`;
    const [[, count]] = (await redis
      .multi()
      .incr(fullKey)
      .expire(fullKey, WINDOW_SECONDS)
      .exec()) as [[Error | null, number]];
    if (count > max)
      throw new RateLimited(WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % WINDOW_SECONDS));
  }

  /** Counts the send against phone and IP limits, whether or not a code is then sent. */
  async function checkSendLimits(phone: string, ip: string) {
    await limit(`rl:${scope}-send:ip:${keyedHash(pepper, ip)}`, SENDS_PER_IP);
    await limit(`rl:${scope}-send:phone:${keyedHash(pepper, phone)}`, SENDS_PER_PHONE);
  }

  /** Any other limit in this scope: at most `max` per 15 minutes for this name and id (an IP). */
  async function checkLimit(name: string, id: string, max: number) {
    await limit(`rl:${scope}-${name}:${keyedHash(pepper, id)}`, max);
  }

  async function issue(phone: string) {
    const code = newOtpCode();
    const key = codeKey(phone);
    await redis
      .multi()
      .del(key)
      .hset(key, { code: keyedHash(pepper, `${phone}:${code}`), attempts: 0 })
      .expire(key, CODE_TTL_SECONDS)
      .exec();
    await sender.send(phone, code);
  }

  /** True once per issued code. Wrong codes count toward the attempt limit. */
  async function verify(phone: string, code: string): Promise<boolean> {
    const key = codeKey(phone);
    const state = (await redis.eval(ATTEMPT, 1, key)) as [number, string] | null;
    if (!state) return false;
    const [attempts, stored] = state;
    if (attempts > MAX_ATTEMPTS) {
      await redis.del(key);
      return false;
    }
    if (!sameHash(stored, keyedHash(pepper, `${phone}:${code}`))) return false;
    // Only the caller that deletes the key wins, so two racing correct guesses yield one login.
    return (await redis.del(key)) === 1;
  }

  return { checkSendLimits, checkLimit, issue, verify };
}

export type Otp = ReturnType<typeof createOtp>;
