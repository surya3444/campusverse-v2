// Grid cell rules. Pure, so tested without a browser.

/** Codes a teacher can type instead of a number. Blank is never zero. */
export const MARK_CODES = ['AB', 'ML', 'UFM', 'EX', 'NA'] as const;

export type CellProblem = 'not_a_mark' | 'over_max' | 'too_precise';

/** Null if the value is fine. Blank is allowed: it means not yet entered, not zero. */
export function checkMark(raw: string, max: number): CellProblem | null {
  const v = raw.trim().toUpperCase();
  if (v === '' || (MARK_CODES as readonly string[]).includes(v)) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return 'not_a_mark';
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'too_precise';
  return Number(v) > max ? 'over_max' : null;
}

/** Normalises what is stored: trimmed, codes upper-case, numbers as typed. */
export const normaliseMark = (raw: string) => raw.trim().toUpperCase();

/**
 * Splits clipboard text from Excel or Sheets into rows and cells. Tabs separate cells, newlines
 * separate rows, and a trailing newline (Excel always adds one) is not an extra row.
 */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return lines.map((line) => line.split('\t'));
}

/** Cells a paste would write, starting at (row, col) and clipped to the grid's edges. */
export function pasteTargets(
  start: { row: number; col: number },
  matrix: string[][],
  size: { rows: number; cols: number },
): { row: number; col: number; value: string }[] {
  const out: { row: number; col: number; value: string }[] = [];
  matrix.forEach((cells, r) =>
    cells.forEach((value, c) => {
      const row = start.row + r;
      const col = start.col + c;
      if (row < size.rows && col < size.cols) out.push({ row, col, value });
    }),
  );
  return out;
}
