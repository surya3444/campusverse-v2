// Validates rows from a school's Excel file. Pure: the caller passes what already exists.
// Never merges: a likely duplicate is flagged for a person to decide.
import { normaliseIndianMobile } from '@campusverse/platform-identity';
import { CBSE_CLASSES } from '@campusverse/rules';
import { parseDateColumn } from './dates.js';

export type Problem = { field: string; code: string; severity: 'error' | 'warning' };
export type RowStatus = 'valid' | 'invalid' | 'duplicate';
export type ValidatedRow<T> = {
  rowNumber: number;
  status: RowStatus;
  raw: Record<string, string>;
  value: T | null;
  problems: Problem[];
};
export type Validated<T> = {
  rows: ValidatedRow<T>[];
  missingColumns: string[];
  ignoredColumns: string[];
};

export type Relationship = 'mother' | 'father' | 'guardian' | 'grandparent' | 'sibling' | 'other';
export type Guardian = { name: string; relationship: Relationship; phone: string };
export type StudentRow = {
  admissionNumber: string;
  name: string;
  dateOfBirth: string;
  classCode: string;
  section: string;
  rollNumber: number | null;
  guardians: Guardian[];
};

export type StaffRole = 'teacher' | 'principal' | 'office';
export type StaffRow = {
  employeeCode: string;
  name: string;
  phone: string;
  email: string | null;
  role: StaffRole;
  classTeacherOf: string | null; // '5-A'
  teaches: { subjectCode: string; section: string }[];
};

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const text = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim();

/** Finds each field's column by its header, accepting common wordings. */
function readHeader<F extends string>(header: unknown[], aliases: Record<F, string[]>) {
  const index = {} as Partial<Record<F, number>>;
  const ignored: string[] = [];
  header.forEach((cell, i) => {
    const h = norm(text(cell));
    if (!h) return;
    const field = (Object.keys(aliases) as F[]).find((f) => aliases[f].includes(h));
    if (field && index[field] === undefined) index[field] = i;
    else ignored.push(text(cell));
  });
  return { index, ignored };
}

/** Header row first; fully blank rows are skipped but keep their Excel row numbers. */
function body(table: unknown[][]) {
  const [header = [], ...rest] = table;
  return {
    header,
    rows: rest
      .map((cells, i) => ({ cells, rowNumber: i + 2 }))
      .filter((r) => r.cells.some((c) => text(c) !== '')),
  };
}

const ROMAN: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
};
const CLASS_CODES = new Set(CBSE_CLASSES.map((c) => c.code));

/** '5', 'V', 'Class 5', 'Std. V', 'lkg' → the class code, or null. */
export function readClass(raw: string): string | null {
  const s = norm(raw).replace(/^(class|std|standard|grade)\s*/, '');
  const code = (ROMAN[s] ?? s).toUpperCase();
  return CLASS_CODES.has(code) ? code : null;
}

const RELATIONSHIPS: Record<string, Relationship> = {
  mother: 'mother',
  mom: 'mother',
  mum: 'mother',
  amma: 'mother',
  father: 'father',
  dad: 'father',
  appa: 'father',
  guardian: 'guardian',
  grandparent: 'grandparent',
  grandfather: 'grandparent',
  grandmother: 'grandparent',
  sibling: 'sibling',
  brother: 'sibling',
  sister: 'sibling',
  other: 'other',
  uncle: 'other',
  aunt: 'other',
};

const STUDENT_COLUMNS = {
  admissionNumber: ['admission number', 'admission no', 'adm no', 'admission no.'],
  name: ['student name', 'name', 'full name'],
  dateOfBirth: ['date of birth', 'dob', 'birth date'],
  class: ['class', 'grade', 'std', 'standard'],
  section: ['section', 'div', 'division'],
  rollNumber: ['roll number', 'roll no', 'roll'],
  g1Name: ['guardian 1 name', 'guardian name', 'parent name'],
  g1Relationship: ['guardian 1 relationship', 'relationship', 'relation'],
  g1Phone: ['guardian 1 phone', 'guardian phone', 'parent phone', 'phone', 'mobile'],
  g2Name: ['guardian 2 name'],
  g2Relationship: ['guardian 2 relationship'],
  g2Phone: ['guardian 2 phone'],
};
const STUDENT_REQUIRED = [
  'admissionNumber',
  'name',
  'dateOfBirth',
  'class',
  'section',
  'g1Name',
  'g1Relationship',
  'g1Phone',
] as const;
const ID = /^[A-Za-z0-9/_-]{1,30}$/;

