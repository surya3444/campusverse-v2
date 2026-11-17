// Cross-module check (school module, per the rules): every staff permission the role templates
// grant is in the access catalogue, so the roles screen can show it and decide if it's sensitive.
import { CATALOGUE, NAMED_HEALTH } from '@campusverse/platform-access';
import { describe, expect, it } from 'vitest';
import { SCHOOL_ROLES } from '../application/roles.js';

describe('role templates and the permission catalogue', () => {
  it('lists every plain permission the templates grant', () => {
    const plain = Object.values(SCHOOL_ROLES)
      .flatMap((r) => r.grants)
      .filter((g) => !g.relation)
      .map((g) => g.permission);
    expect(plain.filter((p) => !CATALOGUE[p])).toEqual([]);
  });

  it('gives the owner everything in the catalogue except named health data', () => {
    const owner = new Set(SCHOOL_ROLES.owner?.grants.map((g) => g.permission));
    expect(Object.keys(CATALOGUE).filter((p) => !owner.has(p))).toEqual(NAMED_HEALTH);
  });

  it('gives named health data to the nurse only', () => {
    const holders = Object.entries(SCHOOL_ROLES)
      .filter(([, r]) => r.grants.some((g) => NAMED_HEALTH.includes(g.permission)))
      .map(([k]) => k);
    expect(holders).toEqual(['nurse']);
  });
});
