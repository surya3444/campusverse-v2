import { describe, expect, it } from 'vitest';
import { base32, fromBase32, hotp, matchStep, otpauthUri, stepAt } from './totp.js';

// RFC 6238 appendix B: the SHA-1 secret "12345678901234567890"; codes are the last six digits.
const secret = Buffer.from('12345678901234567890');

describe('authenticator codes', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(hotp(secret, stepAt(59))).toBe('287082');
    expect(hotp(secret, stepAt(1111111109))).toBe('081804');
    expect(hotp(secret, stepAt(2000000000))).toBe('279037');
  });
  it('round-trips base32', () => {
    expect(base32(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(fromBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(secret);
  });
  it('accepts one step of drift and never the same step twice', () => {
    const t = 1111111109;
    expect(matchStep(secret, '081804', t + 30, null)).toBe(stepAt(t));
    expect(matchStep(secret, '081 804', t, null)).toBe(stepAt(t));
    expect(matchStep(secret, '081804', t, stepAt(t))).toBeNull();
    expect(matchStep(secret, '081804', t + 90, null)).toBeNull();
    expect(matchStep(secret, '12345', t, null)).toBeNull();
  });
  it('writes the URI authenticator apps scan', () => {
    expect(otpauthUri('ABC', 'Asha Rao')).toBe(
      'otpauth://totp/Campusverse%3AAsha%20Rao?secret=ABC&issuer=Campusverse&algorithm=SHA1&digits=6&period=30',
    );
  });
});
