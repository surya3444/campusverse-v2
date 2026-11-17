// Trip rules (Milestone 18 step 3). Pure: where each child is, from the attendant's marks.
//
// Pickup: each child boards (or doesn't) at their stop; everyone on board is handed to school.
// Drop: children board at school, then are dropped at their stop. Nobody at the stop means the
// child stays on the bus and comes back to school (owner decision 2: for every child, any class).

export type Direction = 'pickup' | 'drop';
export type MarkKind =
  'boarded' | 'not_boarded' | 'dropped' | 'nobody_at_stop' | 'handed_to_school';
export type RiderState = 'expected' | 'on_board' | 'not_boarded' | 'dropped' | 'at_school';

export const MARKS: Record<Direction, readonly MarkKind[]> = {
  pickup: ['boarded', 'not_boarded', 'handed_to_school'],
  drop: ['boarded', 'not_boarded', 'dropped', 'nobody_at_stop', 'handed_to_school'],
};

const STATE: Record<MarkKind, RiderState> = {
  boarded: 'on_board',
  // Still on the bus: the attendant brings the child back and hands them to school.
  nobody_at_stop: 'on_board',
  not_boarded: 'not_boarded',
  dropped: 'dropped',
  handed_to_school: 'at_school',
};

/** The latest mark decides (a correction is just a later mark). No marks: still expected. */
export function riderState(marks: readonly { kind: MarkKind; at: string }[]): RiderState {
  let last: { kind: MarkKind; at: string } | undefined;
  for (const m of marks) if (!last || m.at >= last.at) last = m;
  return last ? STATE[last.kind] : 'expected';
}

export type TripCounts = Record<RiderState, number>;

export function tripCounts(states: readonly RiderState[]): TripCounts {
  const c: TripCounts = { expected: 0, on_board: 0, not_boarded: 0, dropped: 0, at_school: 0 };
  for (const s of states) c[s] += 1;
  return c;
}

/**
 * Whether the attendant may say "Bus is empty": nobody the marks still show on board. Children
 * never marked at all ("expected") don't block: they never got on.
 */
export const canClearEmpty = (states: readonly RiderState[]): boolean =>
  !states.includes('on_board');
