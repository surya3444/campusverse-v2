// UDISE+ readiness (rule book §13.11 Government Reports, §15 UDISE+ and PEN). Pure.
// Checks the student-level details a school must hold before filling UDISE+; it does not claim
// to be the UDISE+ file format, which changes by year (check the current SDMS template).

export type UdiseInput = {
  name: string;
  gender: string | null;
  dateOfBirth: string | null;
  classLabel: string | null;
  pen: string | null;
  apaarStatus: string;
  guardians: { name: string; relationship: string }[];
};

export type Missing = 'gender' | 'date_of_birth' | 'class' | 'parent_name' | 'pen' | 'apaar';

/** What is missing, in the order a clerk fixes it. PEN and APAAR follow UDISE+ but never block. */
export function missingForUdise(s: UdiseInput): Missing[] {
  const out: Missing[] = [];
  if (!s.gender || s.gender === 'not_stated') out.push('gender');
  if (!s.dateOfBirth) out.push('date_of_birth');
  if (!s.classLabel) out.push('class');
  if (!s.guardians.some((g) => ['father', 'mother', 'guardian'].includes(g.relationship)))
    out.push('parent_name');
  if (!s.pen) out.push('pen');
  if (s.apaarStatus === 'not_generated') out.push('apaar');
  return out;
}

export const parentName = (s: UdiseInput, relationship: 'father' | 'mother' | 'guardian') =>
  s.guardians.find((g) => g.relationship === relationship)?.name ?? null;