function ageOn(dob: string, on: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = on.split('-').map(Number) as [number, number, number];
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

function finish<T>(
  rowNumber: number,
  raw: Record<string, string>,
  value: T | null,
  problems: Problem[],
): ValidatedRow<T> {
  const status: RowStatus = problems.some((p) => p.severity === 'error')
    ? 'invalid'
    : problems.some((p) => p.code.startsWith('duplicate'))
      ? 'duplicate'
      : 'valid';
  return { rowNumber, status, raw, value: status === 'invalid' ? null : value, problems };
}

export function validateStudents(
  table: unknown[][],
  ctx: {
    sections: Set<string>; // '5-A'
    existingAdmissions: Set<string>;
    existingPeople: Set<string>; // `${name.toLowerCase()}|${dob}`
    yearStarts: string;
  },
): Validated<StudentRow> {
  const { header, rows } = body(table);
  const { index, ignored } = readHeader(header, STUDENT_COLUMNS);
  const missing = STUDENT_REQUIRED.filter((f) => index[f] === undefined);
  if (missing.length > 0) return { rows: [], missingColumns: missing, ignoredColumns: ignored };

  const cell = (cells: unknown[], f: keyof typeof STUDENT_COLUMNS) => {
    const i = index[f];
    return i === undefined ? '' : text(cells[i]);
  };
  const dobIndex = index.dateOfBirth;
  const dates = parseDateColumn(rows.map((r) => (dobIndex === undefined ? '' : r.cells[dobIndex])));
  const seenAdmissions = new Set<string>();
  const seenPeople = new Set<string>();
  const seenRolls = new Set<string>();

  const out = rows.map(({ cells, rowNumber }, i) => {
    const raw = Object.fromEntries(
      Object.keys(STUDENT_COLUMNS).map((f) => [f, cell(cells, f as keyof typeof STUDENT_COLUMNS)]),
    );
    const problems: Problem[] = [];
    const err = (field: string, code: string) => problems.push({ field, code, severity: 'error' });
    const warn = (field: string, code: string) =>
      problems.push({ field, code, severity: 'warning' });

    for (const f of STUDENT_REQUIRED) if (!raw[f]) err(f, 'required');

    const admissionNumber = raw.admissionNumber ?? '';
    if (admissionNumber && !ID.test(admissionNumber)) err('admissionNumber', 'bad_id');

    const date = dates[i] ?? { error: 'not_a_date' as const };
    let dateOfBirth = '';
    if (raw.dateOfBirth) {
      if ('error' in date) err('dateOfBirth', date.error);
      else {
        dateOfBirth = date.iso;
        if (date.ambiguous) warn('dateOfBirth', 'ambiguous_date');
        const age = ageOn(date.iso, ctx.yearStarts);
        if (age < 2 || age > 20) warn('dateOfBirth', 'unusual_age');
      }
    }

    const classCode = raw.class ? readClass(raw.class) : null;
    if (raw.class && !classCode) err('class', 'unknown_class');
    const section = (raw.section ?? '').toUpperCase();
    const placement = `${classCode}-${section}`;
    if (classCode && section && !ctx.sections.has(placement)) err('section', 'unknown_section');

    let rollNumber: number | null = null;
    if (raw.rollNumber) {
      rollNumber = Number(raw.rollNumber);
      if (!Number.isInteger(rollNumber) || rollNumber < 1) err('rollNumber', 'bad_roll');
      else if (seenRolls.has(`${placement}#${rollNumber}`)) err('rollNumber', 'roll_taken');
      else seenRolls.add(`${placement}#${rollNumber}`);
    }

    const guardians: Guardian[] = [];
    for (const g of [1, 2] as const) {
      const name = raw[`g${g}Name`] ?? '';
      const rel = raw[`g${g}Relationship`] ?? '';
      const phoneRaw = raw[`g${g}Phone`] ?? '';
      if (!name && !rel && !phoneRaw) continue;
      if (!name || !rel || !phoneRaw) {
        if (g === 2) err('g2Name', 'incomplete_guardian');
        continue;
      }
      const relationship = RELATIONSHIPS[norm(rel)];
      const phone = normaliseIndianMobile(phoneRaw);
      if (!relationship) err(`g${g}Relationship`, 'unknown_relationship');
      if (!phone) err(`g${g}Phone`, 'bad_phone');
      if (relationship && phone) guardians.push({ name, relationship, phone });
    }

    const personKey = `${(raw.name ?? '').toLowerCase()}|${dateOfBirth}`;
    if (admissionNumber) {
      if (ctx.existingAdmissions.has(admissionNumber))
        warn('admissionNumber', 'duplicate_in_school');
      else if (seenAdmissions.has(admissionNumber)) warn('admissionNumber', 'duplicate_in_file');
      seenAdmissions.add(admissionNumber);
    }
    if (
      dateOfBirth &&
      raw.name &&
      (ctx.existingPeople.has(personKey) || seenPeople.has(personKey))
    ) {
      warn('name', 'duplicate_person');
    }
    seenPeople.add(personKey);

    const value: StudentRow | null = classCode
      ? {
          admissionNumber,
          name: raw.name ?? '',
          dateOfBirth,
          classCode,
          section,
          rollNumber,
          guardians,
        }
      : null;
    return finish(rowNumber, raw, value, problems);
  });
  return { rows: out, missingColumns: [], ignoredColumns: ignored };
}

const STAFF_COLUMNS = {
  employeeCode: ['employee code', 'employee id', 'emp code', 'staff id'],
  name: ['name', 'staff name', 'full name'],
  phone: ['phone', 'mobile', 'phone number'],
  email: ['email', 'email address'],
  role: ['role', 'designation'],
  classTeacherOf: ['class teacher of', 'class teacher'],
  teaches: ['teaches', 'subjects'],
};
const STAFF_REQUIRED = ['employeeCode', 'name', 'phone', 'role'] as const;
const ROLES: Record<string, StaffRole> = {
  teacher: 'teacher',
  lecturer: 'teacher',
  professor: 'teacher',
  'assistant professor': 'teacher',
  'associate professor': 'teacher',
  faculty: 'teacher',
  principal: 'principal',
  headmaster: 'principal',
  'head teacher': 'principal',
  headmistress: 'principal',
  office: 'office',
  admin: 'office',
  clerk: 'office',
  accountant: 'office',
  registrar: 'office',
};

/** '5-A' or '5 A' or 'V-A' → '5-A', or null. */
export function readSection(raw: string): string | null {
  const [, cls = '', section = ''] = /^(.+?)[\s-]+([A-Za-z0-9]{1,4})$/.exec(raw.trim()) ?? [];
  const code = cls ? readClass(cls) : null;
  return code ? `${code}-${section.toUpperCase()}` : null;
}

export function validateStaff(
  table: unknown[][],
  ctx: {
    sections: Set<string>;
    subjects: Map<string, string>; // lower-case code or name → code
    offerings: Set<string>; // `${classCode}:${subjectCode}`
    classTeachers: Set<string>; // sections that already have one
    existingCodes: Set<string>;
  },
): Validated<StaffRow> {
  const { header, rows } = body(table);
  const { index, ignored } = readHeader(header, STAFF_COLUMNS);
  const missing = STAFF_REQUIRED.filter((f) => index[f] === undefined);
  if (missing.length > 0) return { rows: [], missingColumns: missing, ignoredColumns: ignored };

  const seenCodes = new Set<string>();
  const seenPhones = new Set<string>();
  const seenClassTeacher = new Set<string>();

  const out = rows.map(({ cells, rowNumber }) => {
    const raw = Object.fromEntries(
      Object.entries(STAFF_COLUMNS).map(([f]) => {
        const i = index[f as keyof typeof STAFF_COLUMNS];
        return [f, i === undefined ? '' : text(cells[i])];
      }),
    );
    const problems: Problem[] = [];
    const err = (field: string, code: string) => problems.push({ field, code, severity: 'error' });
    const warn = (field: string, code: string) =>
      problems.push({ field, code, severity: 'warning' });
    for (const f of STAFF_REQUIRED) if (!raw[f]) err(f, 'required');

    const employeeCode = raw.employeeCode ?? '';
    if (employeeCode && !ID.test(employeeCode)) err('employeeCode', 'bad_id');
    const phone = raw.phone ? normaliseIndianMobile(raw.phone) : null;
    if (raw.phone && !phone) err('phone', 'bad_phone');
    if (phone && seenPhones.has(phone)) warn('phone', 'shared_phone');
    if (phone) seenPhones.add(phone);

    const email = raw.email ? raw.email.toLowerCase() : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('email', 'bad_email');

    const role = raw.role ? ROLES[norm(raw.role)] : undefined;
    if (raw.role && !role) err('role', 'unknown_role');

    let classTeacherOf: string | null = null;
    if (raw.classTeacherOf) {
      classTeacherOf = readSection(raw.classTeacherOf);
      if (!classTeacherOf || !ctx.sections.has(classTeacherOf))
        err('classTeacherOf', 'unknown_section');
      else if (ctx.classTeachers.has(classTeacherOf) || seenClassTeacher.has(classTeacherOf)) {
        err('classTeacherOf', 'class_teacher_taken');
      } else seenClassTeacher.add(classTeacherOf);
    }

    // 'Mathematics: 5-A, 5-B; ENG: 6-A'
    const teaches: StaffRow['teaches'] = [];
    for (const part of (raw.teaches ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [subjectRaw = '', list = ''] = part.split(':');
      const subjectCode = ctx.subjects.get(subjectRaw.trim().toLowerCase());
      if (!subjectCode) {
        err('teaches', 'unknown_subject');
        continue;
      }
      for (const s of list
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)) {
        const section = readSection(s);
        if (!section || !ctx.sections.has(section)) err('teaches', 'unknown_section');
        else if (!ctx.offerings.has(`${section.split('-')[0]}:${subjectCode}`))
          err('teaches', 'subject_not_offered');
        else teaches.push({ subjectCode, section });
      }
    }

    if (employeeCode) {
      if (ctx.existingCodes.has(employeeCode)) warn('employeeCode', 'duplicate_in_school');
      else if (seenCodes.has(employeeCode)) warn('employeeCode', 'duplicate_in_file');
      seenCodes.add(employeeCode);
    }

    const value: StaffRow | null =
      phone && role
        ? { employeeCode, name: raw.name ?? '', phone, email, role, classTeacherOf, teaches }
        : null;
    return finish(rowNumber, raw, value, problems);
  });
  return { rows: out, missingColumns: [], ignoredColumns: ignored };
}
