import { describe, expect, it } from 'vitest';
import { mapHeaders, parseCsv, readDate, readLead, readMobile } from './leads.js';

const classes = [
  { classId: 'c1', name: 'Class 1', code: '1' },
  { classId: 'lkg', name: 'LKG', code: 'LKG' },
];

describe('bulk upload of leads', () => {
  it('reads CSV with quotes, commas and CRLF', () => {
    expect(parseCsv('\uFEFF' + 'a,"b, c","say ""hi"""\r\n1,2,3\n\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('maps the headers schools use', () => {
    expect(
      mapHeaders(['Student Name', 'DOB', 'Class applied for', 'Father Name', 'Mobile No.']),
    ).toEqual({
      childName: 0,
      dateOfBirth: 1,
      className: 2,
      guardianName: 3,
      phone: 4,
    });
  });

  it('reads Indian dates and mobiles', () => {
    expect(readDate('15/06/2019')).toBe('2019-06-15');
    expect(readDate('2019-6-5')).toBe('2019-06-05');
    expect(readDate('31/02/2019')).toBe('bad');
    expect(readDate('')).toBeNull();
    expect(readMobile('098765 43210')).toBe('+919876543210');
    expect(readMobile('+91-98765-43210')).toBe('+919876543210');
    expect(readMobile(9876543210)).toBe('+919876543210');
    expect(readMobile('12345')).toBeNull();
  });

  it('turns a row into a lead or says what is wrong', () => {
    const cols = mapHeaders(['Child name', 'Class', 'Guardian name', 'Mobile', 'Gender', 'Email']);
    expect(
      readLead(['Asha Rao', '1', 'Ravi Rao', '9876543210', 'F', ''], cols, classes),
    ).toMatchObject({
      lead: { childName: 'Asha Rao', classId: 'c1', phone: '+919876543210', gender: 'female' },
    });
    expect(readLead(['Dev', 'lkg', 'Meena', '98765', 'x', 'bad@'], cols, classes)).toEqual({
      lead: null,
      problems: ['phone', 'email', 'gender'],
    });
    expect(readLead(['', 'Class 9', '', '9876543210'], cols, classes).problems).toEqual([
      'child_name',
      'guardian_name',
      'class',
    ]);
  });
});
