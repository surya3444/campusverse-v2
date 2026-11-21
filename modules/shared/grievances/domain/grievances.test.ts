import { describe, expect, it } from 'vitest';
import { canMove, overdue } from './grievances.js';

describe('grievance rules', () => {
  it('moves cases forward only, and only the raiser appeals', () => {
    expect(canMove('received', 'inquiry', 'committee')).toBe(true);
    expect(canMove('inquiry', 'received', 'committee')).toBe(false);
    expect(canMove('decided', 'appealed', 'committee')).toBe(false);
    expect(canMove('decided', 'appealed', 'raiser')).toBe(true);
    expect(canMove('decided', 'closed', 'raiser')).toBe(false);
    expect(canMove('closed', 'inquiry', 'committee')).toBe(false);
  });
  it('flags an undecided case past its days', () => {
    expect(overdue('inquiry', '2026-08-01', 90, '2026-11-19')).toBe(true);
    expect(overdue('inquiry', '2026-11-01', 90, '2026-11-19')).toBe(false);
    expect(overdue('decided', '2026-01-01', 15, '2026-11-19')).toBe(false);
  });
});
