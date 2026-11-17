// Pure result rules: marks and codes into subject and overall results. Marks are decimal text
// ("72.5") worked in hundredths, so there is no floating point. No I/O.

export const CODES = ['AB', 'ML', 'UFM', 'EX', 'NA'] as const;
export type Code = (typeof CODES)[number];

/** Codes that count as zero against the maximum, and codes left out of the total. */
const ZERO: ReadonlySet<Code> = new Set(['AB', 'UFM']);

export type Mark = { value: string | null; code: Code | null };
export type Paper = { paperId: string; subjectId: string; subject: string; max: string };

/** "72.5" → 7250 hundredths; null for anything that isn't a mark with at most two decimals. */
export function hundredths(text: string): number | null {
  const m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m?.[1]) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export const fromHundredths = (h: number) => {
  const s = `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

export type SubjectResult = {
  subjectId: string;
  subject: string;
  /** Hundredths of a mark; null when the subject doesn't count (ML, EX, NA). */
  marks: number | null;
  max: number | null;
  shown: string;
  /** Basis points, rounded down; null when not counted. */
  percentBp: number | null;
  grade: string | null;
  note: string | null;
};

export type Result = {
  subjects: SubjectResult[];
  marks: number;
  max: number;
  percentBp: number | null;
  blanks: string[];
};

const NOTES: Partial<Record<Code, string>> = {
  ML: 'Medical: not counted',
  EX: 'Exempt: not counted',
  NA: 'Joined later: not counted',
};

/**
 * One student's result for an exam. A blank is never zero: blanks are listed and stop publishing.
 * Absent and unfair means count as zero; medical, exempt and not applicable are left out.
 */
export function result(
  papers: Paper[],
  marks: ReadonlyMap<string, Mark>,
  grade: (bp: number) => string,
): Result {
  const subjects: SubjectResult[] = [];
  const blanks: string[] = [];
  let total = 0;
  let max = 0;
  for (const p of papers) {
    const m = marks.get(p.paperId);
    const pmax = hundredths(p.max) ?? 0;
    if (!m || (m.value === null && m.code === null)) {
      blanks.push(p.subject);
      subjects.push({
        subjectId: p.subjectId,
        subject: p.subject,
        marks: null,
        max: pmax,
        shown: '',
        percentBp: null,
        grade: null,
        note: null,
      });
      continue;
    }
    if (m.code && !ZERO.has(m.code)) {
      subjects.push({
        subjectId: p.subjectId,
        subject: p.subject,
        marks: null,
        max: null,
        shown: m.code,
        percentBp: null,
        grade: null,
        note: NOTES[m.code] ?? null,
      });
      continue;
    }
    const got = m.code ? 0 : (hundredths(m.value ?? '') ?? 0);
    const bp = pmax > 0 ? Math.floor((got * 10_000) / pmax) : 0;
    total += got;
    max += pmax;
    subjects.push({
      subjectId: p.subjectId,
      subject: p.subject,
      marks: got,
      max: pmax,
      shown: m.code ?? fromHundredths(got),
      percentBp: bp,
      grade: grade(bp),
      note: null,
    });
  }
  return {
    subjects,
    marks: total,
    max,
    percentBp: max > 0 ? Math.floor((total * 10_000) / max) : null,
    blanks,
  };
}
