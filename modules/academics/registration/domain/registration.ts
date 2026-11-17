// Course registration rules, pure (rule book §13.2 Registrations, Credit Rules, Elective Baskets).

/** Course types a student chooses; the rest (core, lab, project) every student of the term takes. */
export const CHOSEN_KINDS = ['elective', 'open_elective', 'value_added'] as const;
export const isChosen = (kind: string) => (CHOSEN_KINDS as readonly string[]).includes(kind);

export type Offered = { courseId: string; code: string; kind: string; credits: number };

export type SelectionProblem =
  | { kind: 'not_offered'; courseId: string }
  | { kind: 'below_min'; credits: number; min: number }
  | { kind: 'above_max'; credits: number; max: number }
  | { kind: 'full'; code: string };

/**
 * The courses a student ends up with for the term: every compulsory course of the term, plus the
 * chosen electives. A chosen id that isn't an elective of this term (another semester's course,
 * a core course) is refused, so a registration can never cross parity. `seatsLeft` holds, for
 * capped electives, the seats still free not counting this student's own current seat.
 */
export function checkSelection(input: {
  offered: Offered[];
  chosen: string[];
  min: number;
  max: number;
  seatsLeft: Record<string, number>;
}): { courses: Offered[]; credits: number; problems: SelectionProblem[] } {
  const problems: SelectionProblem[] = [];
  const byId = new Map(input.offered.map((c) => [c.courseId, c]));
  const chosen = [...new Set(input.chosen)];
  for (const id of chosen) {
    const c = byId.get(id);
    if (!c || !isChosen(c.kind)) problems.push({ kind: 'not_offered', courseId: id });
    else if (id in input.seatsLeft && (input.seatsLeft[id] ?? 0) <= 0)
      problems.push({ kind: 'full', code: c.code });
  }
  const courses = input.offered.filter((c) => !isChosen(c.kind) || chosen.includes(c.courseId));
  const credits = Math.round(courses.reduce((n, c) => n + c.credits, 0) * 10) / 10;
  if (credits < input.min) problems.push({ kind: 'below_min', credits, min: input.min });
  if (credits > input.max) problems.push({ kind: 'above_max', credits, max: input.max });
  return { courses, credits, problems };
}

/** Default credit limits for a window: the framework's term load, else compulsory to everything. */
export function defaultLimits(
  offered: Offered[],
  perTerm: { min: number; max: number } | null,
): { min: number; max: number } {
  if (perTerm) return perTerm;
  const sum = (cs: Offered[]) => Math.round(cs.reduce((n, c) => n + c.credits, 0) * 10) / 10;
  return { min: sum(offered.filter((c) => !isChosen(c.kind))), max: sum(offered) };
}
