import { describe, expect, it } from 'vitest';
import { CATALOGUE, isSensitive, planGrants, roleKey } from './catalogue.js';

const holds = new Set(Object.keys(CATALOGUE));

describe('planGrants', () => {
  it('adds ordinary permissions now, holds sensitive ones for approval, removes at once', () => {
    const r = planGrants({
      roleKey: 'custom_accounts',
      current: ['finance.invoice.read', 'school.exam.read'],
      pending: [],
      wanted: ['finance.invoice.read', 'finance.refund.request', 'finance.refund.approve'],
      actorHolds: holds,
    });
    expect(r).toEqual({
      ok: true,
      plan: {
        add: ['finance.refund.request'],
        request: ['finance.refund.approve'],
        remove: ['school.exam.read'],
      },
    });
  });

  it('never asks twice for a permission already waiting', () => {
    const r = planGrants({
      roleKey: 'custom_accounts',
      current: [],
      pending: ['finance.refund.approve'],
      wanted: ['finance.refund.approve'],
      actorHolds: holds,
    });
    expect(r).toEqual({ ok: true, plan: { add: [], request: [], remove: [] } });
  });

  it('refuses to give what the person does not hold', () => {
    const r = planGrants({
      roleKey: 'custom_helper',
      current: [],
      pending: [],
      wanted: ['school.exam.read', 'finance.day.close'],
      actorHolds: new Set(['school.exam.read']),
    });
    expect(r).toEqual({ ok: false, error: 'not_held', permissions: ['finance.day.close'] });
  });

  it('refuses unknown permissions and the locked roles', () => {
    expect(
      planGrants({
        roleKey: 'teacher',
        current: [],
        pending: [],
        wanted: ['school.everything.do'],
        actorHolds: holds,
      }),
    ).toMatchObject({ ok: false, error: 'unknown_permission' });
    for (const key of ['owner', 'parent'])
      expect(
        planGrants({ roleKey: key, current: [], pending: [], wanted: [], actorHolds: holds }),
      ).toMatchObject({ ok: false, error: 'locked' });
  });

  it('treats anything not in the catalogue as sensitive', () => {
    expect(isSensitive('finance.refund.approve')).toBe(true);
    expect(isSensitive('school.exam.read')).toBe(false);
    expect(isSensitive('made.up.permission')).toBe(true);
  });
});

describe('roleKey', () => {
  it('makes a custom key from the name, unique among taken keys', () => {
    expect(roleKey('Accounts clerk', new Set())).toBe('custom_accounts_clerk');
    expect(roleKey('Accounts clerk', new Set(['custom_accounts_clerk']))).toBe(
      'custom_accounts_clerk_2',
    );
    expect(roleKey('हिंदी', new Set())).toBe('custom_role');
  });
});
