// A batch's students from a file (onboarding a college): one row per student with name, register
// number, section and date of birth. Pure: parsing and checks that need no database.

export type EnrolLine = {
  line: number;
  name: string;
  registerNumber: string | null;
  section: string;
  dateOfBirth: string | null;
};
export type EnrolProblem =
  'name_missing' | 'register_invalid' | 'register_twice' | 'section_missing' | 'date_invalid';

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
    } else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const HEADINGS = {
  name: ['name', 'full name', 'student name', 'student'],
  registerNumber: [
    'register number',
    'register no',
    'reg no',
    'registration number',
    'roll number',
    'usn',
  ],
  section: ['section', 'sec'],
  dateOfBirth: ['date of birth', 'dob', 'birth date'],
} as const;
export const ENROL_COLUMNS = ['Name', 'Register number', 'Section', 'Date of birth'] as const;

/** DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD to YYYY-MM-DD; null if it isn't a real date. */
export function isoDate(text: string): string | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) ?? /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] =
    text.includes('-') && /^\d{4}/.test(text) ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Reads the file. Headings are matched loosely (Name / Student name, Register no / USN …); a
 * Name column is required. Each line comes back with its problem, if any.
 */
export function parseEnrolCsv(
  text: string,
): { ok: true; lines: (EnrolLine & { problem: EnrolProblem | null })[] } | { ok: false } {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ n: i + 1, l }))
    .filter((r) => r.l.trim() !== '');
  const head = rows[0] ? cells(rows[0].l).map((h) => h.toLowerCase()) : [];
  const col = (k: keyof typeof HEADINGS) =>
    head.findIndex((h) => (HEADINGS[k] as readonly string[]).includes(h));
  const at = {
    name: col('name'),
    reg: col('registerNumber'),
    section: col('section'),
    dob: col('dateOfBirth'),
  };
  if (at.name < 0) return { ok: false };
  const seen = new Set<string>();
  const lines = rows.slice(1).map(({ n, l }) => {
    const c = cells(l);
    const get = (i: number) => (i >= 0 ? (c[i] ?? '').trim() : '');
    const reg = get(at.reg) || null;
    const dobText = get(at.dob);
    const dob = dobText ? isoDate(dobText) : null;
    const line: EnrolLine = {
      line: n,
      name: get(at.name).replace(/\s+/g, ' '),
      registerNumber: reg,
      section: get(at.section).toUpperCase(),
      dateOfBirth: dob,
    };
    const problem: EnrolProblem | null =
      line.name.length < 2
        ? 'name_missing'
        : reg && !/^[A-Za-z0-9/-]{1,30}$/.test(reg)
          ? 'register_invalid'
          : reg && seen.has(reg.toUpperCase())
            ? 'register_twice'
            : !line.section && at.section >= 0
              ? 'section_missing'
              : dobText && !dob
                ? 'date_invalid'
                : null;
    if (reg) seen.add(reg.toUpperCase());
    return { ...line, problem };
  });
  return { ok: true, lines };
}
