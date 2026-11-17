import { describe, expect, it } from 'vitest';
import {
  masked,
  readAadhaar,
  readAbc,
  readApaar,
  readPen,
  readPan,
  verhoeffDigit,
  maskedAccount,
  readBankAccount,
} from './identifiers.js';

const withCheck = (eleven: string) => `${eleven}${verhoeffDigit(eleven)}`;

describe('Aadhaar', () => {
  it('accepts a number with the right check digit, spaced or not', () => {
    const n = withCheck('23412341234');
    expect(readAadhaar(n)).toBe(n);
    expect(readAadhaar(`${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`)).toBe(n);
  });

  it('catches a single wrong digit and two swapped digits', () => {
    const n = withCheck('23412341234');
    const wrong = `${n.slice(0, 5)}${(Number(n[5]) + 1) % 10}${n.slice(6)}`;
    const swapped = `${n.slice(0, 2)}${n[3]}${n[2]}${n.slice(4)}`;
    expect(readAadhaar(wrong)).toBeNull();
    if (n[2] !== n[3]) expect(readAadhaar(swapped)).toBeNull();
  });

  it('refuses numbers that start with 0 or 1, or are the wrong length', () => {
    expect(readAadhaar(withCheck('03412341234'))).toBeNull();
    expect(readAadhaar(withCheck('13412341234'))).toBeNull();
    expect(readAadhaar('2341234123')).toBeNull();
  });
});

describe('APAAR and PAN', () => {
  it('reads APAAR as 12 digits', () => {
    expect(readApaar('1234 5678 9012')).toBe('123456789012');
    expect(readApaar('12345')).toBeNull();
  });

  it('reads PAN in its fixed shape', () => {
    expect(readPan('abcde1234f')).toBe('ABCDE1234F');
    expect(readPan('ABCD12345F')).toBeNull();
  });

  it('masks everything but the last four', () => {
    expect(masked('aadhaar', '1234')).toBe('XXXX XXXX 1234');
    expect(masked('pan', '234F')).toBe('XXXXXX234F');
  });
});

describe('bank accounts', () => {
  it('takes 9 to 18 digits, ignoring spaces and dashes', () => {
    expect(readBankAccount('1234 5678 9012')).toBe('123456789012');
    expect(readBankAccount('12345678')).toBeNull();
    expect(readBankAccount('1234567890123456789')).toBeNull();
    expect(readBankAccount('12345678AB')).toBeNull();
    expect(maskedAccount('9012')).toBe('XXXX XXXX 9012');
  });
});

describe('learner identifiers', () => {
  it('reads PEN (11 digits) and ABC ID (12 digits), ignoring spaces and dashes', () => {
    expect(readPen('2023 0101 234')).toBe('20230101234');
    expect(readPen('2023010123')).toBeNull();
    expect(readAbc('1234-5678-9012')).toBe('123456789012');
    expect(readAbc('12345678901A')).toBeNull();
  });
});
