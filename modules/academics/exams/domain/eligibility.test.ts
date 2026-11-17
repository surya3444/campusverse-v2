import { describe, expect, it } from 'vitest';
import { eligibilityOf } from './eligibility.js';

describe('exam eligibility', () => {
  it('lets a student sit eligible, condoned and not-yet-taken courses; overdue fees hold the ticket', () => {
    const r = eligibilityOf(
      [
        { courseId: 'a', code: 'A1', standing: 'eligible' },
        { courseId: 'b', code: 'B1', standing: 'condoned' },
        { courseId: 'c', code: 'C1', standing: 'condonable' },
        { courseId: 'd', code: 'D1', standing: 'short' },
        { courseId: 'e', code: 'E1', standing: 'no_classes' },
      ],
      150000,
    );
    expect(r.courses.map((c) => [c.code, c.maySit])).toEqual([
      ['A1', true],
      ['B1', true],
      ['C1', false],
      ['D1', false],
      ['E1', true],
    ]);
    expect(r.reasons).toEqual([
      { kind: 'attendance', code: 'C1', standing: 'condonable' },
      { kind: 'attendance', code: 'D1', standing: 'short' },
      { kind: 'fees', overduePaise: 150000 },
    ]);
    expect(r).toMatchObject({ feesHold: true, anyCourse: true });
    expect(eligibilityOf([{ courseId: 'd', code: 'D1', standing: 'short' }], 0)).toMatchObject({
      feesHold: false,
      anyCourse: false,
    });
  });
});
