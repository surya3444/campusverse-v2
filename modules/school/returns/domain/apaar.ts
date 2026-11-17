// APAAR reconciliation (rule book §15: "APAAR capture with consent; … reconciliation"): a list
// from the UDISE+ portal (PEN and APAAR ID, with the student's name) matched to the school's
// students. Pure: no I/O.

export type ApaarLine = { line: number; pen: string; apaar: string; name: string };
export type ApaarProblem = 'invalid_pen' | 'invalid_apaar';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Splits one CSV line, honouring double quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const HEADINGS = {
  pen: ['pen', 'student pen', 'pen no', 'pen number'],
  apaar: ['apaar', 'apaar id', 'apaar_id', 'apaar no', 'apaar number'],
  name: ['name', 'student name', 'student_name'],
};

/**
 * Reads the CSV: a header row naming PEN, APAAR ID and the student's name in any order, then one
 * student per line. Lines with a malformed PEN or APAAR ID are kept with their problem.
 */
export function parseApaarCsv(
  text: string,
):
  | { ok: true; lines: (ApaarLine & { problem: ApaarProblem | null })[] }
  | { ok: false; missing: string[] } {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const header = cells(rows[0] ?? '').map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const at = (k: keyof typeof HEADINGS) => header.findIndex((h) => HEADINGS[k].includes(h));
  const idx = { pen: at('pen'), apaar: at('apaar'), name: at('name') };
  const missing = (Object.keys(idx) as (keyof typeof idx)[]).filter((k) => idx[k] < 0);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    lines: rows.slice(1).map((l, i) => {
      const c = cells(l);
      const pen = (c[idx.pen] ?? '').replace(/\D/g, '');
      const apaar = (c[idx.apaar] ?? '').replace(/\D/g, '');
      return {
        line: i + 2,
        pen,
        apaar,
        name: c[idx.name] ?? '',
        problem: !/^\d{11}$/.test(pen)
          ? 'invalid_pen'
          : !/^\d{12}$/.test(apaar)
            ? 'invalid_apaar'
            : null,
      };
    }),
  };
}

/** The portal's name and the school's agree: every word of the shorter is in the longer. */
export function namesAgree(a: string, b: string): boolean {
  const [x, y] = [norm(a), norm(b)].sort((p, q) => p.length - q.length) as [string[], string[]];
  return x.length > 0 && x.every((w) => y.includes(w));
}
