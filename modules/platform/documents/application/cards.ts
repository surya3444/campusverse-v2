// Identity cards printed on A4: ten cards of credit-card size (85.6 × 54 mm, two across and five
// down) with crop space between them. The school's name in a navy band, the photo, the name and
// a few lines. Printed, not issued: a card carries no verification code.
// ponytail: no QR on the card; add one through issueDocumentIn when the gate scans cards.
import { PDFDocument, rgb, StandardFonts, type PDFImage } from 'pdf-lib';
import { printableLatin } from '../domain/files.js';

export type IdCard = {
  name: string;
  /** Label and value rows, already formatted (at most five fit). */
  lines: [string, string][];
  photo: { bytes: Uint8Array; contentType: string } | null;
};

const MM = 72 / 25.4;
const CARD_W = 85.6 * MM;
const CARD_H = 54 * MM;
const NAVY = rgb(4 / 255, 38 / 255, 109 / 255);
const MUTED = rgb(0.38, 0.42, 0.5);
const LINE = rgb(0.85, 0.87, 0.91);

/** A4 sheets of ID cards. Text must be in Latin script (the PDF's built-in fonts). */
export async function renderIdCards(input: {
  schoolName: string;
  footer: string;
  cards: IdCard[];
}): Promise<Uint8Array> {
  const texts = [
    input.schoolName,
    input.footer,
    ...input.cards.flatMap((c) => [c.name, ...c.lines.flat()]),
  ];
  if (!texts.every(printableLatin)) {
    throw new Error('ID card text uses a script the PDF fonts cannot draw yet');
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(`ID cards · ${input.schoolName}`);
  pdf.setProducer('Campusverse');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pageW, pageH] = [595.28, 841.89];
  const gapX = (pageW - 2 * CARD_W) / 3;
  const gapY = (pageH - 5 * CARD_H) / 6;

  /** Cuts text to the width, ending in '...' when cut. */
  const fit = (text: string, size: number, width: number, font = regular) => {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };

  let page = pdf.addPage([pageW, pageH]);
  for (const [i, card] of input.cards.entries()) {
    const slot = i % 10;
    if (i > 0 && slot === 0) page = pdf.addPage([pageW, pageH]);
    const x = gapX + (slot % 2) * (CARD_W + gapX);
    const y = pageH - gapY - Math.floor(slot / 2) * (CARD_H + gapY) - CARD_H;

    page.drawRectangle({
      x,
      y,
      width: CARD_W,
      height: CARD_H,
      borderColor: LINE,
      borderWidth: 0.75,
    });
    const band = 30;
    page.drawRectangle({ x, y: y + CARD_H - band, width: CARD_W, height: band, color: NAVY });
    page.drawText(fit(input.schoolName, 10, CARD_W - 16, bold), {
      x: x + 8,
      y: y + CARD_H - 13,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText('STUDENT IDENTITY CARD', {
      x: x + 8,
      y: y + CARD_H - 25,
      size: 6.5,
      font: regular,
      color: rgb(0.8, 0.86, 0.96),
    });

    // Photo box, 22 × 27 mm.
    const pw = 22 * MM;
    const ph = 27 * MM;
    const px = x + 8;
    const py = y + CARD_H - band - 6 - ph;
    let image: PDFImage | null = null;
    if (card.photo) {
      try {
        image =
          card.photo.contentType === 'image/png'
            ? await pdf.embedPng(card.photo.bytes)
            : await pdf.embedJpg(card.photo.bytes);
      } catch {
        image = null; // An unreadable photo prints as an empty box, never fails the sheet.
      }
    }
    if (image) {
      // Fitted inside the box, centred; never cropped.
      const k = Math.min(pw / image.width, ph / image.height);
      const w = image.width * k;
      const h = image.height * k;
      page.drawImage(image, { x: px + (pw - w) / 2, y: py + (ph - h) / 2, width: w, height: h });
    }
    page.drawRectangle({
      x: px,
      y: py,
      width: pw,
      height: ph,
      borderColor: LINE,
      borderWidth: 0.75,
    });
    if (!image)
      page.drawText('PHOTO', {
        x: px + pw / 2 - 12,
        y: py + ph / 2 - 3,
        size: 7,
        font: regular,
        color: MUTED,
      });

    const tx = px + pw + 10;
    const tw = x + CARD_W - 8 - tx;
    page.drawText(fit(card.name, 10, tw, bold), {
      x: tx,
      y: py + ph - 9,
      size: 10,
      font: bold,
      color: NAVY,
    });
    let ly = py + ph - 23;
    for (const [label, value] of card.lines.slice(0, 5)) {
      page.drawText(label, { x: tx, y: ly, size: 6, font: regular, color: MUTED });
      page.drawText(fit(value, 7.5, tw - 46), { x: tx + 46, y: ly, size: 7.5, font: bold });
      ly -= 11;
    }
    page.drawText(fit(input.footer, 6, CARD_W - 16), {
      x: x + 8,
      y: y + 5,
      size: 6,
      font: regular,
      color: MUTED,
    });
  }
  return pdf.save();
}
