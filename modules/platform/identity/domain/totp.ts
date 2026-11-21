// Time-based one-time codes for authenticator apps (RFC 6238 over RFC 4226: HMAC-SHA1, 30-second
// steps, six digits), as Google Authenticator, Microsoft Authenticator and others use. Pure.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('base32: bad character');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The six-digit code for a counter (RFC 4226). */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = (h[h.length - 1] ?? 0) & 15;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

export const stepAt = (unixSeconds: number) => Math.floor(unixSeconds / STEP_SECONDS);

/**
 * The step a typed code matches, one step either side for clock drift, or null. A step at or
 * before `lastStep` is refused, so a code works once.
 */
export function matchStep(
  secret: Buffer,
  code: string,
  unixSeconds: number,
  lastStep: number | null,
): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const now = stepAt(unixSeconds);
  for (const s of [now - 1, now, now + 1])
    if ((lastStep === null || s > lastStep) && hotp(secret, s) === typed) return s;
  return null;
}

/** What authenticator apps scan: otpauth://totp/Issuer:label?secret=…&issuer=… */
export const otpauthUri = (secretBase32: string, label: string, issuer = 'Campusverse') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
