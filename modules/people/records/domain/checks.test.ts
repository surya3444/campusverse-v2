import { describe, expect, it } from 'vitest';
import { categoryOf, checkState, requiredChecks } from './checks.js';

describe('staff safety checks', () => {
  it('a driver needs a licence, police verification and medical fitness, once each', () => {
    expect(requiredChecks(['driver', 'bus_attendant'])).toEqual([
      'police_verification',
      'driving_licence',
      'medical_fitness',
    ]);
    expect(requiredChecks(['principal'])).toEqual([]);
  });

  it('reads the latest check against today', () => {
    const today = '2026-11-17';
    expect(checkState(undefined, today)).toBe('missing');
    expect(checkState({ validUntil: null }, today)).toBe('ok');
    expect(checkState({ validUntil: '2026-11-16' }, today)).toBe('expired');
    expect(checkState({ validUntil: '2026-11-17' }, today)).toBe('expiring');
    expect(checkState({ validUntil: '2026-12-17' }, today)).toBe('expiring');
    expect(checkState({ validUntil: '2026-12-18' }, today)).toBe('ok');
  });

  it('places work roles in categories', () => {
    expect([
      categoryOf('teacher'),
      categoryOf('office'),
      categoryOf('driver'),
      categoryOf(null),
    ]).toEqual(['teaching', 'administrative', 'support', 'support']);
  });
});
