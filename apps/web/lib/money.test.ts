import { describe, expect, it } from 'vitest';
import { parseRupees, percent, rupees, rupeesInWords, shortRupees } from './money';

describe('rupees on screen', () => {
  it('formats and parses exactly, with no floating point', () => {
    expect(rupees(12_345_650)).toBe('₹1,23,456.50');
    expect(parseRupees('1,23,456.5')).toBe(12_345_650);
    expect(parseRupees('₹ 0.07')).toBe(7);
    expect(parseRupees('500')).toBe(50_000);
    // 0.1 + 0.2 style traps can't happen: the decimals are read as text.
    expect(parseRupees('0.30')).toBe(30);
    for (const bad of ['', 'abc', '1.234', '-5', '1e5', '12.3.4'])
      expect(parseRupees(bad)).toBeNull();
    expect(percent(3334)).toBe('33.34%');
  });
});

describe('rupeesInWords', () => {
  it('writes amounts the Indian way', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
    expect(rupeesInWords(1_500_000)).toBe('Rupees Fifteen Thousand Only');
    expect(rupeesInWords(1_234_550)).toBe(
      'Rupees Twelve Thousand Three Hundred Forty-five and Fifty Paise Only',
    );
    expect(rupeesInWords(360_000_000)).toBe('Rupees Thirty-six Lakh Only');
    expect(rupeesInWords(12_345_678_901)).toBe(
      'Rupees Twelve Crore Thirty-four Lakh Fifty-six Thousand Seven Hundred Eighty-nine and One Paisa Only',
    );
  });
});

describe('shortRupees', () => {
  it('fits a key-figure strip, never overstating', () => {
    expect(shortRupees(2_000_000)).toBe('₹20,000');
    expect(shortRupees(12_000_000)).toBe('₹1.2 L');
    expect(shortRupees(10_000_000)).toBe('₹1 L');
    expect(shortRupees(12_999_999)).toBe('₹1.29 L');
    expect(shortRupees(34_567_000_000)).toBe('₹34.56 Cr');
    expect(shortRupees(0)).toBe('₹0');
  });
});
