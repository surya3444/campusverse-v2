import { describe, expect, it } from 'vitest';
import { rankCover, type Candidate } from './cover.js';

const c = (name: string, o: Partial<Candidate> = {}): Candidate => ({
  personId: name,
  name,
  teachesSubject: false,
  teachesSection: false,
  coversThisWeek: 0,
  lessonsToday: 0,
  ...o,
});

describe('rankCover', () => {
  it('puts the subject first, then the class, then the lightest load', () => {
    const order = rankCover([
      c('Anil', { coversThisWeek: 0 }),
      c('Bhavna', { teachesSection: true }),
      c('Chitra', { teachesSubject: true, coversThisWeek: 3 }),
      c('Dev', { teachesSubject: true, coversThisWeek: 1 }),
      c('Esha', { lessonsToday: 2 }),
    ]).map((x) => x.name);
    expect(order).toEqual(['Dev', 'Chitra', 'Bhavna', 'Anil', 'Esha']);
  });
});
