// Synthetic school data for tests and demos. Invented people; never real records.
// Deterministic for a given seed, so a failing test can be replayed.
import writeXlsxFile from 'write-excel-file/node';

/** Small seeded PRNG (mulberry32): same seed, same school. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Aarav',
  'Anika',
  'Bhavya',
  'Chirag',
  'Diya',
  'Eshan',
  'Fatima',
  'Gautam',
  'Harini',
  'Ishaan',
  'Jaya',
  'Kabir',
  'Lavanya',
  'Manav',
  'Nila',
  'Omkar',
  'Pooja',
  'Rohan',
  'Sneha',
  'Tanvi',
  'Uday',
  'Varsha',
  'Yash',
  'Zara',
];
const ADULT = [
  'Priya',
  'Suresh',
  'Lakshmi',
  'Anil',
  'Rekha',
  'Imran',
  'Kavitha',
  'Venkat',
  'Meena',
  'Ramesh',
  'Shalini',
  'Arun',
];

/** Phones in the different ways schools type them; all normalise to valid Indian mobiles. */
function phone(rand: () => number, style: number): { typed: string; e164: string } {
  const digits = `9${String(Math.floor(rand() * 1e9)).padStart(9, '0')}`;
  const typed =
    [digits, `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, `0${digits}`, `+91-${digits}`][
      style % 4
    ] ?? digits;
  return { typed, e164: `+91${digits}` };
}

export type SchoolShape = {
  classes: { code: string; sections: string[]; studentsPerSection: number }[];
  seed?: number;
};

export type GeneratedSchool = {
  students: Buffer;
  staff: Buffer;
  counts: { students: number; guardians: number; staff: number; sections: number };
  /** The phones the staff file uses, by section they class-teach. */
  classTeacherPhones: Record<string, string>;
};

export const STUDENT_HEADER = [
  'Admission No',
  'Student Name',
  'Date of Birth',
  'Class',
  'Section',
  'Roll No',
  'Guardian 1 Name',
  'Guardian 1 Relationship',
  'Guardian 1 Phone',
  'Guardian 2 Name',
  'Guardian 2 Relationship',
  'Guardian 2 Phone',
];
export const STAFF_HEADER = [
  'Employee Code',
  'Name',
  'Mobile',
  'Email',
  'Designation',
  'Class Teacher Of',
  'Teaches',
];

/** Writes rows (header first) as an .xlsx file. */
export async function toXlsx(rows: (string | number | null)[][]): Promise<Buffer> {
  return writeXlsxFile(
    rows.map((r) => r.map((value) => (value === null ? null : { value }))),
  ).toBuffer();
}

/**
 * A school's two setup files. Every section gets a class teacher who also teaches English there;
 * every tenth student is a sibling sharing the previous student's parent.
 */
export async function generateSchool(
  shape: SchoolShape,
  principal?: { name: string; phone: string },
): Promise<GeneratedSchool> {
  const rand = prng(shape.seed ?? 42);
  const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length)] ?? '';
  const studentRows: (string | number | null)[][] = [STUDENT_HEADER];
  const staffRows: (string | number | null)[][] = [STAFF_HEADER];
  const guardians = new Set<string>();
  const classTeacherPhones: Record<string, string> = {};
  let admission = 1000;
  let n = 0;
  let previousGuardian: { name: string; typed: string; e164: string } | null = null;

  for (const c of shape.classes) {
    const age = c.code === 'LKG' ? 4 : c.code === 'UKG' ? 5 : Number(c.code) + 5;
    for (const section of c.sections) {
      for (let roll = 1; roll <= c.studentsPerSection; roll++, n++) {
        // Day 13–28 keeps the column provably day/month, as most Indian files are.
        const dob = `${13 + Math.floor(rand() * 16)}/${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}/${2026 - age}`;
        type G = { name: string; typed: string; e164: string };
        const g: G =
          n % 10 === 9 && previousGuardian
            ? previousGuardian // a sibling: same parent as the previous student
            : { name: `${pick(ADULT)} Synthetic`, ...phone(rand, n) };
        previousGuardian = g;
        guardians.add(`${g.name}|${g.e164}`);
        studentRows.push([
          `ADM-${admission++}`,
          `${pick(FIRST)} Synthetic ${n}`,
          dob,
          c.code,
          section,
          roll,
          g.name,
          n % 2 ? 'Father' : 'Mother',
          g.typed,
          null,
          null,
          null,
        ]);
      }
      const t = phone(rand, n + 1);
      const key = `${c.code}-${section}`;
      classTeacherPhones[key] = t.e164;
      staffRows.push([
        `EMP-${key}`,
        `${pick(ADULT)} Teacher ${key}`,
        t.typed,
        `teacher.${key.toLowerCase()}@synthetic.example`,
        'Teacher',
        key,
        `English: ${key}`,
      ]);
    }
  }
  if (principal)
    staffRows.push(['EMP-P1', principal.name, principal.phone, null, 'Principal', null, null]);

  return {
    students: await toXlsx(studentRows),
    staff: await toXlsx(staffRows),
    counts: {
      students: n,
      guardians: guardians.size,
      staff: staffRows.length - 1,
      sections: shape.classes.reduce((s, c) => s + c.sections.length, 0),
    },
    classTeacherPhones,
  };
}
