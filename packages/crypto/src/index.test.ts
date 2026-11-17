import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveKeys, open, parseFieldKeys, seal } from './index.js';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');

describe('field encryption', () => {
  it('round-trips, and never stores the plaintext', () => {
    const keys = parseFieldKeys(`1:${k1}`);
    const sealed = seal(keys, '234123412346', 'aadhaar:person-1');
    expect(sealed.includes(Buffer.from('234123412346'))).toBe(false);
    expect(open(keys, sealed, 'aadhaar:person-1')).toBe('234123412346');
  });

  it('the same value seals differently each time', () => {
    const keys = parseFieldKeys(`1:${k1}`);
    expect(seal(keys, 'x', 'c').equals(seal(keys, 'x', 'c'))).toBe(false);
  });

  it('refuses a value that was altered or copied to another person', () => {
    const keys = parseFieldKeys(`1:${k1}`);
    const sealed = seal(keys, '234123412346', 'aadhaar:person-1');
    expect(() => open(keys, sealed, 'aadhaar:person-2')).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => open(keys, tampered, 'aadhaar:person-1')).toThrow();
  });

  it('rotates: new values use the newest key, old values still open', () => {
    const old = seal(parseFieldKeys(`1:${k1}`), 'old', 'c');
    const both = parseFieldKeys(`1:${k1},2:${k2}`);
    expect(seal(both, 'new', 'c')[0]).toBe(2);
    expect(open(both, old, 'c')).toBe('old');
    expect(() => open(parseFieldKeys(`2:${k2}`), old, 'c')).toThrow(/unreadable/);
  });

  it('rejects malformed key settings', () => {
    expect(() => parseFieldKeys('')).toThrow();
    expect(() => parseFieldKeys('1:short')).toThrow();
    expect(() => parseFieldKeys(`0:${k1}`)).toThrow();
  });
});

describe('derived vault keys', () => {
  it('derive different keys that cannot open each other’s values', () => {
    const base = parseFieldKeys(`1:${Buffer.alloc(32, 7).toString('base64')}`);
    const health = deriveKeys(base, 'health');
    expect(health.current).toBe(1);
    expect(health.keys[1]!.equals(base.keys[1]!)).toBe(false);
    const sealed = seal(health, 'Allergic to peanuts', 'ctx');
    expect(open(health, sealed, 'ctx')).toBe('Allergic to peanuts');
    expect(() => open(base, sealed, 'ctx')).toThrow();
    expect(deriveKeys(base, 'health').keys[1]!.equals(health.keys[1]!)).toBe(true);
  });
});
