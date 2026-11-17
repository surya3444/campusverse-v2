import { describe, expect, it } from 'vitest';
import { MARKS, canClearEmpty, riderState, tripCounts } from './trip.js';

describe('riderState', () => {
  it('is expected with no marks', () => expect(riderState([])).toBe('expected'));

  it('follows the latest mark, whatever order they arrive in', () => {
    expect(
      riderState([
        { kind: 'dropped', at: '2026-11-09T10:35:00Z' },
        { kind: 'boarded', at: '2026-11-09T10:05:00Z' },
      ]),
    ).toBe('dropped');
  });

  it('keeps a child on board when nobody was at the stop', () => {
    expect(
      riderState([
        { kind: 'boarded', at: '2026-11-09T10:05:00Z' },
        { kind: 'nobody_at_stop', at: '2026-11-09T10:35:00Z' },
      ]),
    ).toBe('on_board');
  });

  it('takes a correction (a later mark) over the first one', () => {
    expect(
      riderState([
        { kind: 'not_boarded', at: '2026-11-09T02:00:00Z' },
        { kind: 'boarded', at: '2026-11-09T02:01:00Z' },
      ]),
    ).toBe('on_board');
  });
});

describe('the empty-bus check', () => {
  it('refuses while anyone is on board', () => {
    expect(canClearEmpty(['dropped', 'on_board'])).toBe(false);
    expect(canClearEmpty(['dropped', 'at_school', 'not_boarded', 'expected'])).toBe(true);
  });

  it('counts each state', () => {
    expect(tripCounts(['on_board', 'on_board', 'dropped'])).toMatchObject({
      on_board: 2,
      dropped: 1,
      expected: 0,
    });
  });
});

describe('marks per direction', () => {
  it('only drop trips drop children', () => {
    expect(MARKS.pickup).not.toContain('dropped');
    expect(MARKS.drop).toContain('nobody_at_stop');
  });
});
