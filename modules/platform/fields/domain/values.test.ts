import { describe, expect, it } from 'vitest';
import { checkDefinition, cleanValue, keyFromLabel, type FieldDef } from './values.js';

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'f',
  label: 'F',
  type: 'text',
  options: [],
  required: false,
  ...over,
});

describe('cleanValue', () => {
  it('treats empty input as no value, and refuses it when required', () => {
    for (const raw of [undefined, null, '', '   ', []]) {
      expect(cleanValue(def({}), raw)).toEqual({ ok: true, value: null });
      expect(cleanValue(def({ required: true }), raw)).toEqual({ ok: false, error: 'required' });
    }
  });

  it('trims text and limits its length', () => {
    expect(cleanValue(def({}), '  Blue  ')).toEqual({ ok: true, value: 'Blue' });
    expect(cleanValue(def({}), 'x'.repeat(201))).toEqual({ ok: false, error: 'too_long' });
    expect(cleanValue(def({ type: 'long_text' }), 'x'.repeat(2000)).ok).toBe(true);
    expect(cleanValue(def({ type: 'long_text' }), 'x'.repeat(2001))).toEqual({
      ok: false,
      error: 'too_long',
    });
    expect(cleanValue(def({}), 42)).toEqual({ ok: false, error: 'invalid' });
  });

  it('keeps numbers exact, as decimal strings, never floats', () => {
    expect(cleanValue(def({ type: 'number' }), '12.50')).toEqual({ ok: true, value: '12.50' });
    expect(cleanValue(def({ type: 'number' }), 7)).toEqual({ ok: true, value: '7' });
    expect(cleanValue(def({ type: 'number' }), '-3')).toEqual({ ok: true, value: '-3' });
    for (const bad of ['1e5', '12.34567', 'abc', 0.1 + 0.2, Number.NaN, '1,000'])
      expect(cleanValue(def({ type: 'number' }), bad)).toEqual({ ok: false, error: 'invalid' });
  });

  it('accepts only real calendar dates', () => {
    expect(cleanValue(def({ type: 'date' }), '2026-02-28')).toEqual({
      ok: true,
      value: '2026-02-28',
    });
    for (const bad of ['2026-02-30', '28/02/2026', '2026-2-3'])
      expect(cleanValue(def({ type: 'date' }), bad)).toEqual({ ok: false, error: 'invalid' });
  });

  it('takes yes or no as booleans', () => {
    expect(cleanValue(def({ type: 'yes_no' }), true)).toEqual({ ok: true, value: true });
    expect(cleanValue(def({ type: 'yes_no' }), false)).toEqual({ ok: true, value: false });
    expect(cleanValue(def({ type: 'yes_no' }), 'yes')).toEqual({ ok: false, error: 'invalid' });
  });

  it('holds choices to the list', () => {
    const choice = def({ type: 'choice', options: ['Red', 'Blue'] });
    expect(cleanValue(choice, 'Blue')).toEqual({ ok: true, value: 'Blue' });
    expect(cleanValue(choice, 'Green')).toEqual({ ok: false, error: 'not_an_option' });
    const multi = def({ type: 'multi_choice', options: ['Red', 'Blue', 'Green'] });
    expect(cleanValue(multi, ['Green', 'Red', 'Red'])).toEqual({
      ok: true,
      value: ['Red', 'Green'],
    });
    expect(cleanValue(multi, ['Red', 'Pink'])).toEqual({ ok: false, error: 'not_an_option' });
    expect(cleanValue(multi, 'Red')).toEqual({ ok: false, error: 'invalid' });
  });

  it('normalises Indian mobile numbers and email addresses', () => {
    const phone = def({ type: 'phone' });
    expect(cleanValue(phone, '98765 43210')).toEqual({ ok: true, value: '+919876543210' });
    expect(cleanValue(phone, '+91 98765-43210')).toEqual({ ok: true, value: '+919876543210' });
    expect(cleanValue(phone, '12345')).toEqual({ ok: false, error: 'invalid' });
    const email = def({ type: 'email' });
    expect(cleanValue(email, ' Office@School.IN ')).toEqual({
      ok: true,
      value: 'office@school.in',
    });
    expect(cleanValue(email, 'not-an-email')).toEqual({ ok: false, error: 'invalid' });
  });

  it('takes a file as its stored file id', () => {
    const file = def({ type: 'file' });
    const id = '0190f3a2-7b1c-7d2e-8f3a-1b2c3d4e5f60';
    expect(cleanValue(file, id)).toEqual({ ok: true, value: id });
    expect(cleanValue(file, 'report.pdf')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('field definitions', () => {
  it('makes a key from the label', () => {
    expect(keyFromLabel('Blood group')).toBe('blood_group');
    expect(keyFromLabel('  PF No. (EPFO) ')).toBe('pf_no_epfo');
    expect(keyFromLabel('2nd language')).toBe('f_2nd_language');
    expect(keyFromLabel('रक्त समूह')).toBe('field');
  });

  it('needs a label and, for choices, a short list of distinct options', () => {
    expect(checkDefinition(def({ label: ' ' }))).toBe('label');
    expect(checkDefinition(def({ type: 'choice', options: [] }))).toBe('options');
    expect(checkDefinition(def({ type: 'choice', options: ['A', 'a'] }))).toBe('options');
    expect(checkDefinition(def({ type: 'choice', options: ['A', ''] }))).toBe('options');
    expect(
      checkDefinition(
        def({ type: 'choice', options: Array.from({ length: 101 }, (_, i) => `${i}`) }),
      ),
    ).toBe('options');
    expect(checkDefinition(def({ type: 'text', options: ['A'] }))).toBe('options');
    expect(checkDefinition(def({ type: 'choice', options: ['A', 'B'] }))).toBeNull();
  });
});
