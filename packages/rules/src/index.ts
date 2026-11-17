// Board and state rule data. Modules read these packs; they never branch on a state or board name.
import { z } from 'zod';
// Everything here is marked verified: false until checked against the official order.

export type Source = { title: string; url?: string; readOn: string; verified: boolean };

/** States in the first release (Schools Release spec, "State packs"). */
export const STATES = {
  AP: 'Andhra Pradesh',
  TS: 'Telangana',
  KA: 'Karnataka',
  TN: 'Tamil Nadu',
} as const;
export type StateCode = keyof typeof STATES;

/** Boards supported now. State boards follow when the first school on one pays. */
export const BOARDS = { CBSE: 'CBSE' } as const;
export type BoardCode = keyof typeof BOARDS;

type YearTemplate = { starts: string; ends: string | null; source: Source };

/** Academic year 2026–27. CBSE runs on its own session; state boards follow the state calendar. */
const YEAR_2026_27: Record<BoardCode | StateCode, YearTemplate | null> = {
  CBSE: {
    starts: '2026-04-01',
    ends: '2027-03-31',
    source: {
      title: 'CBSE academic session, April to March',
      readOn: '2026-11-04',
      verified: false,
    },
  },
  KA: {
    starts: '2026-05-29',
    ends: null,
    source: {
      title: 'Karnataka schools reopen 29 May for 2026–27 (press report)',
      url: 'https://newsable.asianetnews.com/karnataka-news/karnataka-schools-to-reopen-on-may-29-for-2026-27-session-government-releases-academic-calendar-articleshow-7vcgryv',
      readOn: '2026-11-04',
      verified: false,
    },
  },
  TS: {
    starts: '2026-06-15',
    ends: null,
    source: {
      title: 'Telangana reschedules reopening to 15 June (press report)',
      url: 'https://telanganatoday.com/telangana-reschedules-school-reopening-to-june-15-for-2026-27-academic-year',
      readOn: '2026-11-04',
      verified: false,
    },
  },
  TN: {
    starts: '2026-06-04',
    ends: null,
    source: {
      title: 'Tamil Nadu schools reopen 4 June (press report)',
      url: 'https://www.dtnext.in/news/tamilnadu/tamil-nadu-schools-set-to-reopen-on-june-4-for-2026-27-academic-year',
      readOn: '2026-11-04',
      verified: false,
    },
  },
  AP: null, // official order not yet found: the school enters its own dates
};

/**
 * Suggested year dates for the setup wizard. A CBSE school follows the CBSE session wherever it
 * is. Null means no template: the school types its dates. Always shown as a suggestion with source.
 */
export function yearTemplate(input: { board: BoardCode; state: StateCode }): YearTemplate | null {
  return input.board === 'CBSE' ? YEAR_2026_27.CBSE : YEAR_2026_27[input.state];
}

export type ClassDef = { code: string; name: string; sequence: number };

/** CBSE school classes, pre-primary to 12. */
export const CBSE_CLASSES: ClassDef[] = [
  { code: 'LKG', name: 'LKG', sequence: 0 },
  { code: 'UKG', name: 'UKG', sequence: 1 },
  ...Array.from({ length: 12 }, (_, i) => ({
    code: String(i + 1),
    name: `Class ${i + 1}`,
    sequence: i + 2,
  })),
];

export const SUBJECTS = {
  ENG: 'English',
  HIN: 'Hindi',
  MAT: 'Mathematics',
  EVS: 'Environmental Studies',
  SCI: 'Science',
  SST: 'Social Science',
  TL3: 'Third Language',
  ART: 'Art',
} as const;
export type SubjectCode = keyof typeof SUBJECTS;

/**
 * Starting subjects per class, for the wizard's "review assumptions" step. The school edits
 * them; Class 11–12 streams and state language rules become teaching groups later.
 */
export const CBSE_DEFAULT_SUBJECTS: { source: Source; byClass: Record<string, SubjectCode[]> } = {
  source: {
    title: 'Common CBSE scheme of studies, simplified for setup',
    readOn: '2026-11-04',
    verified: false,
  },
  byClass: {
    LKG: ['ENG', 'MAT', 'ART'],
    UKG: ['ENG', 'MAT', 'ART'],
    '1': ['ENG', 'HIN', 'MAT'],
    '2': ['ENG', 'HIN', 'MAT'],
    '3': ['ENG', 'HIN', 'MAT', 'EVS'],
    '4': ['ENG', 'HIN', 'MAT', 'EVS'],
    '5': ['ENG', 'HIN', 'MAT', 'EVS'],
    '6': ['ENG', 'HIN', 'MAT', 'SCI', 'SST', 'TL3'],
    '7': ['ENG', 'HIN', 'MAT', 'SCI', 'SST', 'TL3'],
    '8': ['ENG', 'HIN', 'MAT', 'SCI', 'SST', 'TL3'],
    '9': ['ENG', 'HIN', 'MAT', 'SCI', 'SST'],
    '10': ['ENG', 'HIN', 'MAT', 'SCI', 'SST'],
    '11': ['ENG'],
    '12': ['ENG'],
  },
};

