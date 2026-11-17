import { describe, expect, it } from 'vitest';
import { readClass, readSection, validateStaff, validateStudents } from './rows.js';
import { planStructure } from './structure.js';

const HEADER = [
  'Admission No',
  'Student Name',
  'DOB',
  'Class',
  'Section',
  'Roll No',
  'Parent Name',
  'Relationship',
  'Mobile',
  'Blood group',
];
const ctx = {
  sections: new Set(['5-A', '5-B', 'LKG-A']),
  existingAdmissions: new Set(['A-OLD']),
  existingPeople: new Set(['ravi synthetic|2016-08-20']),
  yearStarts: '2026-04-01',
};

describe('readClass and readSection', () => {
  it('accepts the ways schools write classes', () => {
    for (const s of ['5', 'V', 'Class 5', 'Std. V', 'standard 5', 'class v'])
      expect(readClass(s)).toBe('5');
    expect(readClass('lkg')).toBe('LKG');
    expect(readClass('13')).toBeNull();
    expect(readSection('V-a')).toBe('5-A');
    expect(readSection('Class 5 B')).toBe('5-B');
    expect(readSection('5A')).toBeNull();
  });
});

describe('validateStudents', () => {
  it('reports missing columns instead of guessing', () => {
    const r = validateStudents([['Student Name', 'Class']], ctx);
    expect(r.missingColumns).toContain('admissionNumber');
    expect(r.rows).toEqual([]);
  });

  it('accepts a clean row, normalising class, section, phone and relationship', () => {
    const r = validateStudents(
      [
        HEADER,
        [
          'A-1',
          'Asha Synthetic',
          '25/12/2016',
          'V',
          'a',
          '1',
          'Priya Synthetic',
          'Mom',
          '098765 43210',
          'O+',
        ],
      ],
      ctx,
    );
    expect(r.ignoredColumns).toEqual(['Blood group']);
    expect(r.rows[0]).toMatchObject({
      rowNumber: 2,
      status: 'valid',
      problems: [],
      value: {
        admissionNumber: 'A-1',
        dateOfBirth: '2016-12-25',
        classCode: '5',
        section: 'A',
        rollNumber: 1,
        guardians: [{ name: 'Priya Synthetic', relationship: 'mother', phone: '+919876543210' }],
      },
    });
  });

  it('marks errors per field and keeps going, skipping blank rows but not their numbers', () => {
    const r = validateStudents(
      [
        HEADER,
        ['A-2', 'Bad Phone', '25/12/2016', '5', 'A', '', 'X', 'Father', '12345', ''],
        ['', '', '', '', '', '', '', '', '', ''],
        ['A-3', 'No Section', '13/01/2017', '5', 'Z', '', 'Y', 'Uncle', '9876543211', ''],
        ['A-4', 'Bad Class', '13/01/2017', 'Class 15', 'A', '', 'Y', 'Aunt', '9876543212', ''],
      ],
      ctx,
    );
    expect(r.rows.map((x) => [x.rowNumber, x.status, x.problems.map((p) => p.code)])).toEqual([
      [2, 'invalid', ['bad_phone']],
      [4, 'invalid', ['unknown_section']],
      [5, 'invalid', ['unknown_class']],
    ]);
  });

  it('flags likely duplicates for review and never merges them', () => {
    const r = validateStudents(
      [
        HEADER,
        ['A-OLD', 'Already Here', '01/06/2016', '5', 'A', '', 'P', 'Father', '9876543213', ''],
        ['A-5', 'Ravi Synthetic', '20/08/2016', '5', 'B', '', 'P', 'Father', '9876543214', ''],
        ['A-6', 'Twin Synthetic', '15/07/2016', '5', 'B', '', 'P', 'Father', '9876543215', ''],
        ['A-6', 'Twin Synthetic', '15/07/2016', '5', 'B', '', 'P', 'Father', '9876543215', ''],
      ],
      ctx,
    );
    expect(r.rows.map((x) => [x.status, x.problems.map((p) => p.code)])).toEqual([
      ['duplicate', ['duplicate_in_school']],
      ['duplicate', ['duplicate_person']],
      ['valid', []],
      ['duplicate', ['duplicate_in_file', 'duplicate_person']],
    ]);
  });

  it('warns on ambiguous dates and odd ages, but lets the row through', () => {
    const r = validateStudents(
      [HEADER, ['A-7', 'Ambi', '04/03/2016', 'LKG', 'A', '', 'P', 'Mother', '9876543216', '']],
      ctx,
    );
    expect(r.rows[0]).toMatchObject({
      status: 'valid',
      problems: [{ code: 'ambiguous_date', severity: 'warning' }],
    });
    const old = validateStudents(
      [HEADER, ['A-8', 'Old', '13/01/1990', '5', 'A', '', 'P', 'Mother', '9876543217', '']],
      ctx,
    );
    expect(old.rows[0]?.problems.map((p) => p.code)).toEqual(['unusual_age']);
  });

  it('catches clashing roll numbers within a section', () => {
    const r = validateStudents(
      [
        HEADER,
        ['A-9', 'One', '13/01/2016', '5', 'A', '3', 'P', 'Mother', '9876543218', ''],
        ['A-10', 'Two', '14/01/2016', '5', 'A', '3', 'P', 'Mother', '9876543219', ''],
        ['A-11', 'Three', '15/01/2016', '5', 'B', '3', 'P', 'Mother', '9876543220', ''],
      ],
      ctx,
    );
    expect(r.rows.map((x) => x.status)).toEqual(['valid', 'invalid', 'valid']);
  });
});

