// Lists leave as CSV, which Excel and Google Sheets open directly.
import { api } from './api';

type Cell = string | number | null | undefined;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR) gets a leading
 * apostrophe, so a name typed as "=HYPERLINK(...)" stays text. Numbers stay numbers.
 */
function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Saves the rows as a file. The BOM makes Excel read Indian scripts as UTF-8. */
export function downloadCsv(name: string, header: readonly string[], rows: Cell[][]): void {
  const blob = new Blob(['\uFEFF', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

export type ExportList =
  | 'students'
  | 'staff'
  | 'staff_attendance'
  | 'staff_payroll'
  | 'fee_dues'
  | 'attendance_register'
  | 'transport_riders'
  | 'transport_boarding'
  | 'transport_ridership'
  | 'transport_papers'
  | 'udise_students';

/** Logs the download in the school's activity (who, which list, how many rows), then saves it. */
export async function exportCsv(
  list: ExportList,
  /** The school, or the section for a register. */
  scopeId: string,
  name: string,
  header: readonly string[],
  rows: Cell[][],
): Promise<void> {
  await api.post('/activity/exports', { list, scopeId, rows: rows.length });
  downloadCsv(name, header, rows);
}

/** Reads CSV (or tab-separated) text into rows of trimmed cells; quoted cells may hold commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  const end = () => {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t') {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      end();
    } else cell += c;
  }
  end();
  return rows;
}
