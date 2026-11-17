import { describe, expect, it } from 'vitest';
import { validateStudents } from './rows.js';
import { parseV1Export, v1Date, v1StaffTable, v1StudentsTable } from './v1.js';

const student = {
  _id: { $oid: '64f000000000000000000001' },
  admissionNumber: 'ADM-2024-0007',
  firstName: 'Synthetic',
  lastName: 'Aarav',
  displayName: 'Synthetic Aarav',
  dateOfBirth: { $date: '2015-06-11T18:30:00.000Z' },
  gender: 'male',
  rollNumber: '12',
  status: 'active',
  currentEnrollment: { className: 'Class 5', sectionName: 'A' },
  parents: {
    father: { name: 'Synthetic Father', phone: '+91 98450 00001' },
    mother: { name: 'Synthetic Mother', phone: '9845000002' },
  },
};

describe('Campusverse V1 importers', () => {
  it('reads a JSON array or JSON lines, and refuses anything else', () => {
    expect(parseV1Export(JSON.stringify([student]))).toHaveLength(1);
    expect(parseV1Export(`${JSON.stringify(student)}\n${JSON.stringify(student)}\n`)).toHaveLength(
      2,
    );
    expect(parseV1Export('admission number,name')).toBeNull();
    expect(parseV1Export('')).toBeNull();
  });

  it('keeps the calendar day of a V1 date in India', () => {
    expect(v1Date({ $date: '2015-06-11T18:30:00.000Z' })).toBe('2015-06-12');
    expect(v1Date({ $date: { $numberLong: '1434047400000' } })).toBe('2015-06-12');
    expect(v1Date('2015-06-12')).toBe('2015-06-12');
    expect(v1Date(undefined)).toBe('');
  });

  it('turns V1 students into the student template, which the same checks accept', () => {
    const { table, skipped } = v1StudentsTable([
      student,
      { ...student, admissionNumber: 'ADM-OLD', status: 'graduated' },
    ]);
    expect(skipped).toEqual([{ ref: 'ADM-OLD', reason: 'status graduated' }]);
    expect(table[1]).toEqual([
      'ADM-2024-0007',
      'Synthetic Aarav',
      '2015-06-12',
      'Class 5',
      'A',
      '12',
      'Synthetic Father',
      'father',
      '9845000001',
      'Synthetic Mother',
      'mother',
      '9845000002',
    ]);
    const checked = validateStudents(table, {
      sections: new Set(['5-A']),
      existingAdmissions: new Set(),
      existingPeople: new Set(),
      yearStarts: '2026-04-01',
    });
    expect(checked.missingColumns).toEqual([]);
    expect(checked.rows[0]?.status).toBe('valid');
  });

  it('turns V1 staff into the staff template', () => {
    const { table, skipped } = v1StaffTable([
      {
        employeeId: 'EMP001',
        displayName: 'Synthetic Teacher',
        contact: { phone: '9845000003', email: 'synthetic.teacher@example.invalid' },
        employment: { isTeaching: true },
        status: 'active',
      },
      {
        employeeId: 'EMP002',
        displayName: 'Synthetic Clerk',
        contact: { phone: '9845000004' },
        employment: { isTeaching: false },
        status: 'active',
      },
      { employeeId: 'EMP003', displayName: 'Synthetic Leaver', status: 'resigned' },
    ]);
    expect(table.slice(1).map((r) => [r[0], r[4]])).toEqual([
      ['EMP001', 'teacher'],
      ['EMP002', 'office'],
    ]);
    expect(skipped).toEqual([{ ref: 'EMP003', reason: 'status resigned' }]);
  });
});
