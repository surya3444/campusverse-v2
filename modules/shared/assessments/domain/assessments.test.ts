import { describe, expect, it } from 'vitest';
import { blueprint, questionProblem } from './assessments.js';

describe('blueprint', () => {
  it('spreads marks over Bloom levels, difficulty and COs', () => {
    const b = blueprint([
      { marks: 2, difficulty: 'easy', bloom: 'remember', coCode: 'CO1' },
      { marks: 5, difficulty: 'medium', bloom: 'apply', coCode: 'CO2' },
      { marks: 3, difficulty: 'hard', bloom: 'analyse', coCode: 'CO10' },
      { marks: 1.5, difficulty: 'easy', bloom: 'understand', coCode: null },
    ]);
    expect(b).toMatchObject({ questions: 4, marks: 11.5, noCo: 1 });
    expect(b.bloom).toEqual({
      remember: 2,
      understand: 1.5,
      apply: 5,
      analyse: 3,
      evaluate: 0,
      create: 0,
    });
    expect(b.difficulty).toEqual({ easy: 3.5, medium: 5, hard: 3 });
    // Numeric order: CO2 before CO10.
    expect(b.co.map((c) => c.code)).toEqual(['CO1', 'CO2', 'CO10']);
    expect(b.higherOrder).toBe(70);
  });

  it('is empty for an empty paper', () => {
    expect(blueprint([])).toMatchObject({ questions: 0, marks: 0, higherOrder: 0, co: [] });
  });
});

describe('questionProblem', () => {
  it('needs 2–6 distinct options and one of them as the answer for MCQs', () => {
    expect(questionProblem({ kind: 'mcq', options: ['A'], answer: 'A' })).toBe('options');
    expect(questionProblem({ kind: 'mcq', options: ['A', 'A'], answer: 'A' })).toBe('options');
    expect(questionProblem({ kind: 'mcq', options: ['A', 'B'], answer: 'C' })).toBe('answer');
    expect(questionProblem({ kind: 'mcq', options: ['A', 'B'], answer: 'B' })).toBeNull();
    expect(questionProblem({ kind: 'long', options: [], answer: null })).toBeNull();
    expect(questionProblem({ kind: 'short', options: ['x'], answer: null })).toBe('options');
  });
});
