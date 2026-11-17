import { describe, expect, it } from 'vitest';
import { busLine, type ChildBus } from './bus';
import { MESSAGES } from './messages';

const t = MESSAGES.en;
const base: ChildBus = {
  direction: 'pickup',
  route: 'Route 3',
  stop: 'Gandhi Nagar',
  stopAt: '07:25',
  skipping: false,
  trip: null,
  mark: null,
  etaMin: null,
  bus: null,
};

describe('busLine', () => {
  it('gives the planned time before the trip', () => {
    expect(busLine(t, 'Asha', base)?.text).toBe(
      "Asha's bus comes to Gandhi Nagar at about 7:25 am.",
    );
  });

  it('says when the bus left and how far it is', () => {
    const l = busLine(t, 'Asha', {
      ...base,
      trip: { running: true, startedAt: '7:05 am' },
      etaMin: 12,
    });
    expect(l).toMatchObject({
      text: "Asha's bus left at 7:05 am.",
      extra: 'About 12 minutes to your stop.',
    });
  });

  it('follows the latest mark, and warns when nobody was at the stop', () => {
    const running = { running: true, startedAt: '3:40 pm' };
    expect(
      busLine(t, 'Asha', {
        ...base,
        direction: 'drop',
        trip: running,
        mark: { kind: 'dropped', at: '4:05 pm' },
      })?.text,
    ).toBe('Asha was dropped at Gandhi Nagar at 4:05 pm.');
    expect(
      busLine(t, 'Asha', {
        ...base,
        direction: 'drop',
        trip: running,
        mark: { kind: 'nobody_at_stop', at: '4:05 pm' },
      })?.tone,
    ).toBe('stop');
  });

  it('shows the parent their own "not today", and nothing for an ended trip without a mark', () => {
    expect(busLine(t, 'Asha', { ...base, skipping: true })?.text).toMatch(
      /isn't taking the bus today/,
    );
    expect(
      busLine(t, 'Asha', { ...base, trip: { running: false, startedAt: '7:05 am' } }),
    ).toBeNull();
  });
});
