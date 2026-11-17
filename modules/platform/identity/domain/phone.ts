/**
 * Normalises an Indian mobile number to E.164 (+91 and ten digits starting 6–9).
 * Accepts common forms: 98765 43210, 098765-43210, 919876543210, +91 98765 43210.
 * Returns null for anything else, so callers never store a guess.
 */
export function normaliseIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return match ? `+91${match[1]}` : null;
}
