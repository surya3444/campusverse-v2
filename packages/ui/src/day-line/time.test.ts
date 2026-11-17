import { describe, expect, it } from 'vitest';
import { hourTicks, nowInIndia, position, stackRows, toMinutes } from './time.js';

describe('Day Line time', () => {
  it('reads 24-hour times and refuses anything else', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:42')).toBe(582);
    expect(toMinutes('23:59')).toBe(1439);
    for (const bad of ['9:42', '24:00', '12:60', '0942', ''])
      expect(() => toMinutes(bad)).toThrow();
  });

  it('places times along the line and clamps outside the day', () => {
    expect(position('07:00', '07:00', '17:00')).toBe(0);
    expect(position('12:00', '07:00', '17:00')).toBe(0.5);
    expect(position('06:00', '07:00', '17:00')).toBe(0);
    expect(position('19:00', '07:00', '17:00')).toBe(1);
    expect(() => position('08:00', '10:00', '09:00')).toThrow();
  });

  it('reports India time whatever the device zone', () => {
    // 04:12 UTC is 09:42 IST.
    expect(nowInIndia(new Date('2026-11-04T04:12:00Z'))).toBe('09:42');
    expect(nowInIndia(new Date('2026-11-04T18:45:00Z'))).toBe('00:15');
  });

  it('lists whole-hour ticks', () => {
    expect(hourTicks('07:30', '10:00')).toEqual(['08:00', '09:00', '10:00']);
  });

  it('stacks close markers onto separate rows', () => {
    // 09:00 and 09:10 are too close; 10:30 fits back on the first row.
    expect(stackRows(['09:00', '09:10', '10:30', '09:15'], 45)).toEqual([0, 1, 0, 2]);
    // Never more than maxRows.
    expect(stackRows(['09:00', '09:01', '09:02', '09:03'], 45, 3)).toEqual([0, 1, 2, 2]);
  });
});
