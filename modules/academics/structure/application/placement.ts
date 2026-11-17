// Where a college or university student is (rule book §12.4 decision 2: the cohort tree), for the
// shared modules that only ask AcademicPlacementPort: students, transport, hostel, library, gate,
// helpdesk, fees. "BECS 2026–30 · Semester 1 · A", with the register number as the reference.
import type { AcademicPlacementPort, Placement } from '@campusverse/people-records';
import { sql } from 'drizzle-orm';
import type { Tx } from '@campusverse/db';

type Row = {
  personId: string;
  institutionId: string;
  institutionType: Placement['institutionType'];
  programCode: string;
  batchLabel: string;
  termKind: string;
  term: number;
  section: string;
  status: string;
  reference: string | null;
};

const TERM: Record<string, string> = { semester: 'Semester', trimester: 'Trimester', year: 'Year' };

// ponytail: placement follows the open enrolment (by term), not the date asked; a dated history if
// a screen ever needs where a student was on a past date.
const select = (tx: Tx, where: ReturnType<typeof sql>) =>
  tx.execute<Row>(sql`
    select e.student_person_id::text as "personId", p.institution_id::text as "institutionId",
      i.type as "institutionType", p.code as "programCode", b.label as "batchLabel",
      p.term_kind as "termKind", b.current_term as term, s.name as section, b.status,
      e.register_number as reference
    from academic_enrolment e
    join academic_batch b on b.org_id = e.org_id and b.id = e.batch_id
    join academic_program p on p.org_id = b.org_id and p.id = b.program_id
    join academic_section s on s.org_id = e.org_id and s.id = e.section_id
    join institution i on i.org_id = p.org_id and i.id = p.institution_id
    where e.org_id = app_current_org() and e.until_term is null and ${where}`);

const placement = (r: Row): Placement & { reference: string | null } => ({
  institutionId: r.institutionId,
  institutionType: r.institutionType,
  displayLabel: `${r.programCode} ${r.batchLabel} · ${TERM[r.termKind] ?? r.termKind} ${r.term} · ${r.section}`,
  active: r.status === 'running',
  reference: r.reference,
});

export const academicPlacement: AcademicPlacementPort = {
  async getCurrentPlacement(tx, { personId }) {
    const [r] = await select(tx, sql`e.student_person_id = ${personId}`);
    return r ? placement(r) : null;
  },
  async getPlacements(tx, { personIds }) {
    if (personIds.length === 0) return new Map();
    const rows = await select(
      tx,
      sql`e.student_person_id = any(${`{${personIds.join(',')}}`}::uuid[])`,
    );
    return new Map(rows.map((r) => [r.personId, placement(r)]));
  },
  async findByReference(tx, { institutionId, text }) {
    const prefix = `${text.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await tx.execute<{ personId: string }>(sql`
      select distinct e.student_person_id::text as "personId"
      from academic_enrolment e
      join academic_batch b on b.org_id = e.org_id and b.id = e.batch_id
      join academic_program p on p.org_id = b.org_id and p.id = b.program_id
      where e.org_id = app_current_org() and p.institution_id = ${institutionId}
        and e.register_number ilike ${prefix}
      limit 20`);
    return rows.map((r) => r.personId);
  },
};
