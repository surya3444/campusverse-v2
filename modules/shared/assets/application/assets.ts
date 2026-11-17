// Assets and inventory (docs/specs/ASSETS.md): a register of tagged assets with location,
// custodian, condition, warranty and an append-only history; disposal kept on record; consumable
// stock received and issued against a balance, with low flags. Custodians come from people/records.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, memberKind, searchMembers } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { isLow, nextTags, warrantyEndingSoon } from '../domain/assets.js';

type Permissions = ReturnType<typeof createPermissions>;
export type AssetDeps = { db: Db; permissions: Permissions };

export const CONDITION_CHANGED = 'assets.item.condition_changed.v1';
export const STOCK_LOW = 'assets.stock.low.v1';
export const CONDITIONS = ['good', 'needs_repair', 'broken'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const DEFAULT_CATEGORIES = [
  'Furniture',
  'IT equipment',
  'Lab equipment',
  'Sports equipment',
  'Electrical',
  'Musical instruments',
  'Other',
];

export class AssetError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'category_not_found'
      | 'location_not_found'
      | 'name_taken'
      | 'tag_taken'
      | 'item_not_found'
      | 'disposed'
      | 'not_staff'
      | 'not_enough_stock'
      | 'no_change',
  ) {
    super(`assets: ${code}`);
    this.name = 'AssetError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new AssetError('institution_not_found');
  return p;
}
const res = (actor: Actor, p: Resource['place']): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
});
const where = (deps: AssetDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, async (tx) => res(actor, await place(tx, institutionId)));

function reading<T>(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'assets.item.read',
      res(actor, await place(tx, institutionId)),
    );
    return work(tx);
  });
}
const write = async <T>(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
  permission: 'assets.item.manage' | 'assets.stock.manage',
  work: Parameters<typeof command<T>>[4],
) =>
  command(
    deps.db,
    deps.permissions,
    actor,
    { permission, resource: await where(deps, actor, institutionId) },
    work,
  );

/** The default categories for a new organisation. Safe to repeat. */
export async function installAssetCategories(tx: Tx): Promise<void> {
  for (const name of DEFAULT_CATEGORIES)
    await tx.execute(sql`
      insert into asset_category (org_id, name) values (app_current_org(), ${name}) on conflict do nothing`);
}

// ---------------------------------------------------------------------------------------------
// Categories and locations
// ---------------------------------------------------------------------------------------------

export type Named = { id: string; name: string; active: boolean };

export async function assetSetup(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ categories: Named[]; locations: Named[] }> {
  return reading(deps, actor, institutionId, async (tx) => ({
    categories: [
      ...(await tx.execute<Named>(sql`
        select id::text, name, active from asset_category where org_id = app_current_org() order by active desc, name`)),
    ],
    locations: [
      ...(await tx.execute<Named>(sql`
        select id::text, name, active from asset_location where org_id = app_current_org()
          and institution_id = ${institutionId} order by active desc, name`)),
    ],
  }));
}

