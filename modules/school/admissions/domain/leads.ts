// Bulk upload of leads (rule book §13.3 "bulk import, duplicate check"): reading a sheet's rows
// into leads, with a plain reason for every row that can't be used. Pure; no database.

/** Reads CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type LeadColumn =
  | 'childName'
  | 'dateOfBirth'
  | 'gender'
  | 'className'
  | 'guardianName'
  | 'relationship'
  | 'phone'
  | 'email'
  | 'previousSchool'
  | 'notes';

/** Header words a school might use for each column (lower case, spaces and punctuation ignored). */
const HEADERS: Record<LeadColumn, string[]> = {
  childName: ['childname', 'studentname', 'name', 'child', 'student', 'applicantname'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate'],
  gender: ['gender', 'sex'],
  className: ['class', 'classapplied', 'classappliedfor', 'grade', 'standard', 'applyingfor'],
  guardianName: ['guardianname', 'parentname', 'fathername', 'mothername', 'guardian', 'parent'],
  relationship: ['relationship', 'relation'],
  phone: [
    'phone',
    'mobile',
    'mobileno',
    'mobilenumber',
    'phoneno',
    'phonenumber',
    'contact',
    'contactno',
    'guardianphone',
    'parentmobile',
  ],
  email: ['email', 'emailaddress', 'guardianemail', 'parentemail'],
  previousSchool: ['previousschool', 'currentschool', 'lastschool'],
  notes: ['notes', 'remarks', 'comments'],
};

export const TEMPLATE_HEADERS = [
  'Child name',
  'Date of birth',
  'Gender',
  'Class',
  'Guardian name',
  'Relationship',
  'Mobile',
  'Email',
  'Previous school',
  'Notes',
] as const;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which column each header is, by its words; unknown headers are ignored. */
export function mapHeaders(header: readonly unknown[]): Partial<Record<LeadColumn, number>> {
  const out: Partial<Record<LeadColumn, number>> = {};
  header.forEach((h, i) => {
    const key = squash(String(h ?? ''));
    for (const [col, words] of Object.entries(HEADERS) as [LeadColumn, string[]][])
      if (out[col] === undefined && words.includes(key)) out[col] = i;
  });
  return out;
}

export type LeadRow = {
  childName: string;
  dateOfBirth: string | null;
  gender: 'female' | 'male' | 'other' | 'not_stated' | null;
  classId: string;
  guardianName: string;
  relationship: 'mother' | 'father' | 'guardian' | 'grandparent' | 'sibling' | 'other';
  phone: string;
  email: string | null;
  previousSchool: string | null;
  notes: string | null;
};

export type LeadProblem =
  'child_name' | 'guardian_name' | 'phone' | 'class' | 'date_of_birth' | 'email' | 'gender';

const GENDERS: Record<string, LeadRow['gender']> = {
  f: 'female',
  female: 'female',
  girl: 'female',
  m: 'male',
  male: 'male',
  boy: 'male',
  other: 'other',
};
const RELATIONS = ['mother', 'father', 'guardian', 'grandparent', 'sibling', 'other'] as const;

/** A date as YYYY-MM-DD from 2019-06-15, 15/06/2019, 15-06-2019 or a spreadsheet Date. */
export function readDate(v: unknown): string | null | 'bad' {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const [y, mo, d] = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !mo || !d) return 'bad';
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? 'bad' : iso;
}

/** An Indian mobile as +91XXXXXXXXXX from 98765 43210, 09876543210, +91-98765-43210 or a number. */
export function readMobile(v: unknown): string | null {
  const digits = String(v ?? '').replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
  return /^[6-9]\d{9}$/.test(ten) && digits.length <= 12 ? `+91${ten}` : null;
}

/** One sheet row as a lead, or what is wrong with it. Classes match by name or code ("Class 3", "3"). */
export function readLead(
  cells: readonly unknown[],
  cols: Partial<Record<LeadColumn, number>>,
  classes: readonly { classId: string; name: string; code: string }[],
): { lead: LeadRow; problems: [] } | { lead: null; problems: LeadProblem[] } {
  const get = (c: LeadColumn) => {
    const i = cols[c];
    return i === undefined ? '' : String(cells[i] ?? '').trim();
  };
  const raw = (c: LeadColumn) => {
    const i = cols[c];
    return i === undefined ? undefined : cells[i];
  };
  const problems: LeadProblem[] = [];
  const childName = get('childName');
  if (childName.length < 2 || childName.length > 120) problems.push('child_name');
  const guardianName = get('guardianName');
  if (guardianName.length < 2 || guardianName.length > 120) problems.push('guardian_name');
  const phone = readMobile(raw('phone'));
  if (!phone) problems.push('phone');
  const wanted = squash(get('className'));
  const klass = classes.find(
    (c) =>
      squash(c.name) === wanted || squash(c.code) === wanted || squash(`class${c.code}`) === wanted,
  );
  if (!klass) problems.push('class');
  const dob = readDate(raw('dateOfBirth'));
  if (dob === 'bad') problems.push('date_of_birth');
  const email = get('email').toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('email');
  const g = get('gender').toLowerCase();
  const gender = g ? (GENDERS[g] ?? null) : null;
  if (g && !gender) problems.push('gender');
  if (problems.length > 0 || !phone || !klass || dob === 'bad') return { lead: null, problems };
  const rel = get('relationship').toLowerCase();
  return {
    lead: {
      childName,
      dateOfBirth: dob,
      gender,
      classId: klass.classId,
      guardianName,
      relationship: (RELATIONS as readonly string[]).includes(rel)
        ? (rel as LeadRow['relationship'])
        : 'guardian',
      phone,
      email,
      previousSchool: get('previousSchool').slice(0, 160) || null,
      notes: get('notes').slice(0, 1000) || null,
    },
    problems: [],
  };
}
