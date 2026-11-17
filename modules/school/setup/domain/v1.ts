// Campusverse V1 importers (rule book §17 P0 item 16: "Migration of every V1 tenant at the
// June–July boundary"). A V1 export of the `students` or `staff` collection (a JSON array, or one
// document per line as mongoexport writes it) becomes the same table the Excel templates give, so
// it goes through the same checks, dry run, commit and undo. Pure: no I/O.

/** The largest export accepted, in characters (about 5,000 students with their parents). */
export const V1_MAX_CHARS = 20_000_000;

type Doc = Record<string, unknown>;

/** Reads a JSON array or JSON lines; null if it's neither. */
export function parseV1Export(text: string): Doc[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('[')) {
      const arr: unknown = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr.filter(isDoc) : null;
    }
    return trimmed
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as unknown)
      .filter(isDoc);
  } catch {
    return null;
  }
}
const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);

const get = (d: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (isDoc(o) ? o[k] : undefined), d);
const text = (v: unknown) =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

/** A Mongo date in extended JSON ({"$date": …}) or a plain string, as YYYY-MM-DD. */
export function v1Date(v: unknown): string {
  const raw = isDoc(v) ? (isDoc(v.$date) ? v.$date.$numberLong : v.$date) : v;
  if (raw === undefined || raw === null || raw === '') return '';
  const d = new Date(typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : (raw as string));
  if (Number.isNaN(d.getTime())) return '';
  // V1 kept dates of birth at midnight IST: read the calendar day in India.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

/** The last ten digits of a phone number, if it has them. */
const phone = (v: unknown) => {
  const digits = text(v).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : text(v);
};

const parentName = (p: unknown) =>
  text(get(p, 'name')) ||
  [text(get(p, 'firstName')), text(get(p, 'lastName'))].filter(Boolean).join(' ');

export type V1Converted = { table: string[][]; skipped: { ref: string; reason: string }[] };

/** V1 students → the student template's columns. Only active students move across. */
export function v1StudentsTable(docs: Doc[]): V1Converted {
  const table: string[][] = [
    [
      'Admission number',
      'Name',
      'Date of birth',
      'Class',
      'Section',
      'Roll number',
      'Guardian 1 name',
      'Guardian 1 relationship',
      'Guardian 1 phone',
      'Guardian 2 name',
      'Guardian 2 relationship',
      'Guardian 2 phone',
    ],
  ];
  const skipped: V1Converted['skipped'] = [];
  for (const d of docs) {
    const ref = text(d.admissionNumber) || text(get(d, '_id.$oid')) || '?';
    const status = text(d.status) || 'active';
    if (status !== 'active') {
      skipped.push({ ref, reason: `status ${status}` });
      continue;
    }
    const parents = (['father', 'mother', 'guardian'] as const)
      .map((rel) => ({
        rel,
        name: parentName(get(d, `parents.${rel}`)),
        phone: phone(get(d, `parents.${rel}.phone`) ?? get(d, `parents.${rel}.mobile`)),
      }))
      .filter((p) => p.name || p.phone);
    // The student's own number stands in when V1 had no parent phone.
    const first = parents[0] ?? { rel: 'guardian' as const, name: '', phone: '' };
    if (!first.phone) first.phone = phone(get(d, 'contact.phone'));
    const second = parents[1];
    table.push([
      text(d.admissionNumber),
      text(d.displayName) || [text(d.firstName), text(d.lastName)].filter(Boolean).join(' '),
      v1Date(d.dateOfBirth),
      text(get(d, 'currentEnrollment.className')),
      text(get(d, 'currentEnrollment.sectionName')),
      text(d.rollNumber),
      first.name,
      first.rel,
      first.phone,
      second?.name ?? '',
      second ? second.rel : '',
      second?.phone ?? '',
    ]);
  }
  return { table, skipped };
}

/** V1 staff → the staff template's columns. Teaching staff come in as teachers, the rest as office. */
export function v1StaffTable(docs: Doc[]): V1Converted {
  const table: string[][] = [['Employee code', 'Name', 'Phone', 'Email', 'Role']];
  const skipped: V1Converted['skipped'] = [];
  for (const d of docs) {
    const ref = text(d.employeeId) || text(get(d, '_id.$oid')) || '?';
    const status = text(d.status) || 'active';
    if (status !== 'active' && status !== 'on-leave') {
      skipped.push({ ref, reason: `status ${status}` });
      continue;
    }
    table.push([
      text(d.employeeId),
      text(d.displayName) || [text(d.firstName), text(d.lastName)].filter(Boolean).join(' '),
      phone(get(d, 'contact.phone')),
      text(get(d, 'contact.email')) || text(d.email),
      get(d, 'employment.isTeaching') === false ? 'office' : 'teacher',
    ]);
  }
  return { table, skipped };
}
