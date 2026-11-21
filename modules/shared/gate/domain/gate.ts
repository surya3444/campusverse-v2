// Pure rules for the gate (docs/specs/VISITORS_GATE.md). No I/O.

/** An Indian mobile number as +91XXXXXXXXXX, from what a guard types; null if it isn't one. */
export function mobile(text: string): string | null {
  const d = text.replace(/[\s()-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export type Guardian = { personId: string; phones: string[]; restricted: boolean };
export type Collector = { guardianId: string } | { name: string; relation: string; phone: string };

/**
 * Who may collect a child. A guardian on record who isn't restricted; or someone else, unless
 * their phone belongs to a restricted guardian (the same person typed as "someone else").
 */
export function collectorCheck(
  guardians: Guardian[],
  c: Collector,
): 'ok' | 'collector_restricted' | 'collector_not_guardian' {
  if ('guardianId' in c) {
    const g = guardians.find((x) => x.personId === c.guardianId);
    if (!g) return 'collector_not_guardian';
    return g.restricted ? 'collector_restricted' : 'ok';
  }
  return guardians.some((g) => g.restricted && g.phones.includes(c.phone))
    ? 'collector_restricted'
    : 'ok';
}

// Pick-up codes (rule book §13.8 Student Pick-up): six digits to the parent, kept only as a hash
// tied to the pass, five tries, then the office issues a new one.
export const CODE_TRIES = 5;

/** A fresh six-digit code from a random integer source (0 ≤ n < 1 000 000). */
export const pickupCode = (n: number) => String(Math.floor(n) % 1_000_000).padStart(6, '0');

/** The stored hash: the pass id binds the code to one pass. */
export const codeHash = (passId: string, code: string, sha256: (s: string) => string) =>
  sha256(`gate-pickup:${passId}:${code.replace(/\s/g, '')}`);

export type CodeCheck = 'ok' | 'wrong_code' | 'code_locked';

/** Checks a typed code against the pass. `tries` are wrong tries so far. */
export function checkCode(
  stored: string | null,
  tries: number,
  typed: string | undefined,
  hash: (code: string) => string,
): CodeCheck {
  if (stored === null) return 'ok';
  if (tries >= CODE_TRIES) return 'code_locked';
  return typed !== undefined && /^\d{6}$/.test(typed.replace(/\s/g, '')) && hash(typed) === stored
    ? 'ok'
    : 'wrong_code';
}
