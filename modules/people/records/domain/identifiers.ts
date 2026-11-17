// Government identifiers: validation and masking. Pure.

// Verhoeff tables (dihedral group D5), used by Aadhaar's check digit.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeff(digits: string, withCheck: boolean): number {
  let c = 0;
  const xs = [...digits].reverse().map(Number);
  xs.forEach((n, i) => {
    c = D[c]?.[P[(i + (withCheck ? 0 : 1)) % 8]?.[n] ?? 0] ?? 0;
  });
  return c;
}

/** The check digit to append to 11 digits. Used to build valid synthetic numbers in tests. */
export const verhoeffDigit = (eleven: string) => INV[verhoeff(eleven, false)] ?? 0;

/** A valid Aadhaar number (12 digits, not starting 0 or 1, check digit correct), or null. */
export function readAadhaar(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^[2-9]\d{11}$/.test(digits) && verhoeff(digits, true) === 0 ? digits : null;
}

/** APAAR ID: 12 digits. */
export function readApaar(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}

/** PEN (UDISE+ Permanent Education Number): 11 digits. */
export function readPen(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{11}$/.test(digits) ? digits : null;
}

/** ABC ID (Academic Bank of Credits): 12 digits. */
export function readAbc(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}

/** PAN: five letters, four digits, one letter. */
export function readPan(raw: string): string | null {
  const pan = raw.replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}

export const last4 = (value: string) => value.slice(-4);

/** How an identifier is shown everywhere except an audited reveal. */
export const masked = (kind: 'aadhaar' | 'apaar' | 'abc' | 'pan', l4: string) =>
  kind === 'pan' ? `XXXXXX${l4}` : `XXXX XXXX ${l4}`;

/** A bank account number: 9 to 18 digits, spaces and dashes ignored. */
export function readBankAccount(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{9,18}$/.test(digits) ? digits : null;
}

export const maskedAccount = (l4: string) => `XXXX XXXX ${l4}`;
