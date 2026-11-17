import { describe, expect, it } from 'vitest';
import { dueDate, fineFor, nextAccessions } from './library.js';

describe('library rules', () => {
  it('sets the due date, moving a Sunday to Monday', () => {
    expect(dueDate('2026-11-09', 14)).toBe('2026-11-23');
    // Mon 2 Nov + 13 = Sun 15 Nov -> Mon 16 Nov.
    expect(dueDate('2026-11-02', 13)).toBe('2026-11-16');
  });

  it('fines whole days late, never before the due date', () => {
    expect(fineFor('2026-11-10', '2026-11-13', 200)).toEqual({ daysLate: 3, finePaise: 600 });
    expect(fineFor('2026-11-10', '2026-11-09', 200)).toEqual({ daysLate: 0, finePaise: 0 });
    expect(fineFor('2026-11-10', '2026-11-20', 0).finePaise).toBe(0);
  });

  it('suggests the next accession numbers with the same prefix and padding', () => {
    expect(nextAccessions(['ACC-0098', 'ACC-0099', 'B12'], 2)).toEqual(['ACC-0100', 'ACC-0101']);
    expect(nextAccessions([], 3)).toEqual(['1', '2', '3']);
    expect(nextAccessions(['1205', 'X'], 1)).toEqual(['1206']);
  });
});
