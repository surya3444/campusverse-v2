// Field-level encryption for the most sensitive values (Aadhaar, APAAR, PAN, bank, health).
// AES-256-GCM: confidential and tamper-evident. Sealed values carry their key version, so keys
// can rotate: add a new version, re-seal in the background, retire the old one.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export type FieldKeys = { current: number; keys: Record<number, Buffer> };

/** Reads keys from config: "1:<base64 32 bytes>,2:<base64 32 bytes>"; the highest is current. */
export function parseFieldKeys(spec: string): FieldKeys {
  const keys: Record<number, Buffer> = {};
  for (const part of spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [v, b64 = ''] = part.split(':');
    const version = Number(v);
    const key = Buffer.from(b64, 'base64');
    if (!Number.isInteger(version) || version < 1 || version > 255 || key.length !== 32) {
      throw new Error('Field keys must look like "1:<base64 of 32 bytes>"');
    }
    keys[version] = key;
  }
  const versions = Object.keys(keys).map(Number);
  if (versions.length === 0) throw new Error('At least one field key is required');
  return { current: Math.max(...versions), keys };
}

/** [version 1 byte][iv 12][tag 16][ciphertext]. The context binds a value to its place. */
export function seal(k: FieldKeys, plaintext: string, context: string): Buffer {
  const key = k.keys[k.current];
  if (!key) throw new Error('Current field key missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([k.current]), iv, cipher.getAuthTag(), body]);
}

/** Opens a sealed value. Throws if it was altered, moved to another context, or the key is gone. */
export function open(k: FieldKeys, sealed: Buffer, context: string): string {
  const version = sealed[0];
  const key = version === undefined ? undefined : k.keys[version];
  if (!key || sealed.length < 29) throw new Error('Sealed value unreadable');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString('utf8');
}

/**
 * A separate key set for one vault (health, rule book §12.4 decision 13), derived from the field
 * keys with HKDF when the vault has no keys of its own. Same versions, different keys: a value
 * sealed for the vault never opens with the field keys, and the reverse.
 */
export function deriveKeys(base: FieldKeys, purpose: string): FieldKeys {
  const keys: Record<number, Buffer> = {};
  for (const [v, key] of Object.entries(base.keys))
    keys[Number(v)] = Buffer.from(
      hkdfSync('sha256', key, Buffer.alloc(0), `campusverse:${purpose}`, 32),
    );
  return { current: base.current, keys };
}
