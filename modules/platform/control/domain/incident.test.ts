import { describe, expect, it } from 'vitest';
import { incidentClocks } from './incident.js';

const base = {
  discoveredAt: '2026-11-05T04:00:00.000Z',
  personalData: true,
  certinReportedAt: null,
  boardNotifiedAt: null,
  schoolsNotifiedAt: null,
};

describe('incident clocks', () => {
  it('runs 6 hours for CERT-In and 72 for the Board and schools, from discovery', () => {
    const c = incidentClocks(base, new Date('2026-11-05T09:00:00Z'));
    expect(c.certin).toEqual({ due: '2026-11-05T10:00:00.000Z', doneAt: null, overdue: false });
    expect(c.board?.due).toBe('2026-11-08T04:00:00.000Z');
    expect(incidentClocks(base, new Date('2026-11-05T10:00:01Z')).certin.overdue).toBe(true);
  });

  it('stops counting a step once done, and skips Board and schools without personal data', () => {
    const late = new Date('2026-11-09T00:00:00Z');
    const done = incidentClocks({ ...base, certinReportedAt: '2026-11-05T05:00:00Z' }, late);
    expect(done.certin.overdue).toBe(false);
    expect(done.board?.overdue).toBe(true);
    expect(incidentClocks({ ...base, personalData: false }, late).board).toBeNull();
  });
});