/** Adds or edits a category (organisation-wide) or a location (this school). */
export async function saveNamed(
  deps: AssetDeps,
  actor: Actor,
  input: {
    institutionId: string;
    kind: 'category' | 'location';
    id: string | null;
    name: string;
    active: boolean;
  },
): Promise<{ id: string }> {
  return write(deps, actor, input.institutionId, 'assets.item.manage', async (tx) => {
    const name = input.name.trim();
    const table = input.kind === 'category' ? sql`asset_category` : sql`asset_location`;
    const scope =
      input.kind === 'location' ? sql`and institution_id = ${input.institutionId}` : sql``;
    const [same] = await tx.execute<{ id: string }>(sql`
      select id::text from ${table} where org_id = app_current_org() ${scope} and lower(btrim(name)) = lower(${name})`);
    if (same && same.id !== input.id) throw new AssetError('name_taken');
    let id = input.id;
    if (id) {
      const done = await tx.execute(sql`
        update ${table} set name = ${name}, active = ${input.active}
        where org_id = app_current_org() ${scope} and id = ${id} returning id`);
      if (done.length === 0)
        throw new AssetError(
          input.kind === 'category' ? 'category_not_found' : 'location_not_found',
        );
    } else {
      const [row] = await tx.execute<{ id: string }>(
        input.kind === 'category'
          ? sql`insert into asset_category (org_id, name, active) values (app_current_org(), ${name}, ${input.active}) returning id::text`
          : sql`insert into asset_location (org_id, institution_id, name, active)
              values (app_current_org(), ${input.institutionId}, ${name}, ${input.active}) returning id::text`,
      );
      id = row?.id ?? '';
    }
    return {
      result: { id },
      audit: {
        action: `assets.${input.kind}.save`,
        entityType: `asset_${input.kind}`,
        entityId: id,
        dataClass: 'operational',
        detail: { name, active: input.active },
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------------------------

export type AssetRow = {
  itemId: string;
  tag: string;
  name: string;
  categoryId: string;
  category: string;
  locationId: string | null;
  location: string | null;
  custodianId: string | null;
  custodian: string | null;
  condition: Condition;
  purchasedOn: string | null;
  costPaise: number | null;
  vendor: string;
  serialNo: string;
  warrantyUntil: string | null;
  warrantySoon: boolean;
  notes: string;
  disposedOn: string | null;
  disposedReason: string | null;
};

async function assetRows(tx: Tx, filter: ReturnType<typeof sql>): Promise<AssetRow[]> {
  const on = await today(tx);
  const rows = await tx.execute<
    Omit<AssetRow, 'custodian' | 'warrantySoon' | 'costPaise'> & { costPaise: string | null }
  >(sql`
    select i.id::text as "itemId", i.tag, i.name, i.category_id::text as "categoryId", c.name as category,
      i.location_id::text as "locationId", l.name as location, i.custodian_person_id::text as "custodianId",
      i.condition, i.purchased_on::text as "purchasedOn", i.cost_paise::text as "costPaise", i.vendor,
      i.serial_no as "serialNo", i.warranty_until::text as "warrantyUntil", i.notes,
      i.disposed_on::text as "disposedOn", i.disposed_reason as "disposedReason"
    from asset_item i
    join asset_category c on c.org_id = i.org_id and c.id = i.category_id
    left join asset_location l on l.org_id = i.org_id and l.id = i.location_id
    where i.org_id = app_current_org() and ${filter}
    order by i.disposed_on is not null, i.condition <> 'good' desc, upper(i.tag)
    limit 1000`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => (r.custodianId ? [r.custodianId] : [])),
  );
  return rows.map((r) => ({
    ...r,
    costPaise: r.costPaise === null ? null : Number(r.costPaise),
    custodian: r.custodianId ? (names[r.custodianId] ?? null) : null,
    warrantySoon: !r.disposedOn && warrantyEndingSoon(r.warrantyUntil, on),
  }));
}

export async function assets(
  deps: AssetDeps,
  actor: Actor,
  input: {
    institutionId: string;
    search: string;
    locationId?: string | null | undefined;
    categoryId?: string | null | undefined;
    condition?: Condition | null | undefined;
    disposed?: boolean | undefined;
  },
): Promise<AssetRow[]> {
  return reading(deps, actor, input.institutionId, (tx) => {
    const q = `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return assetRows(
      tx,
      sql`i.institution_id = ${input.institutionId}
        and (i.tag ilike ${q} or i.name ilike ${q} or i.serial_no ilike ${q})
        and (${input.locationId ?? null}::uuid is null or i.location_id = ${input.locationId ?? null}::uuid)
        and (${input.categoryId ?? null}::uuid is null or i.category_id = ${input.categoryId ?? null}::uuid)
        and (${input.condition ?? null}::text is null or i.condition = ${input.condition ?? null})
        and ${input.disposed ? sql`i.disposed_on is not null` : sql`i.disposed_on is null`}`,
    );
  });
}

/** What one person holds (custodian or issued to), for their staff record. */
export async function assetsHeldBy(
  deps: AssetDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<AssetRow[]> {
  return reading(deps, actor, input.institutionId, (tx) =>
    assetRows(
      tx,
      sql`i.institution_id = ${input.institutionId} and i.disposed_on is null
        and i.custodian_person_id = ${input.personId}`,
    ),
  );
}

export type AssetEvent = {
  kind: string;
  from: string;
  to: string;
  note: string;
  by: string | null;
  at: string;
};

export async function asset(
  deps: AssetDeps,
  actor: Actor,
  input: { institutionId: string; itemId: string },
): Promise<AssetRow & { history: AssetEvent[] }> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const [row] = await assetRows(
      tx,
      sql`i.institution_id = ${input.institutionId} and i.id = ${input.itemId}`,
    );
    if (!row) throw new AssetError('item_not_found');
    const events = await tx.execute<Omit<AssetEvent, 'by'> & { byId: string }>(sql`
      select kind, from_value as from, to_value as to, note, by_person_id::text as "byId", at
      from asset_event where org_id = app_current_org() and item_id = ${input.itemId} order by at desc, id desc`);
    const names = await displayNames(
      tx,
      events.map((e) => e.byId),
    );
    return {
      ...row,
      history: events.map(({ byId, ...e }) => ({
        ...e,
        by: names[byId] ?? null,
        at: new Date(e.at).toISOString(),
      })),
    };
  });
}

export async function suggestTag(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
): Promise<string> {
  return reading(deps, actor, institutionId, async (tx) => {
    const rows = await tx.execute<{ tag: string }>(sql`
      select tag from asset_item where org_id = app_current_org() and institution_id = ${institutionId}`);
    return (
      nextTags(
        rows.map((r) => r.tag),
        1,
      )[0] ?? 'AST-0001'
    );
  });
}

/** Staff of the school to be custodians, by name or employee code. */
export async function findCustodians(
  deps: AssetDeps,
  actor: Actor,
  input: { institutionId: string; text: string },
): Promise<{ personId: string; name: string; employeeCode: string | null }[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    if (input.text.trim().length < 2) return [];
    return (
      await searchMembers(tx, {
        institutionId: input.institutionId,
        text: input.text,
        onDate: await today(tx),
      })
    )
      .filter((m) => m.kind === 'staff')
      .map((m) => ({ personId: m.personId, name: m.name, employeeCode: m.employeeCode }));
  });
}

async function checkRefs(
  tx: Tx,
  institutionId: string,
  r: {
    categoryId?: string | null | undefined;
    locationId?: string | null | undefined;
    custodianPersonId?: string | null | undefined;
  },
) {
  if (r.categoryId) {
    const [c] = await tx.execute(sql`
      select 1 from asset_category where org_id = app_current_org() and id = ${r.categoryId} and active`);
    if (!c) throw new AssetError('category_not_found');
  }
  if (r.locationId) {
    const [l] = await tx.execute(sql`
      select 1 from asset_location where org_id = app_current_org() and id = ${r.locationId}
        and institution_id = ${institutionId} and active`);
    if (!l) throw new AssetError('location_not_found');
  }
  if (r.custodianPersonId) {
    const kind = await memberKind(tx, {
      institutionId,
      personId: r.custodianPersonId,
      onDate: await today(tx),
    });
    if (kind !== 'staff') throw new AssetError('not_staff');
  }
}

export type AssetInput = {
  institutionId: string;
  tag: string;
  name: string;
  categoryId: string;
  locationId: string | null;
  custodianPersonId: string | null;
  condition: Condition;
  purchasedOn: string | null;
  costPaise: number | null;
  vendor: string;
  serialNo: string;
  warrantyUntil: string | null;
  notes: string;
};

export async function addAsset(
  deps: AssetDeps,
  actor: Actor,
  input: AssetInput,
): Promise<{ itemId: string }> {
  return write(deps, actor, input.institutionId, 'assets.item.manage', async (tx) => {
    await checkRefs(tx, input.institutionId, input);
    const [dup] = await tx.execute(sql`
      select 1 from asset_item where org_id = app_current_org() and institution_id = ${input.institutionId}
        and upper(tag) = upper(${input.tag.trim()})`);
    if (dup) throw new AssetError('tag_taken');
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into asset_item (org_id, institution_id, tag, name, category_id, location_id, custodian_person_id, condition,
        purchased_on, cost_paise, vendor, serial_no, warranty_until, notes)
      values (app_current_org(), ${input.institutionId}, ${input.tag.trim()}, ${input.name.trim()}, ${input.categoryId},
        ${input.locationId}, ${input.custodianPersonId}, ${input.condition}, ${input.purchasedOn}::date, ${input.costPaise},
        ${input.vendor.trim()}, ${input.serialNo.trim()}, ${input.warrantyUntil}::date, ${input.notes.trim()})
      returning id::text`);
    const itemId = row?.id ?? '';
    await tx.execute(sql`
      insert into asset_event (org_id, item_id, kind, to_value, by_person_id)
      values (app_current_org(), ${itemId}, 'added', ${input.tag.trim()}, ${actor.personId})`);
    return {
      result: { itemId },
      audit: {
        action: 'assets.item.add',
        entityType: 'asset_item',
        entityId: itemId,
        dataClass: 'operational',
        detail: { tag: input.tag.trim(), name: input.name.trim(), costPaise: input.costPaise },
      },
    };
  });
}

/** Moves, hands over or re-rates an asset; each change is a line in its history. */
export async function updateAsset(
  deps: AssetDeps,
  actor: Actor,
  input: {
    institutionId: string;
    itemId: string;
    locationId?: string | null | undefined;
    custodianPersonId?: string | null | undefined;
    condition?: Condition | undefined;
    note: string;
  },
): Promise<void> {
  await write(deps, actor, input.institutionId, 'assets.item.manage', async (tx) => {
    const [cur] = await tx.execute<{
      locationId: string | null;
      location: string | null;
      custodianId: string | null;
      condition: Condition;
      disposed: boolean;
    }>(sql`
      select i.location_id::text as "locationId", l.name as location, i.custodian_person_id::text as "custodianId",
        i.condition, i.disposed_on is not null as disposed
      from asset_item i left join asset_location l on l.org_id = i.org_id and l.id = i.location_id
      where i.org_id = app_current_org() and i.id = ${input.itemId} and i.institution_id = ${input.institutionId}
      for update of i`);
    if (!cur) throw new AssetError('item_not_found');
    if (cur.disposed) throw new AssetError('disposed');
    await checkRefs(tx, input.institutionId, input);
    const note = input.note.trim();
    const events: { kind: string; from: string; to: string }[] = [];
    if (input.locationId !== undefined && input.locationId !== cur.locationId) {
      const [l] = input.locationId
        ? await tx.execute<{ name: string }>(sql`
            select name from asset_location where org_id = app_current_org() and id = ${input.locationId}`)
        : [];
      events.push({ kind: 'moved', from: cur.location ?? '', to: l?.name ?? '' });
      await tx.execute(sql`
        update asset_item set location_id = ${input.locationId} where org_id = app_current_org() and id = ${input.itemId}`);
    }
    if (input.custodianPersonId !== undefined && input.custodianPersonId !== cur.custodianId) {
      const names = await displayNames(
        tx,
        [cur.custodianId, input.custodianPersonId].filter((x): x is string => !!x),
      );
      events.push({
        kind: 'custodian',
        from: cur.custodianId ? (names[cur.custodianId] ?? '') : '',
        to: input.custodianPersonId ? (names[input.custodianPersonId] ?? '') : '',
      });
      await tx.execute(sql`
        update asset_item set custodian_person_id = ${input.custodianPersonId}
        where org_id = app_current_org() and id = ${input.itemId}`);
    }
    const conditionChanged = input.condition !== undefined && input.condition !== cur.condition;
    if (conditionChanged && input.condition) {
      events.push({ kind: 'condition', from: cur.condition, to: input.condition });
      await tx.execute(sql`
        update asset_item set condition = ${input.condition} where org_id = app_current_org() and id = ${input.itemId}`);
    }
    if (events.length === 0) throw new AssetError('no_change');
    for (const e of events)
      await tx.execute(sql`
        insert into asset_event (org_id, item_id, kind, from_value, to_value, note, by_person_id)
        values (app_current_org(), ${input.itemId}, ${e.kind}, ${e.from}, ${e.to}, ${note}, ${actor.personId})`);
    return {
      result: undefined,
      audit: {
        action: 'assets.item.update',
        entityType: 'asset_item',
        entityId: input.itemId,
        dataClass: 'operational',
        detail: { changes: events.map((e) => e.kind).join(','), note },
      },
      events: conditionChanged
        ? [
            {
              type: CONDITION_CHANGED,
              payload: { itemId: input.itemId, condition: input.condition ?? '' },
            },
          ]
        : [],
    };
  });
}

/** Writes an asset off: it stays in the register as disposed, with the reason. */
export async function disposeAsset(
  deps: AssetDeps,
  actor: Actor,
  input: { institutionId: string; itemId: string; reason: string },
): Promise<void> {
  await write(deps, actor, input.institutionId, 'assets.item.manage', async (tx) => {
    const on = await today(tx);
    const done = await tx.execute(sql`
      update asset_item set disposed_on = ${on}::date, disposed_reason = ${input.reason.trim()}
      where org_id = app_current_org() and id = ${input.itemId} and institution_id = ${input.institutionId}
        and disposed_on is null returning id`);
    if (done.length === 0) throw new AssetError('item_not_found');
    await tx.execute(sql`
      insert into asset_event (org_id, item_id, kind, note, by_person_id)
      values (app_current_org(), ${input.itemId}, 'disposed', ${input.reason.trim()}, ${actor.personId})`);
    return {
      result: undefined,
      audit: {
        action: 'assets.item.dispose',
        entityType: 'asset_item',
        entityId: input.itemId,
        dataClass: 'operational',
        detail: { reason: input.reason.trim() },
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------

export type StockRow = {
  itemId: string;
  name: string;
  unit: string;
  reorderLevel: number;
  balance: number;
  low: boolean;
  active: boolean;
};

async function stockRows(tx: Tx, institutionId: string, itemId?: string): Promise<StockRow[]> {
  const rows = await tx.execute<Omit<StockRow, 'low'>>(sql`
    select s.id::text as "itemId", s.name, s.unit, s.reorder_level as "reorderLevel", s.active,
      coalesce(sum(case when m.direction = 'in' then m.quantity else -m.quantity end), 0)::int as balance
    from stock_item s left join stock_movement m on m.org_id = s.org_id and m.item_id = s.id
    where s.org_id = app_current_org() and s.institution_id = ${institutionId}
      ${itemId ? sql`and s.id = ${itemId}` : sql``}
    group by s.org_id, s.id
    order by s.active desc, s.name`);
  return rows
    .map((r) => ({ ...r, low: r.active && isLow(r.balance, r.reorderLevel) }))
    .sort((a, b) => Number(b.low) - Number(a.low));
}

export async function stock(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
): Promise<StockRow[]> {
  return reading(deps, actor, institutionId, (tx) => stockRows(tx, institutionId));
}

export type StockMove = {
  direction: 'in' | 'out';
  quantity: number;
  note: string;
  issuedTo: string | null;
  by: string | null;
  at: string;
};

export async function stockMovements(
  deps: AssetDeps,
  actor: Actor,
  input: { institutionId: string; itemId: string },
): Promise<StockMove[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const rows = await tx.execute<
      Omit<StockMove, 'issuedTo' | 'by'> & { issuedToId: string | null; byId: string }
    >(sql`
      select m.direction, m.quantity, m.note, m.issued_to_person_id::text as "issuedToId", m.by_person_id::text as "byId",
        m.at
      from stock_movement m join stock_item s on s.org_id = m.org_id and s.id = m.item_id
      where m.org_id = app_current_org() and m.item_id = ${input.itemId} and s.institution_id = ${input.institutionId}
      order by m.at desc limit 50`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => [r.byId, r.issuedToId].filter((x): x is string => !!x)),
    );
    return rows.map(({ issuedToId, byId, ...r }) => ({
      ...r,
      issuedTo: issuedToId ? (names[issuedToId] ?? null) : null,
      by: names[byId] ?? null,
      at: new Date(r.at).toISOString(),
    }));
  });
}

export async function saveStockItem(
  deps: AssetDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id: string | null;
    name: string;
    unit: string;
    reorderLevel: number;
    active: boolean;
  },
): Promise<{ id: string }> {
  return write(deps, actor, input.institutionId, 'assets.stock.manage', async (tx) => {
    const name = input.name.trim();
    const [same] = await tx.execute<{ id: string }>(sql`
      select id::text from stock_item where org_id = app_current_org() and institution_id = ${input.institutionId}
        and lower(btrim(name)) = lower(${name})`);
    if (same && same.id !== input.id) throw new AssetError('name_taken');
    let id = input.id;
    if (id) {
      const done = await tx.execute(sql`
        update stock_item set name = ${name}, unit = ${input.unit.trim()}, reorder_level = ${input.reorderLevel},
          active = ${input.active}
        where org_id = app_current_org() and id = ${id} and institution_id = ${input.institutionId} returning id`);
      if (done.length === 0) throw new AssetError('item_not_found');
    } else {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into stock_item (org_id, institution_id, name, unit, reorder_level, active)
        values (app_current_org(), ${input.institutionId}, ${name}, ${input.unit.trim()}, ${input.reorderLevel}, ${input.active})
        returning id::text`);
      id = row?.id ?? '';
    }
    return {
      result: { id },
      audit: {
        action: 'assets.stock_item.save',
        entityType: 'stock_item',
        entityId: id,
        dataClass: 'operational',
        detail: { name, unit: input.unit.trim(), reorderLevel: input.reorderLevel },
      },
    };
  });
}

/** Receives (in) or issues (out) stock; issuing more than the balance is refused. */
export async function moveStock(
  deps: AssetDeps,
  actor: Actor,
  input: {
    institutionId: string;
    itemId: string;
    direction: 'in' | 'out';
    quantity: number;
    note: string;
    issuedToPersonId: string | null;
  },
): Promise<{ balance: number; low: boolean }> {
  return write(deps, actor, input.institutionId, 'assets.stock.manage', async (tx) => {
    const [lock] = await tx.execute(sql`
      select 1 from stock_item where org_id = app_current_org() and id = ${input.itemId}
        and institution_id = ${input.institutionId} and active for update`);
    if (!lock) throw new AssetError('item_not_found');
    const [before] = await stockRows(tx, input.institutionId, input.itemId);
    if (!before) throw new AssetError('item_not_found');
    if (input.direction === 'out' && input.quantity > before.balance)
      throw new AssetError('not_enough_stock');
    if (input.issuedToPersonId) {
      const kind = await memberKind(tx, {
        institutionId: input.institutionId,
        personId: input.issuedToPersonId,
        onDate: await today(tx),
      });
      if (!kind) throw new AssetError('not_staff');
    }
    await tx.execute(sql`
      insert into stock_movement (org_id, item_id, direction, quantity, note, issued_to_person_id, by_person_id)
      values (app_current_org(), ${input.itemId}, ${input.direction}, ${input.quantity}, ${input.note.trim()},
        ${input.direction === 'out' ? input.issuedToPersonId : null}, ${actor.personId})`);
    const balance = before.balance + (input.direction === 'in' ? input.quantity : -input.quantity);
    const low = isLow(balance, before.reorderLevel);
    return {
      result: { balance, low },
      audit: {
        action: input.direction === 'in' ? 'assets.stock.receive' : 'assets.stock.issue',
        entityType: 'stock_item',
        entityId: input.itemId,
        dataClass: 'operational',
        detail: { quantity: input.quantity, balance },
      },
      events:
        low && !before.low ? [{ type: STOCK_LOW, payload: { itemId: input.itemId, balance } }] : [],
    };
  });
}

export type AssetFigures = {
  assets: number;
  needsAttention: number;
  warrantySoon: number;
  stockLow: number;
  valuePaise: number;
};

export async function assetFigures(
  deps: AssetDeps,
  actor: Actor,
  institutionId: string,
): Promise<AssetFigures> {
  return reading(deps, actor, institutionId, async (tx) => {
    const rows = await assetRows(
      tx,
      sql`i.institution_id = ${institutionId} and i.disposed_on is null`,
    );
    const st = await stockRows(tx, institutionId);
    return {
      assets: rows.length,
      needsAttention: rows.filter((r) => r.condition !== 'good').length,
      warrantySoon: rows.filter((r) => r.warrantySoon).length,
      stockLow: st.filter((s) => s.low).length,
      valuePaise: rows.reduce((n, r) => n + (r.costPaise ?? 0), 0),
    };
  });
}
