// Quality & Compliance › Government Reports › UDISE+ (rule book §13.11): who is ready and what is
// missing, for one school, with names (an office list, exported through the audited CSV export).
// Facts through people/records; class and admission number through the school's placement port.
import type { FieldKeys } from '@campusverse/crypto';
import { withTenant, type Db } from '@campusverse/db';
import { studentFactsFor, studentIdsAt } from '@campusverse/people-records';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { sql } from 'drizzle-orm';
import { missingForUdise, parentName, type Missing } from '../domain/udise.js';

type Permissions = ReturnType<typeof createPermissions>;
/** `keys`: the field keys, for sealing APAAR IDs from a reconciliation. */
export type ReturnsDeps = { db: Db; permissions: Permissions; keys?: FieldKeys | undefined };

export class ReturnsError extends Error {
  constructor(
    readonly code: 'institution_not_found' | 'missing_columns',
    readonly details?: Record<string, unknown>,
  ) {
    super(`returns: ${code}`);
    this.name = 'ReturnsError';
  }
}

export type UdiseRow = {
  personId: string;
  name: string;
  admissionNumber: string | null;
  classLabel: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  father: string | null;
  mother: string | null;
  guardian: string | null;
  pen: string | null;
  apaarStatus: string;
  missing: Missing[];
};

export type UdiseReadiness = {
  students: number;
  ready: number;
  missing: Record<Missing, number>;
  rows: UdiseRow[];
};

export async function udiseReadiness(
  deps: ReturnsDeps,
  actor: Actor,
  institutionId: string,
): Promise<UdiseReadiness> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, institutionId);
    if (!place) throw new ReturnsError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'school.returns.read', {
      orgId: actor.orgId,
      place,
    });
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const ids = await studentIdsAt(tx, institutionId);
    const facts = await studentFactsFor(tx, ids);
    const placements = await schoolPlacement.getPlacements(tx, {
      personIds: ids,
      onDate: d?.d ?? '',
    });
    const rows = facts.map((f): UdiseRow => {
      const p = placements.get(f.personId);
      const input = { ...f, classLabel: p?.displayLabel ?? null };
      return {
        personId: f.personId,
        name: f.name,
        admissionNumber: p?.reference ?? null,
        classLabel: input.classLabel,
        gender: f.gender,
        dateOfBirth: f.dateOfBirth,
        father: parentName(input, 'father'),
        mother: parentName(input, 'mother'),
        guardian: parentName(input, 'guardian'),
        pen: f.pen,
        apaarStatus: f.apaarStatus,
        missing: missingForUdise(input),
      };
    });
    const missing: Record<Missing, number> = {
      gender: 0,
      date_of_birth: 0,
      class: 0,
      parent_name: 0,
      pen: 0,
      apaar: 0,
    };
    for (const r of rows) for (const m of r.missing) missing[m] += 1;
    return {
      students: rows.length,
      ready: rows.filter((r) => r.missing.length === 0).length,
      missing,
      rows,
    };
  });
}
