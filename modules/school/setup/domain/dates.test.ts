import { describe, expect, it } from 'vitest';
import { parseDateColumn } from './dates.js';

describe('parseDateColumn', () => {
  it('reads the common Indian forms', () => {
    expect(
      parseDateColumn([
        '25/12/2015',
        '25-12-2015',
        '25.12.2015',
        '2015-12-25',
        '25 Dec 2015',
        '25-Sept-2015',
      ]),
    ).toEqual([
      { iso: '2015-12-25', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
      { iso: '2015-09-25', ambiguous: false },
    ]);
  });

  it('accepts real Excel date cells as they are', () => {
    expect(parseDateColumn([new Date(Date.UTC(2016, 2, 4))])).toEqual([
      { iso: '2016-03-04', ambiguous: false },
    ]);
  });

  it('a day above 12 anywhere proves day/month for the whole column', () => {
    expect(parseDateColumn(['04/03/2016', '25/12/2015'])).toEqual([
      { iso: '2016-03-04', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
    ]);
  });

  it('a US-style export is detected and read month/day', () => {
    expect(parseDateColumn(['03/04/2016', '12/25/2015'])).toEqual([
      { iso: '2016-03-04', ambiguous: false },
      { iso: '2015-12-25', ambiguous: false },
    ]);
  });

  it('flags dates that could be either, when nothing in the column decides', () => {
    expect(parseDateColumn(['04/03/2016', '05/05/2016'])).toEqual([
      { iso: '2016-03-04', ambiguous: true },
      { iso: '2016-05-05', ambiguous: false }, // same either way
    ]);
  });

  it('refuses impossible dates, text and columns that mix both orders', () => {
    expect(parseDateColumn(['31/02/2016', 'soon', ''])).toEqual([
      { error: 'not_a_date' },
      { error: 'not_a_date' },
      { error: 'not_a_date' },
    ]);
    expect(parseDateColumn(['25/12/2015', '12/25/2015'])).toEqual([
      { error: 'mixed_formats' },
      { error: 'mixed_formats' },
    ]);
  });
});
