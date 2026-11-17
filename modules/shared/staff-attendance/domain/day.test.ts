import { describe, expect, it } from 'vitest';
import {
  distanceMetres,
  istDate,
  monthTotals,
  onCampus,
  summariseDay,
  type Settings,
} from './day.js';

const settings: Settings = {
  startsAt: '08:30',
  endsAt: '15:30',
  lateAfterMinutes: 10,
  earlyBeforeMinutes: 10,
  fullDayMinutes: 300,
};
// 6 Nov 2026 in India (UTC+5:30): 08:35 IST is 03:05 UTC.
const ist = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 6, h! - 5, m! - 30)).toISOString();
};

describe('location', () => {
  it('measures the distance between two points on the ground', () => {
    // About 1.1 km per 0.01 degree of latitude.
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.59 })).toBeGreaterThan(
      1100,
    );
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.98, lng: 77.59 })).toBeLessThan(
      1120,
    );
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(0);
  });

  it('counts a check-in within the radius as on campus, and says how far it was', () => {
    const gate = { lat: 12.971599, lng: 77.594566 };
    expect(onCampus({ lat: 12.9717, lng: 77.5946 }, gate, 200)).toMatchObject({ inside: true });
    expect(onCampus({ lat: 12.98, lng: 77.6 }, gate, 200)).toMatchObject({ inside: false });
    expect(onCampus({ lat: 12.98, lng: 77.6 }, gate, 200).distance).toBeGreaterThan(1000);
  });
});

describe('the day', () => {
  it('is present, on time, when in before the grace time and out after the end', () => {
    expect(
      summariseDay(
        [
          { direction: 'in', at: ist('08:35') },
          { direction: 'out', at: ist('15:45') },
        ],
        settings,
      ),
    ).toEqual({
      status: 'present',
      firstIn: ist('08:35'),
      lastOut: ist('15:45'),
      late: false,
      leftEarly: false,
    });
  });

  it('marks late after the grace time, and early leaving before the end', () => {
    expect(
      summariseDay(
        [
          { direction: 'in', at: ist('08:41') },
          { direction: 'out', at: ist('15:15') },
        ],
        settings,
      ),
    ).toMatchObject({ status: 'present', late: true, leftEarly: true });
  });

  it('is a half day when the time between in and out is short of a full day', () => {
    expect(
      summariseDay(
        [
          { direction: 'in', at: ist('08:30') },
          { direction: 'out', at: ist('12:00') },
        ],
        settings,
      ),
    ).toMatchObject({ status: 'half_day' });
  });

  it('takes the first in and the last out, whatever the order of extra taps', () => {
    expect(
      summariseDay(
        [
          { direction: 'out', at: ist('14:00') },
          { direction: 'in', at: ist('09:00') },
          { direction: 'in', at: ist('08:50') },
          { direction: 'out', at: ist('16:00') },
        ],
        settings,
      ),
    ).toMatchObject({ firstIn: ist('08:50'), lastOut: ist('16:00'), late: true, leftEarly: false });
  });

  it('is present with no out yet, and nothing at all without an in', () => {
    expect(summariseDay([{ direction: 'in', at: ist('08:20') }], settings)).toMatchObject({
      status: 'present',
      lastOut: null,
      leftEarly: false,
    });
    expect(summariseDay([{ direction: 'out', at: ist('15:40') }], settings)).toBeNull();
  });

  it('dates a time by the day in India', () => {
    expect(istDate(ist('00:10'))).toBe('2026-11-06');
    expect(istDate('2026-11-05T19:00:00.000Z')).toBe('2026-11-06');
  });
});

describe('the month', () => {
  it('adds up statuses, late days and early leaving', () => {
    expect(
      monthTotals([
        { status: 'present', late: true, leftEarly: false },
        { status: 'present', late: false, leftEarly: true },
        { status: 'half_day', late: false, leftEarly: false },
        { status: 'absent', late: false, leftEarly: false },
        { status: 'on_leave', late: false, leftEarly: false },
        { status: 'on_duty', late: false, leftEarly: false },
      ]),
    ).toEqual({
      present: 2,
      half_day: 1,
      absent: 1,
      on_leave: 1,
      on_duty: 1,
      late: 1,
      leftEarly: 1,
      worked: 3.5,
    });
  });
});
