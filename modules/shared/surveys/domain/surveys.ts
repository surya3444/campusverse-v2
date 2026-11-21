// Feedback & Surveys rules (rule book §13.4; docs/specs/SURVEYS.md). Pure.

export const SURVEY_KINDS = [
  'course',
  'faculty',
  'facility',
  'parent',
  'exit',
  'alumni',
  'employer',
  'other',
] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
export const AUDIENCES = ['staff', 'parents', 'students'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const QUESTION_KINDS = ['rating', 'choice', 'text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type Question = {
  kind: QuestionKind;
  prompt: string;
  /** Choice questions only. */
  options: string[];
  /** Rating questions only: how much this question counts in the overall score. */
  weight: number;
};

/** Ready-made questions per kind, so a coordinator starts from something sensible. */
export const TEMPLATES: Record<SurveyKind, Question[]> = {
  course: [
    rating('The course objectives were made clear'),
    rating('The pace and depth suited the class'),
    rating('Assessments matched what was taught'),
    text('What would make this course better?'),
  ],
  faculty: [
    rating('Explains concepts clearly', 2),
    rating('Is punctual and prepared'),
    rating('Is approachable for doubts'),
    text('Anything else about this teacher?'),
  ],
  facility: [
    rating('Classrooms and labs are clean and usable'),
    rating('The library meets my needs'),
    rating('Drinking water and washrooms are adequate', 2),
    text('What facility needs attention first?'),
  ],
  parent: [
    rating('I know how my child is doing at school', 2),
    rating('Teachers respond when I reach out'),
    rating('The school keeps my child safe', 2),
    text('One thing the school should change'),
  ],
  exit: [
    rating('The programme prepared me for what comes next', 2),
    rating('I would recommend this institution'),
    choice('What are you doing next?', ['Higher studies', 'Job', 'Business', 'Other']),
    text('Advice for the institution'),
  ],
  alumni: [
    rating('What I learned is useful in my work', 2),
    rating('The institution keeps in touch'),
    text('How can alumni help current students?'),
  ],
  employer: [
    rating('Graduates have the knowledge the job needs', 2),
    rating('Graduates communicate well'),
    rating('Graduates work well in teams'),
    text('What should graduates learn before joining?'),
  ],
  other: [rating('Overall, how satisfied are you?'), text('Comments')],
};
function rating(prompt: string, weight = 1): Question {
  return { kind: 'rating', prompt, options: [], weight };
}
function text(prompt: string): Question {
  return { kind: 'text', prompt, options: [], weight: 0 };
}
function choice(prompt: string, options: string[]): Question {
  return { kind: 'choice', prompt, options, weight: 0 };
}

export type Answer = {
  rating?: number | null | undefined;
  choice?: string | null | undefined;
  text?: string | null | undefined;
};

/** Checks one answer against its question. Ratings are 1–5; text and choice optional. */
export function answerFits(q: Question, a: Answer | undefined): boolean {
  if (q.kind === 'rating') {
    const r = a?.rating;
    return typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
  }
  if (q.kind === 'choice') return !a?.choice || q.options.includes(a.choice);
  return !a?.text || a.text.length <= 2000;
}

/**
 * The weighted score out of 5 from each rating question's average: Σ(avg × weight) / Σweight,
 * two decimal places. Null when nothing was rated.
 */
export function weightedScore(items: { average: number | null; weight: number }[]): number | null {
  let w = 0;
  let sum = 0;
  for (const i of items)
    if (i.average !== null && i.weight > 0) {
      w += i.weight;
      sum += i.average * i.weight;
    }
  if (w === 0) return null;
  return Math.round((sum / w) * 100) / 100;
}
