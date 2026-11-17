import { describe, expect, it } from 'vitest';
import { normaliseIndianMobile } from './phone.js';

describe('normaliseIndianMobile', () => {
  it.each([
    '9876543210',
    '98765 43210',
    '098765-43210',
    '919876543210',
    '+91 98765 43210',
    '+91-98765-43210',
    '(+91) 98765 43210',
  ])('accepts %s', (input) => {
    expect(normaliseIndianMobile(input)).toBe('+919876543210');
  });

  it.each([
    '5876543210', // mobiles start 6–9
    '987654321', // too short
    '98765432100', // too long
    '+1 9876543210', // not India
    '+9198765432a0',
    '',
  ])('rejects %s', (input) => {
    expect(normaliseIndianMobile(input)).toBeNull();
  });
});
