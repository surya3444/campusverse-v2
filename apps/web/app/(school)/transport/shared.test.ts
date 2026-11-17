import { describe, expect, it } from 'vitest';
import { riderRows } from './shared';

describe('riderRows', () => {
  it('skips a header, expands "both", and defaults to pickup', () => {
    expect(
      riderRows(
        'Admission no.,Route,Direction,Stop\nADM-1,Route 3,both,Gandhi Nagar\nADM-2,Route 4,,Bus Stand\nADM-3,Route 3,Drop,Gandhi Nagar',
      ),
    ).toEqual([
      { reference: 'ADM-1', route: 'Route 3', direction: 'pickup', stop: 'Gandhi Nagar' },
      { reference: 'ADM-1', route: 'Route 3', direction: 'drop', stop: 'Gandhi Nagar' },
      { reference: 'ADM-2', route: 'Route 4', direction: 'pickup', stop: 'Bus Stand' },
      { reference: 'ADM-3', route: 'Route 3', direction: 'drop', stop: 'Gandhi Nagar' },
    ]);
  });
});
