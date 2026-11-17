import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderIdCards } from './cards.js';

describe('ID cards', () => {
  it('puts ten cards on an A4 sheet and starts a new sheet for the eleventh', async () => {
    const cards = Array.from({ length: 11 }, (_, i) => ({
      name: `Synthetic Student With A Rather Long Name ${i + 1}`,
      photo: { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }, // unreadable: empty box
      lines: [['Class', 'Class 3-A'] as [string, string]],
    }));
    const pdf = await PDFDocument.load(
      await renderIdCards({
        schoolName: 'Synthetic Public School',
        footer: 'If found, return to the school.',
        cards,
      }),
    );
    expect(pdf.getPageCount()).toBe(2);
  });
});
