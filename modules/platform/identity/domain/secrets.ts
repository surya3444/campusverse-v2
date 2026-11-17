import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit opaque token for sessions. Only its hash is ever stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

/** Six-digit one-time code from a CSPRNG. */
export const newOtpCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/** Keyed hash so OTPs, phones and IPs never sit in Redis in readable form. */
export const keyedHash = (pepper: string, value: string): string =>
  createHmac('sha256', pepper).update(value).digest('hex');

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
