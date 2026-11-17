import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, generate, type Demand, type Generated, type Rules } from './generate.js';

const days = [1, 2, 3, 4, 5, 6];
// Eight class periods; rows 4 and 8 of the bell are breaks.
const periods = [1, 2, 3, 5, 6, 7, 9, 10];
const rules = (r: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...r });
const run = (demands: Demand[], r: Partial<Rules> = {}, fixed = []) =>
  generate({ demands, days, periods, fixed, rules: rules(r) });

const unique = (xs: string[]) => new Set(xs).size === xs.length;
function hardRulesHold(g: Generated, r: Rules) {
  expect(unique(g.placed.map((p) => `${p.sectionId}:${p.weekday}:${p.period}`))).toBe(true);
  const taught = g.placed.filter((p) => p.teacherPersonId);
  expect(unique(taught.map((p) => `${p.teacherPersonId}:${p.weekday}:${p.period}`))).toBe(true);
  for (const d of days) {
    const byTeacher = new Map<string, number[]>();
    for (const p of taught.filter((x) => x.weekday === d))
      byTeacher.set(p.teacherPersonId!, [...(byTeacher.get(p.teacherPersonId!) ?? []), p.period]);
    for (const [, ps] of byTeacher) {
      expect(ps.length).toBeLessThanOrEqual(r.teacherMaxPerDay);
      // Longest run of back-to-back periods (a break ends a run).
      const sorted = ps.sort((a, b) => a - b);
      let longest = 1;
      let cur = 1;
      for (let i = 1; i < sorted.length; i++) {
        cur = sorted[i] === sorted[i - 1]! + 1 ? cur + 1 : 1;
        longest = Math.max(longest, cur);
      }
      expect(longest).toBeLessThanOrEqual(r.teacherMaxInARow);
    }
  }
}