type AttendanceRule = {
  /** Minimum attendance for exam eligibility, in basis points (7500 = 75%). */
  minimumBasisPoints: number;
  /** Warn from this level, so parents hear early (a product default, not a board rule). */
  warnBelowBasisPoints: number;
  source: Source;
};

const ATTENDANCE: Record<BoardCode, AttendanceRule> = {
  CBSE: {
    minimumBasisPoints: 7500,
    warnBelowBasisPoints: 8000,
    source: {
      title: 'CBSE: strict compliance of attendance eligibility (circular, 5 Aug 2025)',
      url: 'https://www.cbse.gov.in/cbsenew/documents/Strict_Compliance_attendance_Eligibility_05082025.pdf',
      readOn: '2026-11-04',
      verified: false,
    },
  },
};

type AgeRule = {
  /** Minimum completed age, in whole years, on the cut-off date. */
  minYears: number;
  /** Maximum completed age, when the board or state sets one. */
  maxYears: number | null;
  /** Month and day of the cut-off in the admission year, e.g. "03-31". */
  cutOff: string;
  source: Source;
};

/**
 * Admission age by board and class. Only entry classes have rules here; other classes have none
 * (null), and the school decides. Every value is unverified until checked against the order.
 */
const ADMISSION_AGE: Record<BoardCode, Partial<Record<string, AgeRule>>> = {
  CBSE: {
    '1': {
      minYears: 6,
      maxYears: 8,
      cutOff: '03-31',
      source: {
        title:
          'NEP 2020 foundational stage: Class 1 at six years (CBSE schools follow the state order on the cut-off)',
        readOn: '2026-11-05',
        verified: false,
      },
    },
    LKG: {
      minYears: 4,
      maxYears: 6,
      cutOff: '03-31',
      source: {
        title: 'Pre-primary entry at four (school practice; check the state order)',
        readOn: '2026-11-05',
        verified: false,
      },
    },
  },
};

export function admissionAgeRule(board: string, classCode: string): AgeRule | null {
  return board in ADMISSION_AGE ? (ADMISSION_AGE[board as BoardCode][classCode] ?? null) : null;
}

