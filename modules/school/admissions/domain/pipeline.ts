// Pure admission rules: which moves are allowed, which need a reason, and the age check. No I/O.

export const STATES = [
  'enquiry',
  'contacted',
  'applied',
  'documents_pending',
  'under_review',
  'offered',
  'waitlisted',
  'confirmed',
  'enrolled',
  'lost',
  'withdrawn',
  'rejected',
] as const;
export type State = (typeof STATES)[number];

/** Ending states: the application is closed, and the move needs a reason. */
export const CLOSED: ReadonlySet<State> = new Set(['lost', 'withdrawn', 'rejected']);

/**
 * Moves people make by hand. Offering, confirming and enrolling have their own use cases (seats,
 * fees, records), so they are not plain moves; nor is anything out of a closed or enrolled state.
 */
const MOVES: Record<State, State[]> = {
  enquiry: ['contacted', 'applied', 'lost'],
  contacted: ['applied', 'lost'],
  applied: ['documents_pending', 'under_review', 'waitlisted', 'rejected', 'withdrawn'],
  documents_pending: ['under_review', 'waitlisted', 'rejected', 'withdrawn'],
  under_review: ['documents_pending', 'waitlisted', 'rejected', 'withdrawn'],
  offered: ['withdrawn', 'lost'],
  waitlisted: ['under_review', 'withdrawn', 'lost'],
  confirmed: ['withdrawn'],
  enrolled: [],
  lost: [],
  withdrawn: [],
  rejected: [],
};

export type MoveError = 'not_allowed' | 'reason_required';

export function canMove(from: State, to: State, reason: string | null): MoveError | null {
  if (!MOVES[from].includes(to)) return 'not_allowed';
  if (CLOSED.has(to) && (reason ?? '').trim().length < 3) return 'reason_required';
  return null;
}

/** States from which an offer can be made. */
export const OFFERABLE: ReadonlySet<State> = new Set([
  'applied',
  'documents_pending',
  'under_review',
  'waitlisted',
]);

/** Seats count as taken from the offer onwards, so a class can't be over-offered. */
export const HOLDS_SEAT: ReadonlySet<State> = new Set(['offered', 'confirmed', 'enrolled']);

export type AgeCheck =
  | { status: 'no_rule' }
  | { status: 'no_date_of_birth' }
  | { status: 'ok'; years: number; cutOffDate: string }
  | {
      status: 'too_young' | 'too_old';
      years: number;
      cutOffDate: string;
      minYears: number;
      maxYears: number | null;
    };

/** Age on the cut-off date of the admission year ("2027-28" → 2027) against the rule pack. */
export function ageCheck(
  rule: { minYears: number; maxYears: number | null; cutOff: string } | null,
  dateOfBirth: string | null,
  yearLabel: string,
  completedYears: (dob: string, on: string) => number,
): AgeCheck {
  if (!rule) return { status: 'no_rule' };
  if (!dateOfBirth) return { status: 'no_date_of_birth' };
  const cutOffDate = `${yearLabel.slice(0, 4)}-${rule.cutOff}`;
  const years = completedYears(dateOfBirth, cutOffDate);
  if (years < rule.minYears)
    return {
      status: 'too_young',
      years,
      cutOffDate,
      minYears: rule.minYears,
      maxYears: rule.maxYears,
    };
  if (rule.maxYears !== null && years > rule.maxYears) {
    return {
      status: 'too_old',
      years,
      cutOffDate,
      minYears: rule.minYears,
      maxYears: rule.maxYears,
    };
  }
  return { status: 'ok', years, cutOffDate };
}

/** What the office does after enrolling; shown as a checklist. */
export function handover(input: {
  documentsPending: boolean;
  rte: boolean;
  sibling: boolean;
}): string[] {
  return [
    ...(input.documentsPending ? ['collect_documents'] : []),
    ...(input.rte ? ['request_rte_concession'] : []),
    ...(input.sibling ? ['review_sibling_concession'] : []),
    'send_parent_invite',
    'issue_id_card',
  ];
}
