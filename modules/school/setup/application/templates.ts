import writeXlsxFile from 'write-excel-file/node';
import type { ImportKind } from './imports.js';

// The columns the importer reads first. Other common wordings are accepted too (see domain/rows).
const TEMPLATES: Record<ImportKind, string[][]> = {
  students: [
    [
      'Admission No',
      'Student Name',
      'Date of Birth',
      'Class',
      'Section',
      'Roll No',
      'Guardian 1 Name',
      'Guardian 1 Relationship',
      'Guardian 1 Phone',
      'Guardian 2 Name',
      'Guardian 2 Relationship',
      'Guardian 2 Phone',
    ],
    [
      'ADM-1001',
      'Example Student',
      '25/06/2019',
      '1',
      'A',
      '1',
      'Example Mother',
      'Mother',
      '98765 43210',
      '',
      '',
      '',
    ],
  ],
  staff: [
    ['Employee Code', 'Name', 'Mobile', 'Email', 'Designation', 'Class Teacher Of', 'Teaches'],
    [
      'EMP-001',
      'Example Teacher',
      '98765 43211',
      'teacher@school.example',
      'Teacher',
      '1-A',
      'English: 1-A, 1-B; Mathematics: 1-A',
    ],
  ],
};

/** A blank file with the right headings and one example row, for schools to fill in. */
export function importTemplate(kind: ImportKind): Promise<Buffer> {
  return writeXlsxFile(TEMPLATES[kind].map((row) => row.map((value) => ({ value })))).toBuffer();
}