/** Completed years between a date of birth and a date (both YYYY-MM-DD). */
export function completedYears(dob: string, on: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Days a school has to issue a TC after the request, by state; null where no order is known. */
const TC_DEADLINE: Partial<Record<StateCode, { days: number; source: Source }>> = {
  KA: {
    days: 7,
    source: {
      title: 'Karnataka: issue TCs within seven days (press report)',
      url: 'https://www.educationworld.in/karnataka-issue-tcs-within-7-days-or-face-action-private-schools-told',
      readOn: '2026-11-05',
      verified: false,
    },
  },
};

type GradeScheme = {
  /** Saved with every result, so a later change of scheme never rewrites an old report card. */
  id: string;
  /** Lowest percentage for each grade, in basis points, best first. */
  bands: { minBasisPoints: number; grade: string }[];
  /** Pass mark per subject, in basis points. */
  passBasisPoints: number;
  /** How percentages are rounded before grading: down to two decimals. */
  rounding: 'down_2dp';
  source: Source;
};

const CBSE_8PT: GradeScheme = {
  id: 'cbse-8pt@2026',
  bands: [
    { minBasisPoints: 9100, grade: 'A1' },
    { minBasisPoints: 8100, grade: 'A2' },
    { minBasisPoints: 7100, grade: 'B1' },
    { minBasisPoints: 6100, grade: 'B2' },
    { minBasisPoints: 5100, grade: 'C1' },
    { minBasisPoints: 4100, grade: 'C2' },
    { minBasisPoints: 3300, grade: 'D' },
    { minBasisPoints: 0, grade: 'E' },
  ],
  passBasisPoints: 3300,
  rounding: 'down_2dp',
  source: {
    title:
      'CBSE eight-point grading (A1 91–100 … D 33–40, E below 33) and 33% pass mark, as commonly published',
    readOn: '2026-11-05',
    verified: false,
  },
};

/** The grade for a percentage in basis points. */
export function gradeFor(scheme: GradeScheme, basisPoints: number): string {
  return (
    scheme.bands.find((b) => basisPoints >= b.minBasisPoints)?.grade ??
    scheme.bands.at(-1)?.grade ??
    ''
  );
}

export type PromotionRule =
  /** Promoted unless the school detains with a reason (no-detention classes). */
  | 'promote'
  /** Promoted if every subject reaches the pass mark; otherwise the school reviews. */
  | 'pass_marks'
  /** Board exam year: the student passes out of the school's classes. */
  | 'board';

/**
 * Payroll statutory rates (docs/specs/PAYROLL.md). PF and ESI are central; professional tax is
 * per state. Slabs: the first slab whose `fromPaise` the wage reaches (highest first). Tamil Nadu
 * levies on half-year income (`period: 'half_year'`): the wage is the month's gross × 6 and the
 * amount is for the half year. All unverified until checked against the official orders.
 */
export type PayrollRules = {
  /** epsBp: the employer's share that goes to the pension scheme (EPS), on wages up to the ceiling. */
  pf: { rateBp: number; wageCeilingPaise: number; epsBp: number };
  esi: { employeeBp: number; employerBp: number; grossLimitPaise: number };
  pt: {
    period: 'month' | 'half_year';
    slabs: { fromPaise: number; amountPaise: number }[];
    /** A different amount in one month (Karnataka: February). */
    month?: { month: number; fromPaise: number; amountPaise: number } | undefined;
  } | null;
  /** The state labour welfare fund: fixed amounts in the months it is collected. */
  lwf: { employeePaise: number; employerPaise: number; months: number[] } | null;
  source: Source;
};

const RUPEE = 100;
const PAYROLL_CENTRAL = {
  pf: { rateBp: 1200, wageCeilingPaise: 15_000 * RUPEE, epsBp: 833 },
  esi: { employeeBp: 75, employerBp: 325, grossLimitPaise: 21_000 * RUPEE },
};
/** Labour welfare fund by state, collected with December's salary (unverified). */
/**
 * TDS on salaries (section 192): when the tax deducted is deposited and when the quarterly
 * statement (Form 24Q) is due. Unverified until checked against the Income-tax Rules (rules 30
 * and 31A) and any CBDT extension: an extension is a new value here, not a code change.
 */
export const TDS_SALARY = {
  /** Deposit by this day of the next month; March's tax by this date in April. */
  depositDay: 7,
  marchDeposit: '04-30',
  /** 24Q due dates by quarter (Q1 April–June …), month-day; Q4 falls in the next calendar year. */
  statementDue: { 1: '07-31', 2: '10-31', 3: '01-31', 4: '05-31' } as Record<1 | 2 | 3 | 4, string>,
  source: {
    title:
      'Income-tax Rules 1962, rules 30 (deposit) and 31A (quarterly statements), as commonly published',
    readOn: '2026-11-15',
    verified: false,
  } satisfies Source,
};

const LWF: Record<StateCode, PayrollRules['lwf']> = {
  KA: { employeePaise: 20 * RUPEE, employerPaise: 40 * RUPEE, months: [12] },
  TN: { employeePaise: 20 * RUPEE, employerPaise: 40 * RUPEE, months: [12] },
  AP: { employeePaise: 30 * RUPEE, employerPaise: 70 * RUPEE, months: [12] },
  TS: { employeePaise: 2 * RUPEE, employerPaise: 5 * RUPEE, months: [12] },
};
const PT: Record<StateCode, PayrollRules['pt']> = {
  KA: {
    period: 'month',
    slabs: [{ fromPaise: 25_000 * RUPEE, amountPaise: 200 * RUPEE }],
    month: { month: 2, fromPaise: 25_000 * RUPEE, amountPaise: 300 * RUPEE },
  },
  TS: {
    period: 'month',
    slabs: [
      { fromPaise: 20_001 * RUPEE, amountPaise: 200 * RUPEE },
      { fromPaise: 15_001 * RUPEE, amountPaise: 150 * RUPEE },
    ],
  },
  AP: {
    period: 'month',
    slabs: [
      { fromPaise: 20_001 * RUPEE, amountPaise: 200 * RUPEE },
      { fromPaise: 15_001 * RUPEE, amountPaise: 150 * RUPEE },
    ],
  },
  TN: {
    period: 'half_year',
    slabs: [
      { fromPaise: 75_001 * RUPEE, amountPaise: 1_250 * RUPEE },
      { fromPaise: 60_001 * RUPEE, amountPaise: 1_025 * RUPEE },
      { fromPaise: 45_001 * RUPEE, amountPaise: 930 * RUPEE },
      { fromPaise: 30_001 * RUPEE, amountPaise: 425 * RUPEE },
      { fromPaise: 21_001 * RUPEE, amountPaise: 180 * RUPEE },
    ],
  },
};

/** PF, ESI and the state's professional tax. A state without a pack levies no professional tax here. */
export function payrollRules(stateCode: string | null): PayrollRules {
  return {
    ...PAYROLL_CENTRAL,
    pt: stateCode && stateCode in PT ? (PT[stateCode as StateCode] ?? null) : null,
    lwf: stateCode && stateCode in LWF ? (LWF[stateCode as StateCode] ?? null) : null,
    source: {
      title: 'EPF (12% to ₹15,000), ESI (0.75% / 3.25% to ₹21,000), state professional tax slabs',
      readOn: '2026-11-13',
      verified: false,
    },
  };
}

/**
 * Credit frameworks a program can follow (rule book §15: NCrF, 30 notional hours = 1 credit; UGC
 * curriculum and credit framework for undergraduate programmes, with exit awards). `exits` are the
 * cumulative credits for each award; `perTerm` is the usual load a regulation is checked against.
 */
export type CreditFramework = {
  title: string;
  totalCredits: number;
  perTerm: { min: number; max: number };
  exits: { afterTerm: number; credits: number; award: string }[];
  source: Source;
};

/**
 * UGC's 10-point letter grades with common percentage bands (universities set their own; check
 * against the affiliating university's regulations). Internal 40, end exam 60; the end exam needs
 * 40% of its marks.
 */
/**
 * Course attendance for exam eligibility: 75%, condonable from 65% (common university practice;
 * each university's regulations decide, so this is unverified and a pack version changes it).
 */
const COURSE_ATTENDANCE = { minimumPercent: 75, condonableFromPercent: 65 };

const UGC_GRADING = {
  bands: [
    { minPercent: 90, grade: 'O', point: 10 },
    { minPercent: 80, grade: 'A+', point: 9 },
    { minPercent: 70, grade: 'A', point: 8 },
    { minPercent: 60, grade: 'B+', point: 7 },
    { minPercent: 55, grade: 'B', point: 6 },
    { minPercent: 50, grade: 'C', point: 5 },
    { minPercent: 40, grade: 'P', point: 4 },
    { minPercent: 0, grade: 'F', point: 0 },
  ],
  ciePercent: 40,
  seePassPercent: 40,
};

/**
 * A course's grade from internal (out of `ciePercent`) and end-exam marks (out of the rest):
 * the total's band, unless the end exam is below its pass mark or missed, which is F.
 */
export function courseGrade(
  g: {
    bands: { minPercent: number; grade: string; point: number }[];
    ciePercent: number;
    seePassPercent: number;
  },
  m: { cie: number; see: number; absent: boolean },
): { total: number; grade: string; point: number; passed: boolean } {
  const total = Math.round((m.cie + m.see) * 100) / 100;
  const seeMax = 100 - g.ciePercent;
  const fail = g.bands[g.bands.length - 1] ?? { grade: 'F', point: 0, minPercent: 0 };
  if (m.absent || m.see < (seeMax * g.seePassPercent) / 100)
    return { total, grade: fail.grade, point: fail.point, passed: false };
  const band = g.bands.find((b) => total >= b.minPercent) ?? fail;
  return { total, grade: band.grade, point: band.point, passed: band.point > 0 };
}

/** Credit-weighted grade point average, to two decimals; null with no credits. */
export function gradePointAverage(courses: { credits: number; point: number }[]): number | null {
  const credits = courses.reduce((n, c) => n + c.credits, 0);
  if (credits === 0) return null;
  return Math.round((courses.reduce((n, c) => n + c.credits * c.point, 0) / credits) * 100) / 100;
}

const UGC_UG: Source = {
  title: 'UGC Curriculum and Credit Framework for Undergraduate Programmes (2022); NCrF',
  url: 'https://www.ugc.gov.in/pdfnews/7193743_FYUGP.pdf',
  readOn: '2026-11-14',
  verified: false,
};

export const CREDIT_FRAMEWORKS = {
  UGC_UG3: {
    title: 'UGC undergraduate, 3 years',
    totalCredits: 120,
    perTerm: { min: 18, max: 22 },
    exits: [
      { afterTerm: 2, credits: 40, award: 'UG Certificate' },
      { afterTerm: 4, credits: 80, award: 'UG Diploma' },
      { afterTerm: 6, credits: 120, award: 'Bachelor’s degree' },
    ],
    source: UGC_UG,
  },
  UGC_UG4: {
    title: 'UGC undergraduate, 4 years (honours or research)',
    totalCredits: 160,
    perTerm: { min: 18, max: 22 },
    exits: [
      { afterTerm: 2, credits: 40, award: 'UG Certificate' },
      { afterTerm: 4, credits: 80, award: 'UG Diploma' },
      { afterTerm: 6, credits: 120, award: 'Bachelor’s degree' },
      { afterTerm: 8, credits: 160, award: 'Bachelor’s degree (Honours or Research)' },
    ],
    source: UGC_UG,
  },
  UGC_PG2: {
    title: 'UGC postgraduate, 2 years',
    totalCredits: 80,
    perTerm: { min: 18, max: 22 },
    exits: [{ afterTerm: 4, credits: 80, award: 'Master’s degree' }],
    source: {
      title: 'UGC Curriculum and Credit Framework for Postgraduate Programmes (2024)',
      readOn: '2026-11-14',
      verified: false,
    },
  },
} satisfies Record<string, CreditFramework>;
export type CreditFrameworkCode = keyof typeof CREDIT_FRAMEWORKS;

export function creditFramework(code: string | null): CreditFramework | null {
  return code && code in CREDIT_FRAMEWORKS ? CREDIT_FRAMEWORKS[code as CreditFrameworkCode] : null;
}

/**
 * Professional tax for a month's gross: the special month's amount (Karnataka's February), else
 * the first slab the wage reaches; half-year states levy on six months' gross, a sixth each month.
 */
export function professionalTax(
  rules: PayrollRules['pt'],
  grossPaise: number,
  month: number,
): number {
  if (!rules) return 0;
  if (rules.month && rules.month.month === month && grossPaise >= rules.month.fromPaise)
    return rules.month.amountPaise;
  const wage = rules.period === 'half_year' ? grossPaise * 6 : grossPaise;
  const slab = rules.slabs.find((s) => wage >= s.fromPaise);
  if (!slab) return 0;
  const roundRupee = (paise: number) => Math.floor((paise + 50) / 100) * 100;
  return rules.period === 'half_year'
    ? roundRupee(Math.floor(slab.amountPaise / 6))
    : slab.amountPaise;
}

/** Gratuity under the Code on Social Security (unverified until checked against the order). */
const GRATUITY: GratuityRules = {
  daysPerYear: 15,
  divisor: 26,
  minYears: 5,
  minYearsFixedTerm: 1,
  ceilingPaise: 2_000_000_00,
};

/**
 * Gratuity on leaving: days' wages per year of service over the divisor (15/26 of a month's wages),
 * a part year of six months or more counting as a year. Permanent staff need `minYears` of service,
 * fixed-term staff `minYearsFixedTerm`. Rounded to the rupee and capped at the ceiling.
 */
export function gratuity(
  r: GratuityRules,
  s: { monthlyWagesPaise: number; joinedOn: string; lastDay: string; fixedTerm: boolean },
): { months: number; years: number; eligible: boolean; amountPaise: number } {
  const [jy, jm, jd] = s.joinedOn.split('-').map(Number) as [number, number, number];
  // Whole months from joining to the day after the last day (1 Apr to 31 Mar = 12 months).
  const end = new Date(`${s.lastDay}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const months = Math.max(
    0,
    (end.getUTCFullYear() - jy) * 12 +
      (end.getUTCMonth() + 1 - jm) -
      (end.getUTCDate() < jd ? 1 : 0),
  );
  const years = Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
  const eligible = months >= 12 * (s.fixedTerm ? r.minYearsFixedTerm : r.minYears);
  if (!eligible) return { months, years, eligible, amountPaise: 0 };
  const raw = Math.floor((s.monthlyWagesPaise * r.daysPerYear * years) / r.divisor);
  const rupee = Math.floor((raw + 50) / 100) * 100;
  return { months, years, eligible, amountPaise: Math.min(rupee, r.ceilingPaise) };
}

// ---------------------------------------------------------------------------------------------
// Rule packs (rule book §15.1, §12.4 decision 11): each board, state, regulator and labour pack
// has a payload shape, check functions its test cases call, and a built-in first version made
// from the values above. Later versions are data: drafted, tested and released by Campusverse
// staff, then switched on by each institution from a date (platform/rulepacks).
// ---------------------------------------------------------------------------------------------

const bp = z.number().int().min(0).max(10_000);
const paise = z.number().int().min(0);
const ptSchema = z.object({
  period: z.enum(['month', 'half_year']),
  slabs: z.array(z.object({ fromPaise: paise, amountPaise: paise })),
  month: z
    .object({ month: z.number().int().min(1).max(12), fromPaise: paise, amountPaise: paise })
    .optional(),
});
const boardSchema = z.object({
  attendance: z.object({ minimumBasisPoints: bp, warnBelowBasisPoints: bp }).nullable(),
  grades: z
    .object({
      id: z.string().min(1),
      bands: z.array(z.object({ minBasisPoints: bp, grade: z.string().min(1) })).min(1),
      passBasisPoints: bp,
    })
    .nullable(),
  promotion: z.object({
    boardClasses: z.array(z.string()),
    passMarkClasses: z.array(z.string()),
  }),
});
const stateSchema = z.object({
  pt: ptSchema.nullable(),
  tcDeadlineDays: z.number().int().positive().nullable(),
  /** Optional so versions released before it still read; the built-in values stand in. */
  lwf: z
    .object({
      employeePaise: paise,
      employerPaise: paise,
      months: z.array(z.number().int().min(1).max(12)),
    })
    .nullable()
    .optional(),
});
const gratuitySchema = z.object({
  daysPerYear: z.number().int().positive(),
  divisor: z.number().int().positive(),
  minYears: z.number().int().min(0),
  minYearsFixedTerm: z.number().int().min(0),
  ceilingPaise: paise,
});
const labourSchema = z.object({
  pf: z.object({ rateBp: bp, wageCeilingPaise: paise, epsBp: bp }),
  esi: z.object({ employeeBp: bp, employerBp: bp, grossLimitPaise: paise }),
  /** Optional so versions released before it still read; the built-in values stand in. */
  gratuity: gratuitySchema.optional(),
});
export type GratuityRules = z.infer<typeof gratuitySchema>;
const gradingSchema = z.object({
  /** Best first: the lowest percentage for each letter grade and its grade point. */
  bands: z
    .array(
      z.object({
        minPercent: z.number().min(0).max(100),
        grade: z.string().min(1),
        point: z.number().min(0).max(10),
      }),
    )
    .min(2),
  /** Internal (CIE) share of a course's 100 marks; the end exam has the rest. */
  ciePercent: z.number().min(0).max(100),
  /** The least, as a percentage of the end exam, to pass it whatever the internal marks. */
  seePassPercent: z.number().min(0).max(100),
});
export type GradingRules = z.infer<typeof gradingSchema>;
const courseAttendanceSchema = z.object({
  /** Exam eligibility needs this much attendance in a course. */
  minimumPercent: z.number().min(0).max(100),
  /** Below the minimum but from this level, a shortage may be condoned (with approval). */
  condonableFromPercent: z.number().min(0).max(100),
});
export type CourseAttendanceRules = z.infer<typeof courseAttendanceSchema>;
const creditsSchema = z.object({
  /** Optional so versions released before it still read; the built-in scale stands in. */
  grading: gradingSchema.optional(),
  /** Optional for the same reason; the built-in thresholds stand in. */
  attendance: courseAttendanceSchema.optional(),
  frameworks: z.record(
    z.string(),
    z.object({
      title: z.string(),
      totalCredits: z.number().positive(),
      perTerm: z.object({ min: z.number().min(0), max: z.number().min(0) }),
      exits: z.array(
        z.object({
          afterTerm: z.number().int().min(1),
          credits: z.number().min(0),
          award: z.string(),
        }),
      ),
    }),
  ),
});
export type BoardPack = z.infer<typeof boardSchema>;
export type StatePack = z.infer<typeof stateSchema>;
export type LabourPack = z.infer<typeof labourSchema>;
export type CreditsPack = z.infer<typeof creditsSchema>;

export type PackTest = {
  name: string;
  check: string;
  input: Record<string, unknown>;
  expect: unknown;
};
export type PackVersion = {
  version: number;
  effectiveFrom: string;
  payload: unknown;
  sources: Source[];
  tests: PackTest[];
  notes: string;
};
export type PackKind = 'board' | 'state' | 'labour' | 'regulator';
type Checks<P> = Record<string, (p: P, input: Record<string, unknown>) => unknown>;
type PackDef<P> = {
  kind: PackKind;
  title: string;
  schema: z.ZodType<P>;
  checks: Checks<P>;
  builtin: Omit<PackVersion, 'payload'> & { payload: P };
};
const def = <P>(d: PackDef<P>) => d;
const num = (v: unknown) => Number(v);
const str = (v: unknown) => String(v);

/** How a class moves on at year end under a board pack. */
export function promotionFor(p: BoardPack, classCode: string): PromotionRule {
  if (p.promotion.boardClasses.includes(classCode)) return 'board';
  if (p.promotion.passMarkClasses.includes(classCode)) return 'pass_marks';
  return 'promote';
}
const boardChecks: Checks<BoardPack> = {
  'attendance.short': (p, i) =>
    p.attendance ? num(i.basisPoints) < p.attendance.minimumBasisPoints : null,
  grade: (p, i) =>
    p.grades
      ? gradeFor({ ...p.grades, rounding: 'down_2dp', source: UNSOURCED }, num(i.basisPoints))
      : null,
  promotion: (p, i) => promotionFor(p, str(i.classCode)),
};
const UNSOURCED: Source = { title: '', readOn: '', verified: false };
const strip = <T extends { source: Source }>(v: T): Omit<T, 'source'> => {
  const rest: Partial<T> = { ...v };
  delete rest.source;
  return rest as Omit<T, 'source'>;
};
const stateBuiltin = (code: StateCode): PackDef<StatePack> =>
  def({
    kind: 'state',
    title: STATES[code],
    schema: stateSchema,
    checks: {
      pt: (p, i) => professionalTax(p.pt, num(i.grossPaise), num(i.month)),
      'tc.days': (p) => p.tcDeadlineDays,
      lwf: (p, i) =>
        p.lwf && p.lwf.months.includes(num(i.month))
          ? p.lwf.employeePaise + p.lwf.employerPaise
          : 0,
    },
    builtin: {
      version: 1,
      effectiveFrom: '2026-04-01',
      payload: { pt: PT[code], tcDeadlineDays: TC_DEADLINE[code]?.days ?? null, lwf: LWF[code] },
      sources: [
        {
          title: `${STATES[code]}: professional tax slabs`,
          readOn: '2026-11-13',
          verified: false,
        },
        {
          title: `${STATES[code]}: labour welfare fund, employee and employer shares collected in December`,
          readOn: '2026-11-14',
          verified: false,
        },
        ...(TC_DEADLINE[code] ? [TC_DEADLINE[code].source] : []),
      ],
      tests: [
        ...(code === 'KA'
          ? [
              {
                name: 'February is ₹300 from ₹25,000',
                check: 'pt',
                input: { grossPaise: 3_000_000, month: 2 },
                expect: 30_000,
              },
              {
                name: 'Nothing below ₹25,000',
                check: 'pt',
                input: { grossPaise: 2_499_900, month: 11 },
                expect: 0,
              },
              { name: 'TC within seven days', check: 'tc.days', input: {}, expect: 7 },
              {
                name: 'LWF ₹20 + ₹40 in December',
                check: 'lwf',
                input: { month: 12 },
                expect: 6_000,
              },
              { name: 'No LWF in other months', check: 'lwf', input: { month: 6 }, expect: 0 },
            ]
          : code === 'TN'
            ? [
                {
                  name: 'Half-year slab, a sixth a month',
                  check: 'pt',
                  input: { grossPaise: 800_000, month: 5 },
                  expect: 15_500,
                },
              ]
            : [
                {
                  name: '₹200 above ₹20,000',
                  check: 'pt',
                  input: { grossPaise: 2_500_000, month: 6 },
                  expect: 20_000,
                },
              ]),
      ],
      notes: 'First version, from the values Campusverse has used so far.',
    },
  });

export const PACKS = {
  'board.cbse': def({
    kind: 'board',
    title: 'CBSE',
    schema: boardSchema,
    checks: boardChecks,
    builtin: {
      version: 1,
      effectiveFrom: '2026-04-01',
      payload: {
        attendance: {
          minimumBasisPoints: ATTENDANCE.CBSE.minimumBasisPoints,
          warnBelowBasisPoints: ATTENDANCE.CBSE.warnBelowBasisPoints,
        },
        grades: {
          id: CBSE_8PT.id,
          bands: CBSE_8PT.bands,
          passBasisPoints: CBSE_8PT.passBasisPoints,
        },
        promotion: { boardClasses: ['10', '12'], passMarkClasses: ['9', '11'] },
      },
      sources: [ATTENDANCE.CBSE.source, CBSE_8PT.source],
      tests: [
        { name: 'A1 from 91%', check: 'grade', input: { basisPoints: 9100 }, expect: 'A1' },
        { name: 'A2 just below 91%', check: 'grade', input: { basisPoints: 9099 }, expect: 'A2' },
        { name: 'E below 33%', check: 'grade', input: { basisPoints: 3299 }, expect: 'E' },
        {
          name: 'Short below 75%',
          check: 'attendance.short',
          input: { basisPoints: 7499 },
          expect: true,
        },
        {
          name: 'Not short at 75%',
          check: 'attendance.short',
          input: { basisPoints: 7500 },
          expect: false,
        },
        {
          name: 'Class 10 is a board year',
          check: 'promotion',
          input: { classCode: '10' },
          expect: 'board',
        },
        {
          name: 'Class 9 needs pass marks',
          check: 'promotion',
          input: { classCode: '9' },
          expect: 'pass_marks',
        },
        {
          name: 'No detention in Class 5',
          check: 'promotion',
          input: { classCode: '5' },
          expect: 'promote',
        },
      ],
      notes: 'First version, from the values Campusverse has used so far.',
    },
  }),
  'board.cisce': def({
    kind: 'board',
    title: 'CISCE (ICSE and ISC)',
    schema: boardSchema,
    checks: boardChecks,
    builtin: {
      version: 1,
      effectiveFrom: '2026-04-01',
      payload: {
        attendance: { minimumBasisPoints: 7500, warnBelowBasisPoints: 8000 },
        grades: null,
        promotion: { boardClasses: ['10', '12'], passMarkClasses: ['9', '11'] },
      },
      sources: [
        {
          title: 'CISCE: 75% attendance for ICSE and ISC candidates (regulations, to be checked)',
          readOn: '2026-11-14',
          verified: false,
        },
      ],
      tests: [
        {
          name: 'Short below 75%',
          check: 'attendance.short',
          input: { basisPoints: 7499 },
          expect: true,
        },
        {
          name: 'Class 10 is a board year (ICSE)',
          check: 'promotion',
          input: { classCode: '10' },
          expect: 'board',
        },
        { name: 'No grading set yet', check: 'grade', input: { basisPoints: 9000 }, expect: null },
      ],
      notes:
        'First version: attendance and board years only. Grading waits for the CISCE regulations.',
    },
  }),
  'state.KA': stateBuiltin('KA'),
  'state.TS': stateBuiltin('TS'),
  'state.AP': stateBuiltin('AP'),
  'state.TN': stateBuiltin('TN'),
  'labour.central': def({
    kind: 'labour',
    title: 'EPF and ESI (central)',
    schema: labourSchema,
    checks: {
      gratuity: (p, i) =>
        gratuity(p.gratuity ?? GRATUITY, {
          monthlyWagesPaise: num(i.monthlyWagesPaise),
          joinedOn: str(i.joinedOn),
          lastDay: str(i.lastDay),
          fixedTerm: i.fixedTerm === true,
        }).amountPaise,
      'pf.wage': (p, i) => Math.min(num(i.basicPaise), p.pf.wageCeilingPaise),
      'esi.applies': (p, i) => num(i.grossPaise) <= p.esi.grossLimitPaise,
    },
    builtin: {
      version: 1,
      effectiveFrom: '2025-11-21',
      payload: { ...PAYROLL_CENTRAL, gratuity: GRATUITY },
      sources: [
        {
          title: 'EPF (12% to ₹15,000; EPS 8.33%), ESI (0.75% / 3.25% to ₹21,000)',
          readOn: '2026-11-13',
          verified: false,
        },
        {
          title:
            'Code on Social Security, 2020: gratuity at 15 days’ wages a year (÷ 26), after five years, or one year for fixed-term staff; ceiling ₹20 lakh',
          readOn: '2026-11-14',
          verified: false,
        },
      ],
      tests: [
        {
          name: 'PF wages capped at ₹15,000',
          check: 'pf.wage',
          input: { basicPaise: 2_000_000 },
          expect: 1_500_000,
        },
        {
          name: 'ESI up to ₹21,000 gross',
          check: 'esi.applies',
          input: { grossPaise: 2_100_000 },
          expect: true,
        },
        {
          name: 'No ESI above ₹21,000',
          check: 'esi.applies',
          input: { grossPaise: 2_100_100 },
          expect: false,
        },
      ],
      notes: 'First version, from the values Campusverse has used so far.',
    },
  }),
  'ugc.credits': def({
    kind: 'regulator',
    title: 'UGC credit frameworks',
    schema: creditsSchema,
    checks: {
      'credits.total': (p, i) => p.frameworks[str(i.framework)]?.totalCredits ?? null,
      grade: (p, i) => {
        const g = courseGrade(p.grading ?? UGC_GRADING, {
          cie: num(i.cie),
          see: num(i.see),
          absent: i.absent === true,
        });
        return `${g.grade}:${g.point}`;
      },
      'exit.award': (p, i) =>
        p.frameworks[str(i.framework)]?.exits.find((e) => e.afterTerm === num(i.afterTerm))
          ?.award ?? null,
      'attendance.standing': (p, i) => {
        const a = p.attendance ?? COURSE_ATTENDANCE;
        const pct = num(i.percent);
        return pct >= a.minimumPercent
          ? 'eligible'
          : pct >= a.condonableFromPercent
            ? 'condonable'
            : 'short';
      },
    },
    builtin: {
      version: 1,
      effectiveFrom: '2022-12-12',
      payload: {
        grading: UGC_GRADING,
        attendance: COURSE_ATTENDANCE,
        frameworks: Object.fromEntries(
          Object.entries(CREDIT_FRAMEWORKS).map(([k, v]) => [k, strip(v)]),
        ),
      },
      sources: [UGC_UG],
      tests: [
        {
          name: 'Four-year UG is 160 credits',
          check: 'credits.total',
          input: { framework: 'UGC_UG4' },
          expect: 160,
        },
        { name: 'O from 90', check: 'grade', input: { cie: 38, see: 52 }, expect: 'O:10' },
        {
          name: 'Eligible at 75% attendance',
          check: 'attendance.standing',
          input: { percent: 75 },
          expect: 'eligible',
        },
        {
          name: 'Condonable from 65%',
          check: 'attendance.standing',
          input: { percent: 65 },
          expect: 'condonable',
        },
        {
          name: 'Short below 65%',
          check: 'attendance.standing',
          input: { percent: 64.99 },
          expect: 'short',
        },
        {
          name: 'End exam below 40% of its marks fails',
          check: 'grade',
          input: { cie: 30, see: 10 },
          expect: 'F:0',
        },
        {
          name: 'P at 40 with the end exam passed',
          check: 'grade',
          input: { cie: 16, see: 24 },
          expect: 'P:4',
        },
        {
          name: 'Absent from the end exam fails',
          check: 'grade',
          input: { cie: 40, see: 0, absent: true },
          expect: 'F:0',
        },
        {
          name: 'Diploma after the second year',
          check: 'exit.award',
          input: { framework: 'UGC_UG4', afterTerm: 4 },
          expect: 'UG Diploma',
        },
      ],
      notes: 'First version, from the values Campusverse has used so far.',
    },
  }),
} satisfies Record<
  string,
  | PackDef<never>
  | PackDef<BoardPack>
  | PackDef<StatePack>
  | PackDef<LabourPack>
  | PackDef<CreditsPack>
>;
export type PackCode = keyof typeof PACKS;
export const isPackCode = (c: string): c is PackCode => c in PACKS;

/** Checks a draft payload against its pack's shape. */
export function validatePack(
  code: PackCode,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  const r = (PACKS[code].schema as z.ZodType).safeParse(payload);
  return r.success ? { ok: true } : { ok: false, error: r.error.issues[0]?.message ?? 'invalid' };
}

/** Runs test cases against a payload. A version is released only when every one passes. */
export function runPackTests(
  code: PackCode,
  payload: unknown,
  tests: PackTest[],
): { name: string; passed: boolean; got: unknown; expect: unknown }[] {
  const checks = PACKS[code].checks as Checks<unknown>;
  return tests.map((t) => {
    const check = checks[t.check];
    let got: unknown;
    try {
      got = check ? check(payload, t.input) : `unknown check ${t.check}`;
    } catch (e) {
      got = `error: ${(e as Error).message}`;
    }
    return {
      name: t.name,
      passed: JSON.stringify(got) === JSON.stringify(t.expect),
      got,
      expect: t.expect,
    };
  });
}

/** The packs that apply to an institution: its board (schools), its state, labour, and UGC (higher education). */
export function packsFor(i: {
  profile: string;
  authorityCode: string;
  stateCode: string | null;
}): PackCode[] {
  const board = `board.${i.authorityCode.toLowerCase()}`;
  const state = `state.${i.stateCode ?? ''}`;
  return [
    ...(i.profile === 'school' && isPackCode(board) ? [board] : []),
    ...(isPackCode(state) ? [state] : []),
    'labour.central' as const,
    ...(i.profile !== 'school' ? ['ugc.credits' as const] : []),
  ];
}
