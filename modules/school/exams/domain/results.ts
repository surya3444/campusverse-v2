// Pure result rules: marks and codes into subject and overall results. Marks are decimal text
// ("72.5") worked in hundredths, so there is no floating point. No I/O.

export const CODES = ['AB', 'ML', 'UFM', 'EX', 'NA'] as const;
export type Code = (typeof CODES)[number];

/** Codes that count as zero against the maximum, and codes left out of the total. */
const ZERO: ReadonlySet<Code> = new Set(['AB', 'UFM']);

export type Mark = { value: string | null; code: Code | null };
/** One paper: a subject's whole paper (part ''), or one part of it (Theory, Practical). */
export type Paper = {
  paperId: string;
  subjectId: string;
  subject: string;
  max: string;
  part?: string | undefined;
};

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

export type PartResult = {
  part: string;
  /** "62", "AB", or the code left out ("EX"). */
  shown: string;
  /** Hundredths; null when this part doesn't count. */
  max: number | null;
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
  /** The parts, when the subject is split (Theory 62/80, Practical 18/20). */
  parts?: PartResult[];
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
 * Absent and unfair means count as zero; medical, exempt and not applicable are left out. A
 * subject split into parts adds up the parts that count, against their maximums.
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
  const groups = new Map<string, Paper[]>();
  for (const p of papers) groups.set(p.subjectId, [...(groups.get(p.subjectId) ?? []), p]);
  for (const [subjectId, parts] of groups) {
    const subject = parts[0]?.subject ?? '';
    const split = parts.length > 1 || !!parts[0]?.part;
    const label = (p: Paper) => (p.part ? `${subject} · ${p.part}` : subject);
    const missing = parts.filter((p) => {
      const m = marks.get(p.paperId);
      return !m || (m.value === null && m.code === null);
    });
    if (missing.length > 0) {
      missing.forEach((p) => blanks.push(label(p)));
      subjects.push({
        subjectId,
        subject,
        marks: null,
        max: parts.reduce((a, p) => a + (hundredths(p.max) ?? 0), 0),
        shown: '',
        percentBp: null,
        grade: null,
        note: null,
      });
      continue;
    }
    const partRows: PartResult[] = [];
    let got = 0;
    let pmax = 0;
    let counted = 0;
    const leftOut: Code[] = [];
    for (const p of parts) {
      const m = marks.get(p.paperId) as Mark;
      const partMax = hundredths(p.max) ?? 0;
      if (m.code && !ZERO.has(m.code)) {
        leftOut.push(m.code);
        partRows.push({ part: p.part ?? '', shown: m.code, max: null });
        continue;
      }
      const v = m.code ? 0 : (hundredths(m.value ?? '') ?? 0);
      got += v;
      pmax += partMax;
      counted++;
      partRows.push({ part: p.part ?? '', shown: m.code ?? fromHundredths(v), max: partMax });
    }
    if (counted === 0) {
      const code = leftOut[0] as Code;
      subjects.push({
        subjectId,
        subject,
        marks: null,
        max: null,
        shown: code,
        percentBp: null,
        grade: null,
        note: NOTES[code] ?? null,
        ...(split ? { parts: partRows } : {}),
      });
      continue;
    }
    const bp = pmax > 0 ? Math.floor((got * 10_000) / pmax) : 0;
    total += got;
    max += pmax;
    const only = parts.length === 1 ? (marks.get(parts[0]?.paperId ?? '') as Mark) : null;
    subjects.push({
      subjectId,
      subject,
      marks: got,
      max: pmax,
      shown: only?.code ?? fromHundredths(got),
      percentBp: bp,
      grade: grade(bp),
      note: leftOut.length ? (NOTES[leftOut[0] as Code] ?? null) : null,
      ...(split ? { parts: partRows } : {}),
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

/** One exam in a final result: its weight, and each subject's percentage in it. */
export type Component = {
  weightBp: number;
  subjects: { subjectId: string; subject: string; percentBp: number | null }[];
};
export type FinalSubject = {
  subjectId: string;
  subject: string;
  /** The subject's percentage in each exam, in the plan's order; null when not counted there. */
  byExam: (number | null)[];
  /** The weighted year percentage, rounded down; null when no exam counts it. */
  percentBp: number | null;
  grade: string | null;
};

/**
 * The year's result: each subject's percentage is the weighted average of its percentages in the
 * exams that count it (an exam where it was exempt or medical drops out, its weight with it).
 * The overall percentage is the average of the subjects' year percentages. Rounded down.
 */
export function finalResult(
  components: Component[],
  grade: (bp: number) => string,
): { subjects: FinalSubject[]; percentBp: number | null } {
  const order = new Map<string, string>();
  for (const c of components)
    for (const s of c.subjects) if (!order.has(s.subjectId)) order.set(s.subjectId, s.subject);
  const subjects: FinalSubject[] = [];
  for (const [subjectId, subject] of order) {
    const byExam = components.map(
      (c) => c.subjects.find((s) => s.subjectId === subjectId)?.percentBp ?? null,
    );
    let weighted = 0;
    let weights = 0;
    byExam.forEach((p, i) => {
      const w = components[i]?.weightBp ?? 0;
      if (p === null || w <= 0) return;
      weighted += p * w;
      weights += w;
    });
    const percentBp = weights > 0 ? Math.floor(weighted / weights) : null;
    subjects.push({
      subjectId,
      subject,
      byExam,
      percentBp,
      grade: percentBp === null ? null : grade(percentBp),
    });
  }
  const counted = subjects.flatMap((s) => (s.percentBp === null ? [] : [s.percentBp]));
  return {
    subjects,
    percentBp: counted.length
      ? Math.floor(counted.reduce((a, b) => a + b, 0) / counted.length)
      : null,
  };
}

/**
 * A suggested report-card remark, from the student's own marks and attendance, for the class
 * teacher to edit. Worked out here, never by a language model: a child's marks don't leave the
 * system (Verse AI's gateway sends no personal data). Gender-neutral: the first name only.
 */
export function suggestRemark(input: {
  firstName: string;
  subjects: { subject: string; percentBp: number | null }[];
  /** Days attended over working days, in basis points; null when not known. */
  attendanceBp: number | null;
}): string | null {
  const counted = input.subjects.filter(
    (s): s is { subject: string; percentBp: number } => s.percentBp !== null,
  );
  if (counted.length === 0) return null;
  const n = input.firstName.trim() || 'This student';
  const avg = counted.reduce((a, s) => a + s.percentBp, 0) / counted.length;
  const sorted = [...counted].sort((a, b) => b.percentBp - a.percentBp);
  const best = sorted[0] as { subject: string; percentBp: number };
  const worst = sorted.at(-1) as { subject: string; percentBp: number };
  const weak = worst.subject !== best.subject && worst.percentBp < 6_000 ? worst.subject : null;
  let text: string;
  if (avg >= 8_500)
    text = `${n} has done excellent work, especially in ${best.subject}. Keep it up.`;
  else if (avg >= 7_000)
    text = `${n} has done well, with strong work in ${best.subject}.${weak ? ` More practice in ${weak} will help.` : ''}`;
  else if (avg >= 5_000)
    text = `${n} is making steady progress, and ${best.subject} is a strength.${weak ? ` Regular revision of ${weak} is needed.` : ''}`;
  else
    text = `${n} needs support to keep up${weak ? `, especially in ${weak}` : ''}. ${best.subject} shows what ${n} can do; let us work on it together.`;
  if (input.attendanceBp !== null && input.attendanceBp < 7_500)
    text += ' Attendance needs to improve.';
  return text.slice(0, 300);
}
