// File checks with no I/O.

export type AllowedType = 'application/pdf' | 'image/jpeg' | 'image/png';
export const MAX_BYTES = 10 * 1024 * 1024;

const SIGNATURES: Record<AllowedType, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** True if the bytes really are the declared type, whatever the file name says. */
export function contentMatches(type: AllowedType, bytes: Uint8Array): boolean {
  return SIGNATURES[type].every((b, i) => bytes[i] === b);
}

export function isAllowedType(type: string): type is AllowedType {
  return type in SIGNATURES;
}

/**
 * The PDF fonts in this release cover Latin text only. Regional scripts arrive with the
 * Noto fonts in Milestone 12; until then such text is refused, never printed as boxes.
 */
export function printableLatin(text: string): boolean {
  return /^[\x20-\x7E\xA0-\xFF\n]*$/.test(text);
}
