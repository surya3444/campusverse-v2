import { describe, expect, it } from 'vitest';
import { applicableSteps, mayDecide, type HeldRole, type PolicyStep } from './workflow.js';

const policy: PolicyStep[] = [
  { role: 'office', minAmountPaise: null, hours: 24, escalateTo: 'principal' },
  { role: 'principal', minAmountPaise: 25_000_00, hours: null, escalateTo: null },
  { role: 'owner', minAmountPaise: 1_00_000_00, hours: null, escalateTo: null },
];
const place = { orgId: 'o', campusId: 'c', institutionId: 'i' };

describe('approval engine rules', () => {
  it('amount limits pick the steps; with none, the process permission decides', () => {
    expect(applicableSteps(policy, 5_000_00).map((s) => s.role)).toEqual(['office']);
    expect(applicableSteps(policy, 25_000_00).map((s) => s.role)).toEqual(['office', 'principal']);
    expect(applicableSteps(policy, 2_00_000_00).map((s) => s.role)).toEqual([
      'office',
      'principal',
      'owner',
    ]);
    expect(applicableSteps([], 10)).toEqual([{ role: null, hours: null, escalateTo: null }]);
    expect(applicableSteps([policy[2]!], null)).toEqual([
      { role: null, hours: null, escalateTo: null },
    ]);
  });

  it('a step is for its role at a covering scope, then for the escalation role once overdue', () => {
    const since = new Date('2026-11-14T00:00:00Z');
    const step = applicableSteps(policy, 100)[0]!;
    const at = (h: number) => new Date(since.getTime() + h * 3_600_000);
    const office: HeldRole[] = [{ roleKey: 'office', scopeType: 'institution', scopeId: 'i' }];
    const elsewhere: HeldRole[] = [{ roleKey: 'office', scopeType: 'institution', scopeId: 'x' }];
    const principal: HeldRole[] = [{ roleKey: 'principal', scopeType: 'campus', scopeId: 'c' }];
    const base = { step, since, place, holdsPermission: false };
    expect(mayDecide({ ...base, now: at(1), roles: office })).toEqual({
      ok: true,
      escalated: false,
    });
    expect(mayDecide({ ...base, now: at(1), roles: elsewhere }).ok).toBe(false);
    expect(mayDecide({ ...base, now: at(23), roles: principal }).ok).toBe(false);
    expect(mayDecide({ ...base, now: at(24), roles: principal })).toEqual({
      ok: true,
      escalated: true,
    });
    const anyone = { role: null, hours: null, escalateTo: null };
    expect(
      mayDecide({ ...base, step: anyone, now: at(1), roles: [], holdsPermission: true }).ok,
    ).toBe(true);
  });
});
