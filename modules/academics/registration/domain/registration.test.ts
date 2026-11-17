import { describe, expect, it } from 'vitest';
import { checkSelection, defaultLimits, type Offered } from './registration.js';

const offered: Offered[] = [
  { courseId: 'c1', code: 'CS301', kind: 'core', credits: 4 },
  { courseId: 'l1', code: 'CS391', kind: 'lab', credits: 1.5 },
  { courseId: 'e1', code: 'CS351', kind: 'elective', credits: 3 },
  { courseId: 'e2', code: 'CS352', kind: 'elective', credits: 3 },
  { courseId: 'o1', code: 'HS301', kind: 'open_elective', credits: 2 },
];

describe('course registration rules', () => {
  it('compulsory courses come with every registration; electives only when chosen', () => {
    const r = checkSelection({ offered, chosen: ['e1'], min: 5, max: 12, seatsLeft: {} });
    expect(r.courses.map((c) => c.code)).toEqual(['CS301', 'CS391', 'CS351']);
    expect(r).toMatchObject({ credits: 8.5, problems: [] });
  });

  it('refuses another term’s course, a core course as a choice, full electives and credit limits', () => {
    const r = checkSelection({
      offered,
      chosen: ['e1', 'e2', 'o1', 'c1', 'CS401'],
      min: 5,
      max: 12,
      seatsLeft: { e2: 0, e1: 3 },
    });
    expect(r.problems).toEqual([
      { kind: 'full', code: 'CS352' },
      { kind: 'not_offered', courseId: 'c1' },
      { kind: 'not_offered', courseId: 'CS401' },
      { kind: 'above_max', credits: 13.5, max: 12 },
    ]);
    expect(
      checkSelection({ offered, chosen: [], min: 8, max: 12, seatsLeft: {} }).problems,
    ).toEqual([{ kind: 'below_min', credits: 5.5, min: 8 }]);
  });

  it('default limits come from the framework, else compulsory to everything', () => {
    expect(defaultLimits(offered, { min: 18, max: 22 })).toEqual({ min: 18, max: 22 });
    expect(defaultLimits(offered, null)).toEqual({ min: 5.5, max: 13.5 });
  });
});
