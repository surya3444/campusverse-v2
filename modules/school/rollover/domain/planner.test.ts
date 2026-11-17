import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { balance, generate, problems, type Pupil } from './planner.js';

const sections = [
  { id: 'A', capacity: 30 },
  { id: 'B', capacity: 30 },
];

describe('section planner', () => {
  it('places everyone, with sizes within one and genders and marks mixed', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            gender: fc.constantFrom('female', 'male'),
            scoreBp: fc.option(fc.integer({ min: 0, max: 10_000 })),
          }),
          {
            maxLength: 60,
          },
        ),
        (raw) => {
          const pupils: Pupil[] = raw.map((r, i) => ({ id: `p${i}`, ...r }));
          const plan = generate(pupils, sections);
          expect(problems(pupils, sections, plan)).toEqual([]);
          const [a, b] = balance(pupils, sections, plan);
          expect(Math.abs((a?.size ?? 0) - (b?.size ?? 0))).toBeLessThanOrEqual(1);
          for (const g of ['female', 'male']) {
            expect(Math.abs((a?.byGender[g] ?? 0) - (b?.byGender[g] ?? 0))).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it('never ranks sections by merit: the top two pupils land in different sections', () => {
    const pupils: Pupil[] = [9900, 9800, 5000, 4000].map((s, i) => ({
      id: `p${i}`,
      gender: 'female',
      scoreBp: s,
    }));
    const plan = generate(pupils, sections);
    expect(plan.p0).not.toBe(plan.p1);
  });

  it('separates keep-apart pairs, and flags capacity and broken pairs in a hand-made plan', () => {
    const pupils: Pupil[] = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      gender: 'male',
      scoreBp: 5000,
    }));
    const plan = generate(pupils, sections, [['a', 'c']]);
    expect(plan.a).not.toBe(plan.c);
    expect(
      problems(pupils, [{ id: 'A', capacity: 1 }], { a: 'A', b: 'A', c: 'A', d: 'X' }, [
        ['a', 'b'],
      ]),
    ).toEqual([
      { code: 'over_capacity', sectionId: 'A' },
      { code: 'kept_together', pair: ['a', 'b'] },
      { code: 'unplaced', pupilId: 'd' },
    ]);
  });
});
