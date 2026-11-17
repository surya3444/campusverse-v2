import { describe, expect, it } from 'vitest';
import { asData, scrub } from './clean.js';

describe('tool output cleaning', () => {
  it('removes phone numbers, emails and 12-digit identifiers, and keeps counts and dates', () => {
    const out = scrub(
      'Call 9876543210 or +91 98765 43210? mail a.b@school.in; id 1234 5678 9012; 12 absent on 2026-11-05',
    );
    expect(out).not.toMatch(/9876543210|a\.b@school\.in|1234 5678 9012/);
    expect(out).toContain('12 absent on 2026-11-05');
  });

  it('wraps output as data for the model', () => {
    expect(asData('help_search', { x: 1 })).toBe(
      '<tool_output tool="help_search">\n{"x":1}\n</tool_output>',
    );
  });
});
