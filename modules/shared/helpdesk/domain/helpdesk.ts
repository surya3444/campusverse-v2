// Pure rules for the helpdesk (docs/specs/HELPDESK.md). Times are epoch milliseconds. No I/O.

export type State = 'open' | 'in_progress' | 'waiting' | 'resolved';
export type Priority = 'normal' | 'urgent';

const HOUR = 3_600_000;
/** A requester can reopen a resolved request with a reply within this long. */
export const REOPEN_DAYS = 7;

/** Due: the category's hours from when it was raised; urgent requests get half. */
export const dueAt = (raisedAt: number, hours: number, priority: Priority) =>
  raisedAt + (priority === 'urgent' ? Math.max(1, Math.round(hours / 2)) : hours) * HOUR;

export const isOverdue = (state: State, due: number, now: number) =>
  state !== 'resolved' && due < now;

/**
 * Where a reply moves a request. The requester answering a question or reopening (within 7 days)
 * puts it back in progress; staff replying to a new request takes it on.
 */
export function afterReply(input: {
  state: State;
  byRequester: boolean;
  internal: boolean;
  resolvedAt: number | null;
  now: number;
}): State | 'closed' {
  if (input.internal) return input.state;
  if (input.byRequester) {
    if (input.state === 'resolved')
      return input.resolvedAt !== null && input.now - input.resolvedAt <= REOPEN_DAYS * 24 * HOUR
        ? 'in_progress'
        : 'closed';
    return input.state === 'waiting' ? 'in_progress' : input.state;
  }
  return input.state === 'open' ? 'in_progress' : input.state;
}
