// The academic engine's rules, pure (rule book §12.4 decisions 2–3, §13.2 Academic Structure).
// One engine for "B.Tech CSE (AI&ML) R25, batch 2025–29" and later "CBSE Class 10-B, 2026–27".
import type { CreditFramework } from '@campusverse/rules';

export const PROGRAM_LEVELS = ['certificate', 'diploma', 'ug', 'pg', 'doctoral'] as const;
export type ProgramLevel = (typeof PROGRAM_LEVELS)[number];
export const TERM_KINDS = ['semester', 'trimester', 'year'] as const;
export type TermKind = (typeof TERM_KINDS)[number];
export const COURSE_KINDS = [
  'core',
  'elective',
  'open_elective',
  'lab',
  'project',
  'value_added',
] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];

/**
 * Odd or even term. Course registration offers the courses of the batch's current term number,
 * so a batch in term 3 can only ever see odd-term courses (the demo's wrong-parity defect).
 */
export const parity = (term: number): 'odd' | 'even' => (term % 2 === 1 ? 'odd' : 'even');

/** "2025–29" for a batch starting in 2025 that runs eight semesters. */
export function batchYears(startYear: number, terms: number, kind: TermKind): string {
  const perYear = kind === 'semester' ? 2 : kind === 'trimester' ? 3 : 1;
  const end = startYear + Math.ceil(terms / perYear);
  return `${startYear}–${String(end).slice(-2)}`;
}

export type CurriculumRow = { termNumber: number; credits: number };

export type RegulationCheck = {
  /** Credits per term, index 0 = term 1. */
  termCredits: number[];
  totalCredits: number;
  /** Stop publishing. */
  blocking: ('empty' | 'term_out_of_range')[];
  /** Shown before publishing; a person decides. */
  warnings: (
    | { kind: 'term_empty'; term: number }
    | { kind: 'term_load'; term: number; credits: number; min: number; max: number }
    | { kind: 'below_minimum'; credits: number; minimum: number }
    | { kind: 'exit_short'; term: number; credits: number; needed: number; award: string }
  )[];
};

/** What a regulation adds up to, against its program's terms, its own minimum and the framework. */
export function checkRegulation(
  rows: CurriculumRow[],
  terms: number,
  minCredits: number | null,
  framework: CreditFramework | null,
): RegulationCheck {
  const termCredits = Array.from({ length: terms }, () => 0);
  const blocking: RegulationCheck['blocking'] = [];
  for (const r of rows) {
    if (r.termNumber < 1 || r.termNumber > terms) blocking.push('term_out_of_range');
    else termCredits[r.termNumber - 1] = (termCredits[r.termNumber - 1] ?? 0) + r.credits;
  }
  if (rows.length === 0) blocking.push('empty');
  const round = (n: number) => Math.round(n * 10) / 10;
  const totalCredits = round(termCredits.reduce((a, b) => a + b, 0));
  const warnings: RegulationCheck['warnings'] = [];
  termCredits.forEach((c, i) => {
    const term = i + 1;
    if (c === 0) warnings.push({ kind: 'term_empty', term });
    else if (framework && (c < framework.perTerm.min || c > framework.perTerm.max))
      warnings.push({ kind: 'term_load', term, credits: round(c), ...framework.perTerm });
  });
  const minimum = minCredits ?? framework?.totalCredits ?? null;
  if (minimum !== null && totalCredits < minimum)
    warnings.push({ kind: 'below_minimum', credits: totalCredits, minimum });
  for (const exit of framework?.exits ?? []) {
    if (exit.afterTerm > terms) continue;
    const upto = round(termCredits.slice(0, exit.afterTerm).reduce((a, b) => a + b, 0));
    if (upto < exit.credits)
      warnings.push({
        kind: 'exit_short',
        term: exit.afterTerm,
        credits: upto,
        needed: exit.credits,
        award: exit.award,
      });
  }
  return {
    termCredits: termCredits.map(round),
    totalCredits,
    blocking: [...new Set(blocking)],
    warnings,
  };
}

/** NCrF: 30 notional hours make one credit; one L or T hour a week, or two P hours, is one credit. */
export const ltpCredits = (l: number, t: number, p: number) => l + t + p / 2;

/** What moving a batch on from its current term does: open the next, or complete the batch. */
export function nextStep(
  current: number,
  terms: number,
): { kind: 'open'; term: number } | { kind: 'complete' } {
  return current >= terms ? { kind: 'complete' } : { kind: 'open', term: current + 1 };
}

/** One internal assessment component of a course (rule book §13.2 "CIE Plan"). */
export type CieComponent = { name: string; maxMarks: number; weight: number };

/** A course's CIE plan is 1–8 named components with positive marks, weights adding up to 100. */
export function validCiePlan(plan: CieComponent[]): boolean {
  return (
    plan.length >= 1 &&
    plan.length <= 8 &&
    new Set(plan.map((c) => c.name.trim().toLowerCase())).size === plan.length &&
    plan.every(
      (c) =>
        c.name.trim().length >= 1 &&
        c.name.trim().length <= 40 &&
        c.maxMarks > 0 &&
        c.maxMarks <= 200 &&
        c.weight > 0,
    ) &&
    Math.abs(plan.reduce((n, c) => n + c.weight, 0) - 100) < 1e-9
  );
}
