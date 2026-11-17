import { describe, expect, it } from 'vitest';
import { afterReply, dueAt, isOverdue } from './helpdesk.js';

const H = 3_600_000;
describe('due and overdue', () => {
  it('gives urgent requests half the time and flags overdue until resolved', () => {
    expect(dueAt(0, 24, 'normal')).toBe(24 * H);
    expect(dueAt(0, 24, 'urgent')).toBe(12 * H);
    expect(dueAt(0, 1, 'urgent')).toBe(1 * H);
    expect(isOverdue('open', 10, 11)).toBe(true);
    expect(isOverdue('resolved', 10, 11)).toBe(false);
    expect(isOverdue('waiting', 10, 9)).toBe(false);
  });
});

describe('afterReply', () => {
  const base = { internal: false, resolvedAt: null, now: 100 * H };
  it('staff take a new request on; internal notes change nothing', () => {
    expect(afterReply({ ...base, state: 'open', byRequester: false })).toBe('in_progress');
    expect(afterReply({ ...base, state: 'open', byRequester: false, internal: true })).toBe('open');
  });
  it('the requester answering moves it back in progress, reopening within 7 days', () => {
    expect(afterReply({ ...base, state: 'waiting', byRequester: true })).toBe('in_progress');
    expect(afterReply({ ...base, state: 'resolved', byRequester: true, resolvedAt: 90 * H })).toBe(
      'in_progress',
    );
    expect(
      afterReply({
        ...base,
        state: 'resolved',
        byRequester: true,
        resolvedAt: 100 * H - 8 * 24 * H,
      }),
    ).toBe('closed');
  });
});
