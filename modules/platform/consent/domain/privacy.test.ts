import { describe, expect, it } from 'vitest';
import { certInStatus, coveragePercent, requestDueAt, requestOverdue } from './privacy.js';

const at = (iso: string) => new Date(iso);

describe('privacy rules', () => {
  it('a request is due 30 days after it arrives and overdue only while open', () => {
    const due = requestDueAt(at('2026-11-01T10:00:00Z'));
    expect(due.toISOString()).toBe('2026-12-01T10:00:00.000Z');
    const later = at('2026-12-02T00:00:00Z');
    expect(requestOverdue({ state: 'open', dueAt: due }, later)).toBe(true);
    expect(requestOverdue({ state: 'done', dueAt: due }, later)).toBe(false);
    expect(requestOverdue({ state: 'in_progress', dueAt: due }, at('2026-11-20T00:00:00Z'))).toBe(
      false,
    );
  });

  it('CERT-In: within 6 hours is on time, after is late, unreported past 6 hours is late', () => {
    const discoveredAt = at('2026-11-13T08:00:00Z');
    expect(
      certInStatus({ discoveredAt, certInReportedAt: at('2026-11-13T13:59:00Z') }, new Date()),
    ).toBe('reported');
    expect(
      certInStatus({ discoveredAt, certInReportedAt: at('2026-11-13T14:01:00Z') }, new Date()),
    ).toBe('late');
    expect(certInStatus({ discoveredAt, certInReportedAt: null }, at('2026-11-13T12:00:00Z'))).toBe(
      'due',
    );
    expect(certInStatus({ discoveredAt, certInReportedAt: null }, at('2026-11-13T14:01:00Z'))).toBe(
      'late',
    );
  });

  it('coverage rounds down and is 0 with no students', () => {
    expect(coveragePercent(2, 3)).toBe(66);
    expect(coveragePercent(0, 0)).toBe(0);
  });
});
