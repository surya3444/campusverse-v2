import { withTenant, type Db } from '@campusverse/db';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { institutionResource } from './common.js';

type Permissions = ReturnType<typeof createPermissions>;

export type ReadinessCheck = {
  key:
    | 'year_running'
    | 'sections'
    | 'class_teachers'
    | 'students'
    | 'teacher_logins'
    | 'guardian_contacts';
  ok: boolean;
  /** Blocking checks must pass before the first attendance; the rest are advice. */
  blocking: boolean;
  /** Sections or counts that still need work. */
  missing: string[];
};

/**
 * Can this school take its first attendance today? Every section needs students, a class
 * teacher, and that teacher a login. Guardians without a phone are flagged, not blocking.
 */
export async function setupReadiness(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<{ ready: boolean; checks: ReadinessCheck[] }> {
  const resource = await institutionResource(db, actor, institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'school.setup.read', resource);

    const [year] = await tx.execute<{ id: string }>(sql`
      select id::text from school_year where org_id = app_current_org() and institution_id = ${institutionId}
        and valid_during @> app_today()`);
    const sections = year
      ? await tx.execute<{
          id: string;
          label: string;
          students: number;
          teacher: string | null;
          teacherLinked: boolean;
          noContact: number;
        }>(sql`
          select s.id::text, c.code || '-' || s.name as label,
            (select count(*)::int from school_enrolment e
               where e.org_id = s.org_id and e.section_id = s.id and e.valid_during @> app_today()) as students,
            ct.teacher_person_id::text as teacher,
            coalesce(exists (select 1 from identity.account_person_link l
               where l.org_id = s.org_id and l.person_id = ct.teacher_person_id), false) as "teacherLinked",
            (select count(*)::int from school_enrolment e
               where e.org_id = s.org_id and e.section_id = s.id and e.valid_during @> app_today()
                 and not exists (
                   select 1 from guardian_link g join person_contact pc
                     on pc.org_id = g.org_id and pc.person_id = g.guardian_person_id and pc.disabled_at is null
                   where g.org_id = e.org_id and g.student_person_id = e.person_id and g.restricted_at is null)) as "noContact"
          from school_section s
          join school_class c on c.org_id = s.org_id and c.id = s.class_id
          left join school_teacher_allocation ct on ct.org_id = s.org_id and ct.section_id = s.id
            and ct.kind = 'class_teacher' and ct.valid_during @> app_today()
          where s.org_id = app_current_org() and s.year_id = ${year.id}
          order by c.sequence, s.name`)
      : [];

    const list = [...sections];
    const checks: ReadinessCheck[] = [
      { key: 'year_running', ok: !!year, blocking: true, missing: year ? [] : ['year'] },
      { key: 'sections', ok: list.length > 0, blocking: true, missing: [] },
      {
        key: 'class_teachers',
        ok: false,
        blocking: true,
        missing: list.filter((s) => !s.teacher).map((s) => s.label),
      },
      {
        key: 'students',
        ok: false,
        blocking: true,
        missing: list.filter((s) => s.students === 0).map((s) => s.label),
      },
      {
        key: 'teacher_logins',
        ok: false,
        blocking: true,
        // No class teacher yet means nobody there can sign in yet either.
        missing: list.filter((s) => !s.teacher || !s.teacherLinked).map((s) => s.label),
      },
      {
        key: 'guardian_contacts',
        ok: false,
        blocking: false,
        missing: list.filter((s) => s.noContact > 0).map((s) => `${s.label}: ${s.noContact}`),
      },
    ];
    for (const c of checks.slice(2)) c.ok = list.length > 0 && c.missing.length === 0;
    return { ready: checks.every((c) => c.ok || !c.blocking), checks };
  });
}
