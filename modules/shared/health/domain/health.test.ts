import { describe, expect, it } from 'vitest';
import {
  cleanVault,
  emergencyView,
  shownCount,
  sosReason,
  takeFromBatches,
  vaultFlags,
  type Vault,
} from './health.js';

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

describe('medicine batches', () => {
  const b = (id: string, expiresOn: string, remaining: number) => ({ id, expiresOn, remaining });
  it('uses the earliest expiry first and skips expired batches', () => {
    const batches = [
      b('late', '2027-06-01', 10),
      b('old', '2026-01-01', 50),
      b('soon', '2026-12-01', 3),
    ];
    expect(takeFromBatches(batches, 5, '2026-11-19')).toEqual([
      { batchId: 'soon', quantity: 3 },
      { batchId: 'late', quantity: 2 },
    ]);
  });
  it('refuses when usable stock is short, or the quantity is not a whole positive number', () => {
    expect(takeFromBatches([b('a', '2027-01-01', 2)], 3, '2026-11-19')).toBeNull();
    expect(takeFromBatches([b('a', '2027-01-01', 2)], 0, '2026-11-19')).toBeNull();
    expect(takeFromBatches([b('a', '2027-01-01', 2)], 1.5, '2026-11-19')).toBeNull();
  });
  it('writes an SOS reason long enough for break-glass', () => {
    expect(sosReason('injury', ' Lab ').length).toBeGreaterThanOrEqual(10);
  });
});
