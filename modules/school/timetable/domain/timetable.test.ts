import { describe, expect, it } from 'vitest';
import { checkPeriods, targets, versionStatus, weekday } from './timetable.js';

describe('checkPeriods', () => {
  const p = (startsAt: string, endsAt: string, kind: 'class' | 'break' = 'class') => ({
    startsAt,
    endsAt,
    kind,
  });

  it('takes a normal school day with a break', () => {
    expect(
      checkPeriods([p('08:00', '08:40'), p('08:40', '09:00', 'break'), p('09:00', '09:40')]),
    ).toBeNull();
  });

  it('refuses no class periods, bad times and overlaps', () => {
    expect(checkPeriods([])).toBe('no_periods');
    expect(checkPeriods([p('10:00', '10:20', 'break')])).toBe('no_periods');
    expect(checkPeriods([p('09:00', '08:40')])).toBe('bad_time');
    expect(checkPeriods([p('8:00', '08:40')])).toBe('bad_time');
    expect(checkPeriods([p('08:00', '08:45'), p('08:40', '09:20')])).toBe('periods_overlap');
  });
});

describe('versionStatus', () => {
  const v = [
    { id: 'a', state: 'published' as const, effectiveFrom: '2026-06-01' },
    { id: 'b', state: 'published' as const, effectiveFrom: '2026-10-01' },
    { id: 'c', state: 'published' as const, effectiveFrom: '2026-12-01' },
    { id: 'd', state: 'draft' as const, effectiveFrom: null },
  ];

  it('marks the latest started version current, earlier ones superseded, later ones scheduled', () => {
    const s = versionStatus(v, '2026-11-08');
    expect([...s.entries()]).toEqual([
      ['a', 'superseded'],
      ['b', 'current'],
      ['c', 'scheduled'],
      ['d', 'draft'],
    ]);
  });

  it('switches on the day the next version takes effect', () => {
    expect(versionStatus(v, '2026-12-01').get('c')).toBe('current');
  });
});

describe('weekday and targets', () => {
  it('gives ISO weekdays', () => {
    expect(weekday('2026-11-09')).toBe(1); // a Monday
    expect(weekday('2026-11-08')).toBe(7); // a Sunday
  });

  it('counts periods placed against the target', () => {
    expect(
      targets(
        [{ subjectId: 'm' }, { subjectId: 'm' }, { subjectId: 'e' }],
        [
          { subjectId: 'm', periodsPerWeek: 6 },
          { subjectId: 'e', periodsPerWeek: null },
          { subjectId: 's', periodsPerWeek: 5 },
        ],
      ),
    ).toEqual([
      { subjectId: 'm', placed: 2, target: 6 },
      { subjectId: 'e', placed: 1, target: null },
      { subjectId: 's', placed: 0, target: 5 },
    ]);
  });
});
