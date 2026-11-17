import { describe, expect, it } from 'vitest';
import { cleanVault, emergencyView, shownCount, vaultFlags, type Vault } from './health.js';

const v: Vault = {
  bloodGroup: 'B+',
  allergies: '  Peanuts  ',
  conditions: 'Asthma',
  medicines: 'Inhaler',
  responderNotes: 'Inhaler in the front pocket of the school bag.',
};

describe('health vault rules', () => {
  it('cleans values and keeps unknown blood groups out', () => {
    expect(cleanVault(v).allergies).toBe('Peanuts');
    expect(cleanVault({ ...v, bloodGroup: 'Z+' as Vault['bloodGroup'] }).bloodGroup).toBeNull();
  });

  it('keeps only flags in clear', () => {
    expect(vaultFlags(cleanVault(v))).toEqual({
      hasAllergies: true,
      hasConditions: true,
      bloodGroupKnown: true,
    });
  });

  it('shows a responder blood group, allergies and notes, never conditions or medicines', () => {
    const e = emergencyView(v);
    expect(Object.keys(e).sort()).toEqual(['allergies', 'bloodGroup', 'responderNotes']);
  });

  it('hides small totals', () => {
    expect(shownCount(0)).toBe(0);
    expect(shownCount(3)).toBeNull();
    expect(shownCount(5)).toBe(5);
  });
});
