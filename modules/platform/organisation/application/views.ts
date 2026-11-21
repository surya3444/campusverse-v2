// The view (owner's brief, 20 Nov 2026; rule book §10.3, §12.4): the part of the organisation a
// person chooses to look at — the whole organisation, some campuses, or some institutions — saved
// for them. It only narrows what screens show. What they may choose is their reach: the nodes their
// current role assignments cover. Every read still checks role × scope on its own.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit } from '@campusverse/platform-audit';
import { rolesOf, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { OrganisationError } from './profiles.js';
import { organisationTree, type TreeView } from './tree.js';

export type ViewLevel = 'organisation' | 'campus' | 'institution';
export const VIEW_LEVELS: readonly ViewLevel[] = ['organisation', 'campus', 'institution'];

export type MyView = {
  organisation: TreeView['organisation'];
  /** The campuses and institutions this person may look at (their reach). */
  campuses: TreeView['campuses'];
  /** The widest level they may choose. */
  reach: ViewLevel;
  level: ViewLevel;
  /** Campus ids (level campus) or institution ids (level institution); empty for organisation. */
  ids: string[];
  /** Every institution the view covers, in tree order. */
  institutionIds: string[];
};

const rank = (l: ViewLevel) => VIEW_LEVELS.indexOf(l);

/** The tree cut down to what this person's roles cover today. */
async function reachOf(
  tx: Tx,
  personId: string,
): Promise<{ tree: TreeView; reach: ViewLevel } | null> {
  const tree = await organisationTree(tx);
  if (!tree) return null;
  const [today] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  const d = today?.d ?? '';
  const current = (await rolesOf(tx, personId)).filter(
    (r) => r.from <= d && (r.until === null || r.until >= d),
  );
  if (current.some((r) => r.scopeType === 'organisation')) return { tree, reach: 'organisation' };
  const campusIds = new Set(current.filter((r) => r.scopeType === 'campus').map((r) => r.scopeId));
  const instIds = new Set(
    current.filter((r) => r.scopeType === 'institution').map((r) => r.scopeId),
  );
  const campuses = tree.campuses
    .map((c) =>
      campusIds.has(c.campusId)
        ? c
        : { ...c, institutions: c.institutions.filter((i) => instIds.has(i.institutionId)) },
    )
    .filter((c) => campusIds.has(c.campusId) || c.institutions.length > 0);
  return {
    tree: { ...tree, campuses },
    reach: campusIds.size > 0 ? 'campus' : 'institution',
  };
}

/** Keeps a chosen view inside the reach; anything outside it falls back to the widest view. */
function settle(
  tree: TreeView,
  reach: ViewLevel,
  level: ViewLevel,
  ids: string[],
): Pick<MyView, 'level' | 'ids' | 'institutionIds'> {
  const all = tree.campuses.flatMap((c) => c.institutions.map((i) => i.institutionId));
  // A campus is choosable only when the whole campus is in reach (not just one of its schools).
  const wholeCampuses = reach === 'institution' ? [] : tree.campuses.map((c) => c.campusId);
  if (rank(level) >= rank(reach)) {
    if (level === 'organisation') return { level, ids: [], institutionIds: all };
    const wanted = new Set(ids);
    if (level === 'campus') {
      const kept = wholeCampuses.filter((id) => wanted.has(id));
      if (kept.length > 0)
        return {
          level,
          ids: kept,
          institutionIds: tree.campuses
            .filter((c) => wanted.has(c.campusId))
            .flatMap((c) => c.institutions.map((i) => i.institutionId)),
        };
    } else {
      const kept = all.filter((id) => wanted.has(id));
      if (kept.length > 0) return { level, ids: kept, institutionIds: kept };
    }
  }
  if (reach === 'organisation') return { level: 'organisation', ids: [], institutionIds: all };
  if (reach === 'campus') return { level: 'campus', ids: wholeCampuses, institutionIds: all };
  return { level: 'institution', ids: all, institutionIds: all };
}

/** The person's view: what they may look at and what they chose (the widest view until they choose). */
export async function myView(db: Db, actor: Actor): Promise<MyView> {
  return withTenant(db, actor.orgId, async (tx) => {
    const r = await reachOf(tx, actor.personId);
    if (!r) throw new OrganisationError('organisation_not_found');
    const [saved] = await tx.execute<{ level: ViewLevel; ids: string[] }>(sql`
      select level, node_ids::text[] as ids from view_preference
      where org_id = app_current_org() and person_id = ${actor.personId}`);
    return {
      organisation: r.tree.organisation,
      campuses: r.tree.campuses,
      reach: r.reach,
      ...settle(r.tree, r.reach, saved?.level ?? r.reach, saved?.ids ?? []),
    };
  });
}

/** Saves the person's view. Refused if it reaches past their roles, so a saved view is always honest. */
export async function saveView(
  db: Db,
  actor: Actor,
  input: { level: ViewLevel; ids: string[] },
): Promise<MyView> {
  await withTenant(db, actor.orgId, async (tx) => {
    const r = await reachOf(tx, actor.personId);
    if (!r) throw new OrganisationError('organisation_not_found');
    const ids = [...new Set(input.ids)];
    if (rank(input.level) < rank(r.reach)) throw new OrganisationError('view_out_of_reach');
    if ((input.level === 'organisation') !== (ids.length === 0))
      throw new OrganisationError('view_invalid');
    const settled = settle(r.tree, r.reach, input.level, ids);
    if (settled.level !== input.level || settled.ids.length !== ids.length)
      throw new OrganisationError('view_out_of_reach');
    await tx.execute(sql`
      insert into view_preference (org_id, person_id, level, node_ids)
      values (app_current_org(), ${actor.personId}, ${input.level}, ${`{${ids.join(',')}}`}::uuid[])
      on conflict (org_id, person_id) do update
        set level = excluded.level, node_ids = excluded.node_ids, updated_at = now()`);
    await writeAudit(tx, actor, {
      action: 'platform.view.save',
      entityType: 'person',
      entityId: actor.personId,
      dataClass: 'operational',
      detail: { level: input.level, nodes: ids.length },
    });
  });
  return myView(db, actor);
}
