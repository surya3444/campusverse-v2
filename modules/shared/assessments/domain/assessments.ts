// Assessments rules (rule book §13.2; docs/specs/ASSESSMENTS.md). Pure.

export const QUESTION_KINDS = ['mcq', 'short', 'long'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** Revised Bloom's taxonomy, lowest to highest. */
export const BLOOM = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'] as const;
export type Bloom = (typeof BLOOM)[number];

export type Tagged = {
  marks: number;
  difficulty: Difficulty;
  bloom: Bloom;
  coCode: string | null;
};

export type Blueprint = {
  questions: number;
  marks: number;
  /** Marks per level, every level present (0 when unused), in taxonomy order. */
  bloom: Record<Bloom, number>;
  difficulty: Record<Difficulty, number>;
  /** Marks per CO code, sorted; questions without a CO are under `null`'s count below. */
  co: { code: string; marks: number }[];
  noCo: number;
  /** Share of marks at apply level or above, 0–100, whole numbers. */
  higherOrder: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** How a paper's marks spread over Bloom levels, difficulty and COs. */
export function blueprint(items: Tagged[]): Blueprint {
  const bloom = Object.fromEntries(BLOOM.map((b) => [b, 0])) as Record<Bloom, number>;
  const difficulty = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<
    Difficulty,
    number
  >;
  const co = new Map<string, number>();
  let marks = 0;
  let noCo = 0;
  for (const i of items) {
    marks += i.marks;
    bloom[i.bloom] = r2(bloom[i.bloom] + i.marks);
    difficulty[i.difficulty] = r2(difficulty[i.difficulty] + i.marks);
    if (i.coCode) co.set(i.coCode, r2((co.get(i.coCode) ?? 0) + i.marks));
    else noCo += 1;
  }
  const higher = bloom.apply + bloom.analyse + bloom.evaluate + bloom.create;
  return {
    questions: items.length,
    marks: r2(marks),
    bloom,
    difficulty,
    co: [...co]
      .map(([code, m]) => ({ code, marks: m }))
      .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })),
    noCo,
    higherOrder: marks === 0 ? 0 : Math.round((higher / marks) * 100),
  };
}

export type QuestionShape = {
  kind: QuestionKind;
  options: string[];
  answer: string | null;
};

/** Why a question can't be saved as given, or null. Mirrors the table's checks. */
export function questionProblem(q: QuestionShape): 'options' | 'answer' | null {
  if (q.kind === 'mcq') {
    const opts = q.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2 || opts.length > 6 || new Set(opts).size !== opts.length) return 'options';
    if (!q.answer || !opts.includes(q.answer.trim())) return 'answer';
    return null;
  }
  return q.options.length > 0 ? 'options' : null;
}
