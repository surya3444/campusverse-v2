import { describe, expect, it } from 'vitest';
import { contentMatches, printableLatin } from './files.js';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('contentMatches', () => {
  it('accepts real PDF, JPEG and PNG headers', () => {
    expect(contentMatches('application/pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(contentMatches('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatches('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      true,
    );
  });

  it('rejects a file whose bytes are not the declared type', () => {
    expect(contentMatches('application/pdf', new TextEncoder().encode('MZ\x90\x00'))).toBe(false);
    expect(contentMatches('image/png', bytes(0xff, 0xd8, 0xff))).toBe(false);
    expect(contentMatches('image/jpeg', bytes())).toBe(false);
  });
});

describe('printableLatin', () => {
  it('allows Latin text and refuses scripts the PDF font cannot draw', () => {
    expect(printableLatin('Synthetic Student, Class 5-A\nRoll 12')).toBe(true);
    expect(printableLatin('ಕನ್ನಡ')).toBe(false);
    expect(printableLatin('हिन्दी')).toBe(false);
  });
});
