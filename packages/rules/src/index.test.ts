import { describe, expect, it } from 'vitest';
import {
  admissionAgeRule,
  gradeFor,
  completedYears,
  PACKS,
  promotionFor,
  CBSE_CLASSES,
  CBSE_DEFAULT_SUBJECTS,
  SUBJECTS,
  yearTemplate,
} from './index.js';

describe('year templates', () => {
  it('a CBSE school follows the CBSE session in any state', () => {
    expect(yearTemplate({ board: 'CBSE', state: 'TS' })?.starts).toBe('2026-04-01');
    expect(yearTemplate({ board: 'CBSE', state: 'AP' })?.starts).toBe('2026-04-01');
  });

  it('every template carries a source and a valid start date, and none claims to be verified', () => {
    const t = yearTemplate({ board: 'CBSE', state: 'KA' });
    expect(t?.source.title).toBeTruthy();
    expect(t?.source.verified).toBe(false);
    expect(Number.isNaN(Date.parse(t!.starts))).toBe(false);
  });
});

describe('CBSE classes and subjects', () => {
  it('runs LKG to 12 in order, each with known default subjects', () => {
    expect(CBSE_CLASSES.map((c) => c.code)).toEqual([
      'LKG',
      'UKG',
      ...Array.from({ length: 12 }, (_, i) => String(i + 1)),
    ]);
    expect(CBSE_CLASSES.map((c) => c.sequence)).toEqual(CBSE_CLASSES.map((_, i) => i));
    for (const c of CBSE_CLASSES) {
      const subjects = CBSE_DEFAULT_SUBJECTS.byClass[c.code];
      expect(subjects?.length).toBeGreaterThan(0);
      for (const s of subjects ?? []) expect(SUBJECTS[s]).toBeTruthy();
    }
  });
});

const cbse = PACKS['board.cbse'].builtin;

describe('board pack: attendance, grading and promotion', () => {
  it('CBSE needs 75% and warns below 80%, with its source', () => {
    const r = cbse.payload.attendance;
    expect(r?.minimumBasisPoints).toBe(7500);
    expect(r!.warnBelowBasisPoints).toBeGreaterThan(r!.minimumBasisPoints);
    expect(cbse.sources[0]?.url).toMatch(/^https:\/\/www\.cbse\.gov\.in\//);
  });

  it('grades by the CBSE eight-point scale, versioned', () => {
    const g = cbse.payload.grades!;
    const s = { ...g, rounding: 'down_2dp' as const, source: cbse.sources[1]! };
    expect(s.id).toMatch(/@\d{4}$/);
    expect([9100, 9099, 8100, 3300, 3299, 0].map((bp) => gradeFor(s, bp))).toEqual([
      'A1',
      'A2',
      'A2',
      'D',
      'E',
      'E',
    ]);
  });

  it('promotes by class: no-detention years, pass marks in 9 and 11, board years pass out', () => {
    expect(
      ['3', '8', '9', '10', '11', '12', 'LKG'].map((c) => promotionFor(cbse.payload, c)),
    ).toEqual(['promote', 'promote', 'pass_marks', 'board', 'pass_marks', 'board', 'promote']);
  });
});

describe('admission age and TC deadlines', () => {
  it('Class 1 in a CBSE school needs six completed years on 31 March', () => {
    const r = admissionAgeRule('CBSE', '1');
    expect(r?.minYears).toBe(6);
    expect(completedYears('2021-03-31', '2027-03-31')).toBe(6);
    expect(completedYears('2021-04-01', '2027-03-31')).toBe(5);
    expect(admissionAgeRule('CBSE', '7')).toBeNull();
  });

  it('Karnataka gives seven days for a TC; elsewhere there is no known order', () => {
    expect(PACKS['state.KA'].builtin.payload.tcDeadlineDays).toBe(7);
    expect(PACKS['state.TN'].builtin.payload.tcDeadlineDays).toBeNull();
  });
});

describe('rule packs', () => {
  it('every built-in version fits its shape and passes its own test cases', async () => {
    const { PACKS, runPackTests, validatePack } = await import('./index.js');
    for (const [code, pack] of Object.entries(PACKS)) {
      const c = code as keyof typeof PACKS;
      expect(validatePack(c, pack.builtin.payload), code).toEqual({ ok: true });
      expect(pack.builtin.tests.length, code).toBeGreaterThan(0);
      const failed = runPackTests(c, pack.builtin.payload, pack.builtin.tests).filter(
        (r) => !r.passed,
      );
      expect(failed, code).toEqual([]);
    }
  });

  it('a changed value fails the tests that pin it; a malformed payload is refused', async () => {
    const { PACKS, runPackTests, validatePack } = await import('./index.js');
    const ka = PACKS['state.KA'].builtin;
    const raised = { ...ka.payload, tcDeadlineDays: 10 };
    expect(
      runPackTests('state.KA', raised, ka.tests)
        .filter((r) => !r.passed)
        .map((r) => r.name),
    ).toEqual(['TC within seven days']);
    expect(validatePack('labour.central', { pf: {} }).ok).toBe(false);
  });

  it('picks the packs an institution follows', async () => {
    const { packsFor } = await import('./index.js');
    expect(packsFor({ profile: 'school', authorityCode: 'CBSE', stateCode: 'KA' })).toEqual([
      'board.cbse',
      'state.KA',
      'labour.central',
    ]);
    expect(
      packsFor({ profile: 'autonomous_college', authorityCode: 'VTU', stateCode: 'MH' }),
    ).toEqual(['labour.central', 'ugc.credits']);
  });
});

describe('gratuity', () => {
  it('counts whole months to the day after leaving, and a part year of six months as a year', async () => {
    const { gratuity, PACKS } = await import('./index.js');
    const r = PACKS['labour.central'].builtin.payload.gratuity!;
    const at = (joinedOn: string, lastDay: string, fixedTerm = false) =>
      gratuity(r, { monthlyWagesPaise: 2_600_000, joinedOn, lastDay, fixedTerm });
    expect(at('2020-04-01', '2025-03-31')).toMatchObject({ months: 60, years: 5, eligible: true });
    expect(at('2020-04-15', '2025-04-13')).toMatchObject({
      months: 59,
      eligible: false,
      amountPaise: 0,
    });
    // ₹26,000 × 15 × 5 ÷ 26 = ₹75,000.
    expect(at('2020-04-01', '2025-03-31').amountPaise).toBe(7_500_000);
    expect(at('2025-01-01', '2025-12-31', true)).toMatchObject({
      months: 12,
      years: 1,
      eligible: true,
    });
    expect(at('2025-01-01', '2025-11-30', true).eligible).toBe(false);
  });
});

describe('grades and GPA', () => {
  it('grades a course and weights the average by credits', async () => {
    const { courseGrade, gradePointAverage, PACKS } = await import('./index.js');
    const g = PACKS['ugc.credits'].builtin.payload.grading!;
    expect(courseGrade(g, { cie: 35, see: 50, absent: false })).toMatchObject({
      total: 85,
      grade: 'A+',
      point: 9,
    });
    expect(courseGrade(g, { cie: 40, see: 23.5, absent: false })).toMatchObject({
      grade: 'F',
      passed: false,
    });
    expect(
      gradePointAverage([
        { credits: 4, point: 9 },
        { credits: 2, point: 6 },
      ]),
    ).toBe(8);
    expect(gradePointAverage([])).toBeNull();
  });
});
