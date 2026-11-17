// Assets and inventory across modules (docs/specs/ASSETS.md): tags unique per school, custodians
// only from staff, every change a line in an append-only history, disposed assets kept and frozen,
// stock never issued below zero, low flagged once, and only the office may change anything.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  addAsset,
  asset,
  assetFigures,
  assetSetup,
  assets,
  disposeAsset,
  installAssetCategories,
  moveStock,
  saveNamed,
  saveStockItem,
  stock,
  suggestTag,
  updateAsset,
  type AssetDeps,
  type AssetInput,
} from '@campusverse/shared-assets';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: AssetDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let office: Actor;
let viewer: Actor;
let categoryId: string;
let labId: string;
let itemId: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Assets');
  await withTenant(db, t.orgId, (tx) => installAssetCategories(tx));
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'assets.item.read',
      'assets.item.manage',
      'assets.stock.manage',
    ]),
  };
  viewer = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['assets.item.read']),
  };
  const setup = await assetSetup(deps, viewer, t.institutionId);
  categoryId = setup.categories.find((c) => c.name === 'IT equipment')?.id ?? '';
  labId = (
    await saveNamed(deps, office, {
      institutionId: t.institutionId,
      kind: 'location',
      id: null,
      name: 'Computer Lab',
      active: true,
    })
  ).id;
});
afterAll(() => close());

describe('the register', () => {
  it('suggests the next tag, refuses a tag in use, and only the office adds', async () => {
    expect(await suggestTag(deps, viewer, t.institutionId)).toBe('AST-0002');
    const input: AssetInput = {
      institutionId: t.institutionId,
      tag: 'AST-0002',
      name: 'Synthetic projector',
      categoryId,
      locationId: labId,
      custodianPersonId: t.teacherId,
      condition: 'good',
      purchasedOn: '2025-06-01',
      costPaise: 3_500_000,
      vendor: 'Synthetic Electronics',
      serialNo: 'PJ-778',
      warrantyUntil: '2026-12-01',
      notes: '',
    };
    itemId = (await addAsset(deps, office, input)).itemId;
    expect(await code(addAsset(deps, office, { ...input, tag: 'ast-0002' }))).toBe('tag_taken');
    expect(await code(addAsset(deps, viewer, { ...input, tag: 'AST-0003' }))).toBe('denied');
    expect(
      await code(
        addAsset(deps, office, { ...input, tag: 'AST-0004', custodianPersonId: t.studentId }),
      ),
    ).toBe('not_staff');
    const [row] = await assets(deps, viewer, { institutionId: t.institutionId, search: 'pj-778' });
    expect(row).toMatchObject({
      tag: 'AST-0002',
      location: 'Computer Lab',
      custodian: expect.stringContaining('Teacher'),
    });
  });

  it('records every move and condition change, and keeps the history unchangeable', async () => {
    await updateAsset(deps, office, {
      institutionId: t.institutionId,
      itemId,
      locationId: null,
      condition: 'needs_repair',
      note: 'Lamp flickers',
    });
    expect(
      await code(
        updateAsset(deps, office, {
          institutionId: t.institutionId,
          itemId,
          condition: 'needs_repair',
          note: '',
        }),
      ),
    ).toBe('no_change');
    const a = await asset(deps, viewer, { institutionId: t.institutionId, itemId });
    expect(a.history.map((h) => [h.kind, h.from, h.to])).toEqual(
      expect.arrayContaining([
        ['moved', 'Computer Lab', ''],
        ['condition', 'good', 'needs_repair'],
        ['added', '', 'AST-0002'],
      ]),
    );
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update asset_event set note = 'x' where org_id = app_current_org()`),
      ),
    ).rejects.toThrow();
    const f = await assetFigures(deps, viewer, t.institutionId);
    // The seed's desk and this projector; the projector needs repair and its warranty ends soon.
    expect(f).toMatchObject({
      assets: 2,
      needsAttention: 1,
      warrantySoon: 1,
      valuePaise: 450_000 + 3_500_000,
    });
  });

  it('disposes with a reason, keeps the record and freezes it', async () => {
    await disposeAsset(deps, office, {
      institutionId: t.institutionId,
      itemId,
      reason: 'Beyond repair',
    });
    expect(
      await code(
        updateAsset(deps, office, {
          institutionId: t.institutionId,
          itemId,
          condition: 'broken',
          note: '',
        }),
      ),
    ).toBe('disposed');
    expect(
      (await assets(deps, viewer, { institutionId: t.institutionId, search: '' })).map(
        (a) => a.tag,
      ),
    ).toEqual(['AST-0001']);
    expect(
      (
        await assets(deps, viewer, { institutionId: t.institutionId, search: '', disposed: true })
      )[0],
    ).toMatchObject({ tag: 'AST-0002', disposedReason: 'Beyond repair' });
  });
});

describe('stock', () => {
  it('never issues below zero and flags low once it reaches the reorder level', async () => {
    const paper = (
      await saveStockItem(deps, office, {
        institutionId: t.institutionId,
        id: null,
        name: 'A4 paper',
        unit: 'reams',
        reorderLevel: 3,
        active: true,
      })
    ).id;
    const move = (direction: 'in' | 'out', quantity: number, who = office) =>
      moveStock(deps, who, {
        institutionId: t.institutionId,
        itemId: paper,
        direction,
        quantity,
        note: '',
        issuedToPersonId: direction === 'out' ? t.teacherId : null,
      });
    await move('in', 10);
    expect(await code(move('out', 11))).toBe('not_enough_stock');
    expect(await code(move('out', 1, viewer))).toBe('denied');
    expect(await move('out', 6)).toEqual({ balance: 4, low: false });
    expect(await move('out', 1)).toEqual({ balance: 3, low: true });
    const list = await stock(deps, viewer, t.institutionId);
    expect(list[0]).toMatchObject({ name: 'A4 paper', balance: 3, low: true });
    expect(list.find((s) => s.name === 'Chalk')).toMatchObject({ balance: 20, low: false });
  });
});
