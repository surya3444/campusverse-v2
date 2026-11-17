import { describe, expect, it } from 'vitest';
import { checkStops, documentStatus, normaliseRegistration, vehicleReadiness } from './vehicle.js';

describe('documentStatus', () => {
  it('is valid, expiring within 30 days, or expired', () => {
    expect(documentStatus('2027-01-01', '2026-11-07')).toBe('valid');
    expect(documentStatus('2026-12-07', '2026-11-07')).toBe('expiring');
    expect(documentStatus('2026-11-07', '2026-11-07')).toBe('expiring');
    expect(documentStatus('2026-11-06', '2026-11-07')).toBe('expired');
  });
});

describe('vehicleReadiness', () => {
  const today = '2026-11-07';
  it('blocks a vehicle whose fitness, insurance or permit is expired or missing', () => {
    const r = vehicleReadiness(
      [
        { kind: 'fitness', validUntil: '2026-10-01' },
        { kind: 'fitness', validUntil: '2027-10-01' },
        { kind: 'insurance', validUntil: '2026-11-01' },
        { kind: 'pollution', validUntil: '2026-11-20' },
      ],
      today,
    );
    expect(r.blocked).toEqual(['insurance', 'permit']);
    expect(r.documents.fitness?.status).toBe('valid'); // the renewal counts
    expect(r.documents.pollution?.status).toBe('expiring');
    expect(r.documents.registration).toBeNull();
  });
  it('lets a vehicle run when the blocking documents are valid', () => {
    const docs = ['fitness', 'insurance', 'permit'].map((kind) => ({
      kind,
      validUntil: '2027-06-01',
    }));
    expect(vehicleReadiness(docs, today).blocked).toEqual([]);
  });
});

describe('checkStops', () => {
  it('needs distinct stops with times that never go backwards', () => {
    const a = { stopId: 'a', plannedAt: '07:10' };
    const b = { stopId: 'b', plannedAt: '07:25' };
    expect(checkStops([a, b])).toBeNull();
    expect(checkStops([])).toBe('no_stops');
    expect(checkStops([a, { ...b, stopId: 'a' }])).toBe('stop_repeated');
    expect(checkStops([b, a])).toBe('times_out_of_order');
  });
});

describe('normaliseRegistration', () => {
  it('drops spaces and dashes and upper-cases', () => {
    expect(normaliseRegistration(' ts 09-ab 1234 ')).toBe('TS09AB1234');
    expect(normaliseRegistration('AB')).toBeNull();
  });
});
