import type { Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type TreeView = {
  organisation: { orgId: string; name: string };
  campuses: {
    campusId: string;
    name: string;
    city: string | null;
    institutions: { institutionId: string; name: string; type: string; status: string }[];
  }[];
};

/** The organisation, its campuses and their institutions, for the scope switcher. Call inside the tenant. */
export async function organisationTree(tx: Tx): Promise<TreeView | null> {
  const [org] = await tx.execute<TreeView['organisation']>(sql`
    select id::text as "orgId", name from organisation where id = app_current_org()`);
  if (!org) return null;
  const rows = await tx.execute<{
    campusId: string;
    campus: string;
    city: string | null;
    institutionId: string | null;
    name: string | null;
    type: string | null;
    status: string | null;
  }>(sql`
    select c.id::text as "campusId", c.name as campus, c.city, i.id::text as "institutionId", i.name, i.type, i.status
    from campus c left join institution i on i.org_id = c.org_id and i.campus_id = c.id
    where c.org_id = app_current_org() order by c.name, i.name`);
  const campuses = new Map<string, TreeView['campuses'][number]>();
  for (const r of rows) {
    const c = campuses.get(r.campusId) ?? {
      campusId: r.campusId,
      name: r.campus,
      city: r.city,
      institutions: [],
    };
    if (r.institutionId && r.name && r.type && r.status)
      c.institutions.push({
        institutionId: r.institutionId,
        name: r.name,
        type: r.type,
        status: r.status,
      });
    campuses.set(r.campusId, c);
  }
  return { organisation: org, campuses: [...campuses.values()] };
}
