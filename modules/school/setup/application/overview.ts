import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { yearTemplate, type StateCode } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import { institutionResource } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;

export type SetupOverview = {
  institution: { id: string; name: string; board: string; state: string | null; status: string };
  /** Suggested year dates from the board or state rule pack, with their source. */
  yearTemplate: { starts: string; ends: string | null; source: string } | null;
  year: { label: string; starts: string; ends: string } | null;
  classes: { code: string; name: string; sections: string[]; students: number }[];
  imports: {
    id: string;
    kind: 'students' | 'staff';
    fileName: string;
    status: string;
    failure: string | null;
    total: number;
    valid: number;
    invalid: number;
    duplicate: number;
    createdAt: string;
    source: 'xlsx' | 'v1';
  }[];
};

/** Everything the setup wizard needs to show where a school stands. */
export async function setupOverview(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<SetupOverview> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);
    const [inst] = await tx.execute<SetupOverview['institution']>(sql`
      select id::text, name, authority_code as board, state_code as state, status
      from institution where org_id = app_current_org() and id = ${institutionId}`);
    if (!inst) throw new Error('setupOverview: institution vanished');

    const [year] = await tx.execute<{
      id: string;
      label: string;
      starts: string;
      ends: string;
    }>(sql`
      select id::text, label, lower(valid_during)::text as starts, (upper(valid_during) - 1)::text as ends
      from school_year
      where org_id = app_current_org() and institution_id = ${institutionId} and upper(valid_during) > app_today()
      order by lower(valid_during) limit 1`);

    const classes = year
      ? await tx.execute<SetupOverview['classes'][number]>(sql`
          select c.code, c.name,
            array_agg(s.name order by s.name) as sections,
            (select count(*)::int from school_enrolment e
               join school_section s2 on s2.org_id = e.org_id and s2.id = e.section_id
               where e.org_id = c.org_id and s2.class_id = c.id and s2.year_id = ${year.id}
                 and upper(e.valid_during) > app_today()) as students
          from school_class c
          join school_section s on s.org_id = c.org_id and s.class_id = c.id and s.year_id = ${year.id}
          where c.org_id = app_current_org() and c.institution_id = ${institutionId}
          group by c.org_id, c.id, c.code, c.name, c.sequence
          order by c.sequence`)
      : [];

    const imports = await tx.execute<SetupOverview['imports'][number]>(sql`
      select id::text, kind, file_name as "fileName", status, failure, total_rows as total,
        valid_rows as valid, invalid_rows as invalid, duplicate_rows as duplicate, created_at::text as "createdAt",
        source
      from import_batch where org_id = app_current_org() and institution_id = ${institutionId}
      order by created_at desc limit 50`);

    // CBSE is the only board so far, and its template ignores the state; state boards will use it.
    const template = inst.state
      ? yearTemplate({ board: 'CBSE', state: inst.state as StateCode })
      : null;

    return {
      institution: inst,
      yearTemplate: template
        ? { starts: template.starts, ends: template.ends, source: template.source.title }
        : null,
      year: year ? { label: year.label, starts: year.starts, ends: year.ends } : null,
      classes: [...classes],
      imports: [...imports],
    };
  });
}

/** The institutions of the actor's organisation, for choosing which school to set up. */
export async function listInstitutions(db: Db, actor: Actor) {
  return withTenant(db, actor.orgId, async (tx) => [
    ...(await tx.execute<{
      id: string;
      name: string;
      type: string;
      profile: string;
      status: string;
    }>(sql`
      select id::text, name, type, profile, status from institution where org_id = app_current_org() order by name`)),
  ]);
}

export type SupportSummary = {
  institutions: {
    name: string;
    board: string;
    status: string;
    year: string | null;
    classes: number;
    sections: number;
  }[];
  imports: {
    kind: string;
    status: string;
    failure: string | null;
    total: number;
    invalid: number;
    duplicate: number;
    createdAt: string;
  }[];
};

/**
 * What Campusverse support sees under an approved grant: setup state and import results.
 * Counts, statuses and codes only; no names of people, no file names. Call inside the tenant.
 */
export async function supportSummary(tx: Tx): Promise<SupportSummary> {
  const institutions = await tx.execute<SupportSummary['institutions'][number]>(sql`
    select i.name, i.authority_code as board, i.status,
      (select y.label from school_year y where y.org_id = i.org_id and y.institution_id = i.id
         and upper(y.valid_during) > app_today() order by lower(y.valid_during) limit 1) as year,
      (select count(*)::int from school_class c where c.org_id = i.org_id and c.institution_id = i.id) as classes,
      (select count(*)::int from school_section s join school_year y on y.org_id = s.org_id and y.id = s.year_id
         where s.org_id = i.org_id and y.institution_id = i.id and app_today() <@ y.valid_during) as sections
    from institution i where i.org_id = app_current_org() order by i.name`);
  const imports = await tx.execute<SupportSummary['imports'][number]>(sql`
    select kind, status, failure, total_rows as total, invalid_rows as invalid,
      duplicate_rows as duplicate, created_at::text as "createdAt"
    from import_batch where org_id = app_current_org() order by created_at desc limit 20`);
  return { institutions: [...institutions], imports: [...imports] };
}
