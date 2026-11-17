import { describe, expect, it } from 'vitest';
import { LANGUAGES, MESSAGES } from './messages';

describe('app languages', () => {
  const keys = Object.keys(MESSAGES.en).sort();

  it.each(LANGUAGES)(
    '%s has every key, and nothing is left blank or in English by mistake',
    (lang) => {
      const m = MESSAGES[lang];
      expect(Object.keys(m).sort()).toEqual(keys);
      for (const [key, value] of Object.entries(m)) {
        const shown =
          typeof value === 'function' ? (value as (...a: unknown[]) => string)('X', 'Y') : value;
        expect(shown, key).toBeTruthy();
        if (lang !== 'en' && typeof value === 'string' && !['dateHint'].includes(key)) {
          expect(value, `${lang}.${key} is still English`).not.toBe(
            MESSAGES.en[key as keyof typeof m],
          );
        }
      }
    },
  );
});
