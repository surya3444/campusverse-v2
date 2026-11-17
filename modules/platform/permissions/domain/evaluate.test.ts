import { describe, expect, it } from 'vitest';
import { evaluate, type Grant, type PermissionSnapshot } from './evaluate.js';

const ORG = 'org-a';
const place = { campusId: 'campus-1', institutionId: 'school-1' };

const grant = (g: Partial<Grant>): Grant => ({
  permission: 'people.student.read',
  scopeType: 'organisation',
  scopeId: ORG,
  relation: null,
  guardianFlag: null,
  ...g,
});

const snap = (grants: Grant[], guardianOf: PermissionSnapshot['guardianOf'] = {}) => ({
  orgId: ORG,
  personId: 'me',
  grants,
  guardianOf,
});

describe('evaluate', () => {
  it('allows an organisation-wide grant anywhere in the organisation', () => {
    expect(evaluate(snap([grant({})]), 'people.student.read', { orgId: ORG, place })).toEqual({
      allowed: true,
    });
  });

  it('denies another tenant even with a matching grant', () => {
    expect(evaluate(snap([grant({})]), 'people.student.read', { orgId: 'org-b' })).toEqual({
      allowed: false,
      reason: 'other_tenant',
    });
  });

  it('denies a permission the person was never granted', () => {
    expect(evaluate(snap([grant({})]), 'finance.receipt.void', { orgId: ORG })).toMatchObject({
      reason: 'no_grant',
    });
  });

  it('matches institution and campus scopes only at that place', () => {
    const s = snap([grant({ scopeType: 'institution', scopeId: 'school-1' })]);
    expect(evaluate(s, 'people.student.read', { orgId: ORG, place }).allowed).toBe(true);
    expect(
      evaluate(s, 'people.student.read', {
        orgId: ORG,
        place: { campusId: 'campus-1', institutionId: 'school-2' },
      }),
    ).toMatchObject({ reason: 'out_of_scope' });
    expect(evaluate(s, 'people.student.read', { orgId: ORG })).toMatchObject({
      reason: 'out_of_scope',
    });

    const c = snap([grant({ scopeType: 'campus', scopeId: 'campus-1' })]);
    expect(evaluate(c, 'people.student.read', { orgId: ORG, place }).allowed).toBe(true);
  });

  it('requires an active guardian link for guardian grants', () => {
    const s = snap([grant({ relation: 'guardian' })], { 'child-1': [] });
    const read = (subjectPersonId?: string) =>
      evaluate(s, 'people.student.read', {
        orgId: ORG,
        ...(subjectPersonId ? { subjectPersonId } : {}),
      });
    expect(read('child-1').allowed).toBe(true);
    expect(read('child-2')).toMatchObject({ reason: 'no_relationship' });
    expect(read()).toMatchObject({ reason: 'no_relationship' });
  });

  it('requires the guardian flag when the grant names one', () => {
    const g = grant({
      permission: 'finance.invoice.read',
      relation: 'guardian',
      guardianFlag: 'is_fee_payer',
    });
    const r = { orgId: ORG, subjectPersonId: 'child-1' };
    expect(evaluate(snap([g], { 'child-1': [] }), 'finance.invoice.read', r)).toMatchObject({
      reason: 'no_relationship',
    });
    expect(
      evaluate(snap([g], { 'child-1': ['is_fee_payer'] }), 'finance.invoice.read', r).allowed,
    ).toBe(true);
  });

  it('self grants apply only to the actor', () => {
    const s = snap([grant({ permission: 'people.person.read', relation: 'self' })]);
    expect(evaluate(s, 'people.person.read', { orgId: ORG, subjectPersonId: 'me' }).allowed).toBe(
      true,
    );
    expect(
      evaluate(s, 'people.person.read', { orgId: ORG, subjectPersonId: 'someone' }),
    ).toMatchObject({ reason: 'no_relationship' });
  });

  it('denies when module state is closed, after everything else passes', () => {
    expect(
      evaluate(snap([grant({})]), 'people.student.read', { orgId: ORG, stateAllows: false }),
    ).toMatchObject({ reason: 'state_closed' });
  });

  it('allows if any one in-scope grant holds', () => {
    const s = snap(
      [grant({ relation: 'guardian' }), grant({ scopeType: 'institution', scopeId: 'school-1' })],
      {},
    );
    expect(
      evaluate(s, 'people.student.read', { orgId: ORG, place, subjectPersonId: 'x' }).allowed,
    ).toBe(true);
  });
});

describe('case grants (rule book §10.3)', () => {
  const cases = [
    {
      id: 'case-1',
      permission: 'health.record.read',
      subjectPersonId: 'student-7',
      expiresAt: '2026-11-20T00:00:00Z',
    },
  ];
  const now = new Date('2026-11-15T00:00:00Z');
  const s = { ...snap([grant({ permission: 'health.report.read' })]), cases };
  it('allow one permission about one person until they expire', () => {
    expect(
      evaluate(s, 'health.record.read', { orgId: ORG, place, subjectPersonId: 'student-7' }, now),
    ).toEqual({ allowed: true, case: 'case-1' });
    expect(
      evaluate(s, 'health.record.read', { orgId: ORG, place, subjectPersonId: 'student-8' }, now),
    ).toEqual({ allowed: false, reason: 'no_grant' });
    expect(
      evaluate(s, 'health.record.update', { orgId: ORG, place, subjectPersonId: 'student-7' }, now),
    ).toEqual({ allowed: false, reason: 'no_grant' });
    expect(
      evaluate(
        s,
        'health.record.read',
        { orgId: ORG, place, subjectPersonId: 'student-7' },
        new Date('2026-11-21T00:00:00Z'),
      ),
    ).toEqual({ allowed: false, reason: 'no_grant' });
  });
  it('never in another tenant or against closed state', () => {
    expect(
      evaluate(
        s,
        'health.record.read',
        { orgId: 'org-b', place, subjectPersonId: 'student-7' },
        now,
      ),
    ).toEqual({ allowed: false, reason: 'other_tenant' });
    expect(
      evaluate(
        s,
        'health.record.read',
        { orgId: ORG, place, subjectPersonId: 'student-7', stateAllows: false },
        now,
      ),
    ).toEqual({ allowed: false, reason: 'no_grant' });
  });
});