describe('generate', () => {
  it('places a whole week under the hard rules, a subject once a day', () => {
    const demands: Demand[] = [
      { sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 6 },
      { sectionId: 'B', subjectId: 'maths', teacherPersonId: 'ravi', count: 6 },
      { sectionId: 'A', subjectId: 'english', teacherPersonId: 'uma', count: 6 },
      { sectionId: 'B', subjectId: 'english', teacherPersonId: 'uma', count: 6 },
      { sectionId: 'A', subjectId: 'science', teacherPersonId: 'kiran', count: 5 },
      { sectionId: 'A', subjectId: 'games', teacherPersonId: null, count: 2 },
    ];
    const g = run(demands);
    expect(g.complete).toBe(true);
    expect(g.placed).toHaveLength(31);
    hardRulesHold(g, rules());
    for (const sec of ['A', 'B'])
      for (const d of days)
        expect(
          g.placed.filter((p) => p.sectionId === sec && p.subjectId === 'maths' && p.weekday === d),
        ).toHaveLength(1);
  });

  it('keeps double periods together and never across a break', () => {
    const g = run([{ sectionId: 'A', subjectId: 'lab', teacherPersonId: 'kiran', count: 4 }], {
      subjects: { lab: { doubles: 2 } },
    });
    expect(g.complete).toBe(true);
    const byDay = new Map<number, number[]>();
    for (const p of g.placed) byDay.set(p.weekday, [...(byDay.get(p.weekday) ?? []), p.period]);
    expect([...byDay.values()].map((ps) => ps.sort((a, b) => a - b))).toEqual(
      expect.arrayContaining([expect.any(Array), expect.any(Array)]),
    );
    for (const ps of byDay.values()) {
      expect(ps).toHaveLength(2);
      expect(ps[1]! - ps[0]!).toBe(1);
    }
  });

  it("respects a teacher's days off, most a day and most in a row", () => {
    const demands: Demand[] = ['A', 'B', 'C', 'D'].map((sectionId) => ({
      sectionId,
      subjectId: 'maths',
      teacherPersonId: 'ravi',
      count: 4,
    }));
    const r = rules({ teacherMaxInARow: 2, teachers: { ravi: { offDays: [6], maxPerDay: 4 } } });
    const g = generate({ demands, days, periods, fixed: [], rules: r });
    expect(g.complete).toBe(true);
    expect(g.placed.some((p) => p.weekday === 6)).toBe(false);
    hardRulesHold(g, { ...r, teacherMaxPerDay: 4 });
  });

  it('puts morning subjects in the morning when it can', () => {
    const g = run(
      [
        { sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 6 },
        { sectionId: 'A', subjectId: 'art', teacherPersonId: 'asha', count: 2 },
      ],
      { subjects: { maths: { time: 'morning' }, art: { time: 'afternoon' } } },
    );
    expect(g.timeWish).toEqual({ met: 8, of: 8 });
    expect(g.placed.filter((p) => p.subjectId === 'maths').every((p) => p.period <= 5)).toBe(true);
  });

  it('works around lessons already placed, and says what cannot fit', () => {
    // Ravi has 54 periods to teach but a week holds 48 cells.
    const demands: Demand[] = Array.from({ length: 9 }, (_, i) => ({
      sectionId: `S${i}`,
      subjectId: 'maths',
      teacherPersonId: 'ravi',
      count: 6,
    }));
    const g = generate({
      demands,
      days,
      periods,
      fixed: [
        { sectionIds: ['S0'], subjectId: 'pt', teacherPersonId: null, weekday: 1, period: 1 },
      ],
      rules: rules({ teacherMaxPerDay: 8, teacherMaxInARow: 8 }),
    });
    expect(g.complete).toBe(false);
    expect(g.placed.length).toBeGreaterThanOrEqual(46);
    expect(g.placed.some((p) => p.sectionId === 'S0' && p.weekday === 1 && p.period === 1)).toBe(
      false,
    );
    expect(g.short.reduce((n, s) => n + s.missing, 0)).toBe(54 - g.placed.length);
  });

  it('keeps a teacher out of particular times only', () => {
    // Not Monday period 1 and not Saturday after the break (periods 4-8).
    const offCells = ['1:1', ...[4, 5, 6, 7, 8].map((n) => `6:${n}`)];
    const g = run([{ sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 12 }], {
      maxSamePerDay: 2,
      teachers: { ravi: { offCells } },
    });
    expect(g.complete).toBe(true);
    expect(g.placed.some((p) => p.weekday === 1 && p.period === 1)).toBe(false);
    expect(g.placed.some((p) => p.weekday === 6 && p.period > 3)).toBe(false);
  });

  it('keeps both halves of a double in its time of day', () => {
    // Morning is periods 1-4 (bell rows 1, 2, 3, 5); period 1 is off, so the double must be 2-3.
    const g = run([{ sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 6 }], {
      subjects: { maths: { doubles: 1, time: 'morning' } },
      teachers: { ravi: { offPeriods: [1] } },
    });
    expect(g.timeWish).toEqual({ met: 6, of: 6 });
  });

  it('gives lab subjects a free lab, never one lab to two classes at once', () => {
    // Four sections, science three times a week each, two labs; Lab 1 is taken on Monday period 1.
    const demands: Demand[] = ['A', 'B', 'C', 'D'].map((sectionId, i) => ({
      sectionId,
      subjectId: 'sci',
      teacherPersonId: `T${i}`,
      count: 3,
    }));
    const g = generate({
      demands,
      days,
      periods,
      fixed: [
        {
          sectionIds: ['E'],
          subjectId: 'bio',
          teacherPersonId: null,
          room: 'Lab 1',
          weekday: 1,
          period: 1,
        },
      ],
      rules: rules({ subjects: { sci: { rooms: ['Lab 1', 'Lab 2'] } } }),
    });
    expect(g.complete).toBe(true);
    expect(g.placed.every((p) => p.room === 'Lab 1' || p.room === 'Lab 2')).toBe(true);
    expect(unique(g.placed.map((p) => `${p.room}:${p.weekday}:${p.period}`))).toBe(true);
    expect(g.placed.some((p) => p.room === 'Lab 1' && p.weekday === 1 && p.period === 1)).toBe(
      false,
    );
  });

  it('runs short when a single lab cannot hold every lesson', () => {
    // 7 sections × 7 lessons = 49 lessons, but one lab has 48 cells.
    const demands: Demand[] = Array.from({ length: 7 }, (_, i) => ({
      sectionId: `S${i}`,
      subjectId: 'comp',
      teacherPersonId: null,
      count: 7,
    }));
    const g = generate({
      demands,
      days,
      periods,
      fixed: [],
      rules: rules({ maxSamePerDay: 2, subjects: { comp: { rooms: ['Computer lab'] } } }),
    });
    // Caught up front: no time spent searching for a timetable that can't exist.
    expect(g.steps).toBe(0);
    expect(g.complete).toBe(false);
    expect(g.placed.length).toBeLessThanOrEqual(48);
    expect(unique(g.placed.map((p) => `${p.weekday}:${p.period}`))).toBe(true);
  });

  it('keeps a teacher out of the periods they are not available', () => {
    const g = run([{ sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 6 }], {
      teachers: { ravi: { offPeriods: [1, 8] } },
    });
    expect(g.complete).toBe(true);
    // Period 1 is bell row 1, period 8 is bell row 10.
    expect(g.placed.some((p) => p.period === 1 || p.period === 10)).toBe(false);
  });

  it('gives the same timetable for the same seed', () => {
    const demands: Demand[] = [
      { sectionId: 'A', subjectId: 'maths', teacherPersonId: 'ravi', count: 5 },
      { sectionId: 'A', subjectId: 'english', teacherPersonId: 'uma', count: 5 },
    ];
    const a = generate({ demands, days, periods, fixed: [], rules: rules(), seed: 7 });
    const b = generate({ demands, days, periods, fixed: [], rules: rules(), seed: 7 });
    expect(a.placed).toEqual(b.placed);
  });

  it('builds a 30-section school in a few seconds', { timeout: 30_000 }, () => {
    // 30 sections × 8 subjects = 46 periods each; 24 teachers, each with ~2 subjects-sections.
    const subjects = ['eng', 'hin', 'mat', 'sci', 'soc', 'kan', 'comp', 'pt'];
    const counts = [7, 6, 7, 7, 6, 6, 4, 3];
    const demands: Demand[] = [];
    for (let s = 0; s < 30; s++)
      subjects.forEach((subjectId, i) =>
        demands.push({
          sectionId: `S${s}`,
          subjectId,
          teacherPersonId: `T${(Math.floor(s / 5) * subjects.length + i) % 48}`,
          count: counts[i]!,
        }),
      );
    const started = Date.now();
    const g = generate({
      demands,
      days,
      periods,
      fixed: [],
      rules: rules({
        maxSamePerDay: 2,
        teacherMaxPerDay: 7,
        teacherMaxInARow: 4,
        subjects: { sci: { doubles: 1 } },
      }),
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(g.complete).toBe(true);
    expect(g.placed).toHaveLength(30 * 46);
    hardRulesHold(g, rules({ teacherMaxPerDay: 7, teacherMaxInARow: 4 }));
  });
});