describe('validateStaff', () => {
  const staffCtx = {
    sections: new Set(['5-A', '5-B', '6-A']),
    subjects: new Map([
      ['mat', 'MAT'],
      ['mathematics', 'MAT'],
      ['eng', 'ENG'],
      ['english', 'ENG'],
      ['sci', 'SCI'],
    ]),
    offerings: new Set(['5:MAT', '5:ENG', '6:MAT', '6:SCI']),
    classTeachers: new Set(['6-A']),
    existingCodes: new Set<string>(),
  };
  const H = [
    'Employee Code',
    'Name',
    'Mobile',
    'Email',
    'Designation',
    'Class Teacher Of',
    'Teaches',
  ];

  it('reads roles, class teacher and teaching load', () => {
    const r = validateStaff(
      [
        H,
        [
          'E1',
          'Kavya Synthetic',
          '9876500001',
          'Kavya@Synthetic.Example',
          'Teacher',
          '5-A',
          'Mathematics: 5-A, 5-B; ENG: 5-A',
        ],
      ],
      staffCtx,
    );
    expect(r.rows[0]).toMatchObject({
      status: 'valid',
      value: {
        email: 'kavya@synthetic.example',
        role: 'teacher',
        classTeacherOf: '5-A',
        teaches: [
          { subjectCode: 'MAT', section: '5-A' },
          { subjectCode: 'MAT', section: '5-B' },
          { subjectCode: 'ENG', section: '5-A' },
        ],
      },
    });
  });

  it('refuses a second class teacher, subjects not offered there, and unknown roles', () => {
    const r = validateStaff(
      [
        H,
        ['E2', 'A', '9876500002', '', 'Teacher', '6-A', ''],
        ['E3', 'B', '9876500003', '', 'Teacher', '5-B', 'SCI: 5-B'],
        ['E4', 'C', '9876500004', '', 'Driver', '', ''],
      ],
      staffCtx,
    );
    expect(r.rows.map((x) => x.problems.map((p) => p.code))).toEqual([
      ['class_teacher_taken'],
      ['subject_not_offered'],
      ['unknown_role'],
    ]);
  });
});

describe('planStructure', () => {
  const base = {
    board: 'CBSE' as const,
    yearLabel: '2026-27',
    starts: '2026-04-01',
    ends: '2027-03-31',
  };

  it('builds sections A, B, … with default subjects, in class order', () => {
    const r = planStructure({
      ...base,
      classes: [
        { code: '6', sections: 2, capacity: 40 },
        { code: 'LKG', sections: 1, capacity: 25 },
      ],
    });
    if (!('plan' in r)) throw new Error('expected a plan');
    expect(r.plan.year).toEqual({
      label: '2026-27',
      starts: '2026-04-01',
      endsExclusive: '2027-04-01',
    });
    expect(r.plan.classes.map((c) => [c.code, c.sections.map((s) => s.name)])).toEqual([
      ['LKG', ['A']],
      ['6', ['A', 'B']],
    ]);
    expect(r.plan.classes[1]?.subjects.map((s) => s.code)).toContain('SCI');
    expect(r.plan.totals).toEqual({ classes: 2, sections: 3, seats: 105 });
  });

  it('lists every problem at once', () => {
    const r = planStructure({
      ...base,
      starts: '2027-04-01',
      classes: [
        { code: '13', sections: 1, capacity: 40 },
        { code: '5', sections: 0, capacity: 90 },
        { code: '5', sections: 1, capacity: 40 },
      ],
    });
    expect('problems' in r && r.problems.map((p) => p.code)).toEqual([
      'bad_dates',
      'unknown_class',
      'bad_sections',
      'bad_capacity',
      'duplicate_class',
    ]);
  });
});
