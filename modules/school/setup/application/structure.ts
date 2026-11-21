import type { Db, Tx } from '@campusverse/db';
import { STAFF_EXITED } from '@campusverse/people-records';
import { command, type Consumer } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { planStructure, type StructureInput, type StructurePlan } from '../domain/structure.js';
import { institutionResource, SetupError, STRUCTURE_APPLIED } from './common.js';
import { applyYearPlan, yearPlanProblems, type YearPlan } from './year-structure.js';

type Permissions = ReturnType<typeof createPermissions>;

export { STRUCTURE_APPLIED } from './common.js';

async function id(tx: Tx, q: ReturnType<typeof sql>): Promise<string> {
  const [row] = await tx.execute<{ id: string }>(q);
  if (!row) throw new Error('structure: expected a row');
  return row.id;
}

/**
 * Wizard steps 2–4, committed: creates the year, classes, sections, subjects and offerings from
 * a reviewed plan. Idempotent: applying the same plan again creates nothing new.
 */
export async function applyStructure(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  input: StructureInput,
): Promise<{ yearId: string; plan: StructurePlan }> {
  const planned = planStructure(input);
  if ('problems' in planned) throw new SetupError('invalid_structure', planned.problems);
  const { plan } = planned;
  const resource = await institutionResource(db, actor, institutionId);

  return command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      await tx.execute(sql`
      insert into school_year (org_id, institution_id, label, valid_during, status)
      values (app_current_org(), ${institutionId}, ${plan.year.label},
        daterange(${plan.year.starts}::date, ${plan.year.endsExclusive}::date),
        case when daterange(${plan.year.starts}::date, ${plan.year.endsExclusive}::date) @> app_today()
          then 'active' else 'planned' end)
      on conflict (org_id, institution_id, label) do nothing`);
      const yearId = await id(
        tx,
        sql`
      select id::text from school_year where org_id = app_current_org() and institution_id = ${institutionId}
        and label = ${plan.year.label}`,
      );

      for (const c of plan.classes) {
        await tx.execute(sql`
        insert into school_class (org_id, institution_id, code, name, sequence)
        values (app_current_org(), ${institutionId}, ${c.code}, ${c.name}, ${c.sequence})
        on conflict (org_id, institution_id, code) do nothing`);
        const classId = await id(
          tx,
          sql`
        select id::text from school_class where org_id = app_current_org() and institution_id = ${institutionId}
          and code = ${c.code}`,
        );
        for (const s of c.sections) {
          await tx.execute(sql`
          insert into school_section (org_id, year_id, class_id, name, capacity)
          values (app_current_org(), ${yearId}, ${classId}, ${s.name}, ${s.capacity})
          on conflict (org_id, year_id, class_id, name) do nothing`);
        }
        for (const subject of c.subjects) {
          await tx.execute(sql`
          insert into school_subject (org_id, institution_id, code, name)
          values (app_current_org(), ${institutionId}, ${subject.code}, ${subject.name})
          on conflict (org_id, institution_id, code) do nothing`);
          await tx.execute(sql`
          insert into school_subject_offering (org_id, year_id, class_id, subject_id)
          select app_current_org(), ${yearId}, ${classId}, id from school_subject
          where org_id = app_current_org() and institution_id = ${institutionId} and code = ${subject.code}
          on conflict (org_id, year_id, class_id, subject_id) do nothing`);
        }
      }

      return {
        result: { yearId, plan },
        audit: {
          action: 'school.setup.manage',
          entityType: 'school_year',
          entityId: yearId,
          dataClass: 'operational',
          detail: { step: 'structure', ...plan.totals },
        },
        events: [{ type: STRUCTURE_APPLIED, payload: { institutionId, yearId, ...plan.totals } }],
      };
    },
  );
}

/**
 * The next academic year, ready for year end: it starts the day after the latest year ends, runs
 * a year, and carries that year's classes, sections (names and capacities) and subjects with their
 * periods a week. Teachers are assigned again for the new year (Subjects). Refused while a
 * year that hasn't started exists, so repeating never adds a second one.
 */
export async function setUpNextYear(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  /** The new year's classes and sections as the school edited them; left out, a copy of this year. */
  plan?: YearPlan | null,
): Promise<{ yearId: string; label: string; starts: string; sections: number }> {
  if (plan) {
    const problems = yearPlanProblems(plan);
    if (problems.length > 0) throw new SetupError('invalid_structure', problems);
  }
  const resource = await institutionResource(db, actor, institutionId);
  return command(
    db,
    permissions,
    actor,
    { permission: 'school.setup.manage', resource },
    async (tx) => {
      const [last] = await tx.execute<{
        id: string;
        label: string;
        next: string;
        future: boolean;
      }>(sql`
        select id::text, label, upper(valid_during)::text as next,
          lower(valid_during) > app_today() as future
        from school_year where org_id = app_current_org() and institution_id = ${institutionId}
        order by lower(valid_during) desc limit 1`);
      if (!last) throw new SetupError('no_year');
      // A year that hasn't started yet is already the next one: repeating creates nothing.
      if (last.future) throw new SetupError('next_year_exists', { label: last.label });
      const y = Number(last.label.slice(0, 4)) + 1;
      const label = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
      const yearId = await id(
        tx,
        sql`insert into school_year (org_id, institution_id, label, valid_during, status)
          values (app_current_org(), ${institutionId}, ${label},
            daterange(${last.next}::date, (${last.next}::date + interval '1 year')::date),
            case when ${last.next}::date <= app_today() then 'active' else 'planned' end)
          returning id::text`,
      );
      let count: number;
      if (plan) count = await applyYearPlan(tx, institutionId, yearId, plan);
      else {
        // A copy of this year: its open sections (names and capacities) and subjects.
        const sections = await tx.execute(sql`
          insert into school_section (org_id, year_id, class_id, name, capacity)
          select org_id, ${yearId}, class_id, name, capacity from school_section
          where org_id = app_current_org() and year_id = ${last.id} and closed_at is null
          on conflict (org_id, year_id, class_id, name) do nothing
          returning 1`);
        await tx.execute(sql`
          insert into school_subject_offering (org_id, year_id, class_id, subject_id, periods_per_week)
          select org_id, ${yearId}, class_id, subject_id, periods_per_week from school_subject_offering
          where org_id = app_current_org() and year_id = ${last.id}
          on conflict (org_id, year_id, class_id, subject_id) do nothing`);
        count = sections.length;
      }
      return {
        result: { yearId, label, starts: last.next, sections: count },
        audit: {
          action: 'school.setup.manage',
          entityType: 'school_year',
          entityId: yearId,
          dataClass: 'operational',
          detail: { step: 'next_year', from: last.label, label, sections: count, edited: !!plan },
        },
        events: [{ type: STRUCTURE_APPLIED, payload: { institutionId, yearId, nextYear: true } }],
      };
    },
  );
}

/**
 * When a staff member leaves (people module event), their class-teacher and subject allocations
 * end after their last day, once.
 */
export const staffExitConsumer: Consumer = {
  name: 'school.staff-exit',
  queue: 'rollups',
  events: [STAFF_EXITED],
  handle: async (tx, event) => {
    const { personId, lastDay } = event.payload as { personId: string; lastDay: string };
    await tx.execute(sql`
      update school_teacher_allocation
      set valid_during = daterange(lower(valid_during), greatest(lower(valid_during), ${lastDay}::date + 1))
      where org_id = app_current_org() and teacher_person_id = ${personId}
        and (upper_inf(valid_during) or upper(valid_during) > ${lastDay}::date + 1)`);
  },
};
