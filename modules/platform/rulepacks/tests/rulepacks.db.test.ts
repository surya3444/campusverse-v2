import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createStaff, type Staff } from '@campusverse/platform-control';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { PACKS } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adoptPackVersion,
  boardRulesAt,
  discardPackDraft,
  draftPackVersion,
  institutionPacks,
  packCatalogue,
  packFor,
  payrollRulesAt,
  tcDeadlineAt,
  releasePackVersion,
  type RulePackDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: RulePackDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let owner: Actor;
let clerk: Actor;
let drafter: Staff;
let reviewer: Staff;
let support: Staff;
const staff = async (role: 'owner' | 'support'): Promise<Staff> => {
  const email = `synthetic-${randomInt(1e9)}@staff.campusverse.local`;
  const { staffId } = await createStaff(db, null, { name: `Synthetic ${role}`, email, role });
  return { staffId, name: `Synthetic ${role}`, email, role };
};
const ka = PACKS['state.KA'].builtin;
// Karnataka raises professional tax to ₹250 a month (synthetic): the TC test still holds; the
// February and below-threshold tests are rewritten for the new slab.
const raised = {
  ...ka.payload,
  pt: {
    period: 'month' as const,
    slabs: [{ fromPaise: 2_500_000, amountPaise: 25_000 }],
    month: { month: 2, fromPaise: 2_500_000, amountPaise: 30_000 },
  },
  tcDeadlineDays: 7,
};
const tests = [
  {
    name: '₹250 a month from ₹25,000',
    check: 'pt',
    input: { grossPaise: 3_000_000, month: 6 },
    expect: 25_000,
  },
  {
    name: 'February stays ₹300',
    check: 'pt',
    input: { grossPaise: 3_000_000, month: 2 },
    expect: 30_000,
  },
  { name: 'TC within seven days', check: 'tc.days', input: {}, expect: 7 },
];

beforeAll(async () => {
  t = await seedTenant(db, 'Rules');
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`update institution set state_code = 'KA' where id = ${t.institutionId}`),
  );
  owner = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['platform.rules.read', 'platform.rules.adopt']),
  };
  clerk = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['platform.rules.read']),
  };
  drafter = await staff('owner');
  reviewer = await staff('owner');
  support = await staff('support');
});
afterAll(() => close());

describe('rule packs', () => {
  let versionId: string;
  let version: number;

  it('an institution starts on the built-in versions of the packs it follows', async () => {
    const packs = await institutionPacks(deps, clerk, t.institutionId);
    expect(packs.map((p) => p.pack)).toEqual(['board.cbse', 'state.KA', 'labour.central']);
    expect(packs.every((p) => p.inUse.builtin && p.inUse.version === 1)).toBe(true);
    const rules = await withTenant(db, t.orgId, (tx) =>
      payrollRulesAt(tx, t.institutionId, '2026-11-30'),
    );
    expect(rules.pt?.slabs[0]?.amountPaise).toBe(20_000);
  });

  it('school modules read board and state rules through the packs', async () => {
    await withTenant(db, t.orgId, async (tx) => {
      const cbse = await boardRulesAt(tx, t.institutionId, 'CBSE', '2026-11-30');
      expect(cbse?.rules.attendance?.minimumBasisPoints).toBe(7500);
      expect(cbse?.rules.grades?.passBasisPoints).toBe(3300);
      expect(cbse?.source.title).toMatch(/attendance/i);
      expect(await boardRulesAt(tx, t.institutionId, 'NIOS', '2026-11-30')).toBeNull();
      expect(await tcDeadlineAt(tx, t.institutionId, '2026-11-30')).toMatchObject({
        days: 7,
        source: { title: expect.stringMatching(/TC/) },
      });
    });
  });

  it('staff draft a version; a malformed payload is refused; failing tests block release', async () => {
    // The catalogue is global and released versions are permanent: count from what is there.
    const [m] = await db.execute<{ v: number }>(sql`
      select coalesce(max(version), 1)::int as v from control.rule_pack_version
      where pack = 'state.KA' and status = 'released'`);
    const next = m!.v + 1;
    await expect(
      draftPackVersion(db, support, {
        pack: 'state.KA',
        effectiveFrom: '2027-04-01',
        payload: { pt: 'lots' },
        sources: ka.sources,
        tests,
        notes: 'Bad',
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    // Drafted with a test that pins the old ₹200: it fails against the new slab.
    const first = await draftPackVersion(db, support, {
      pack: 'state.KA',
      effectiveFrom: '2027-04-01',
      payload: raised,
      sources: [
        { title: 'Synthetic Karnataka PT notification', readOn: '2026-11-14', verified: false },
      ],
      tests: [
        ...ka.tests,
        {
          name: '₹200 a month',
          check: 'pt',
          input: { grossPaise: 3_000_000, month: 6 },
          expect: 20_000,
        },
      ],
      notes: 'Professional tax ₹250 a month from April 2027 (synthetic).',
    });
    expect(first.version).toBe(next);
    expect(first.results.filter((r) => !r.passed).map((r) => r.name)).toEqual(['₹200 a month']);
    await expect(releasePackVersion(db, reviewer, first.id)).rejects.toMatchObject({
      code: 'tests_failing',
    });
    // The draft is replaced with tests for the new slab, same version number.
    const second = await draftPackVersion(db, support, {
      pack: 'state.KA',
      effectiveFrom: '2027-04-01',
      payload: raised,
      sources: [
        { title: 'Synthetic Karnataka PT notification', readOn: '2026-11-14', verified: false },
      ],
      tests,
      notes: 'Professional tax ₹250 a month from April 2027 (synthetic).',
    });
    expect(second).toMatchObject({ id: first.id, version: next });
    expect(second.results.every((r) => r.passed)).toBe(true);
    versionId = second.id;
    version = second.version;
  });

  it('support can’t release; nobody releases their own draft; a released version never changes', async () => {
    await expect(releasePackVersion(db, support, versionId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const mine = await draftPackVersion(db, drafter, {
      pack: 'labour.central',
      effectiveFrom: '2027-04-01',
      payload: PACKS['labour.central'].builtin.payload,
      sources: PACKS['labour.central'].builtin.sources,
      tests: PACKS['labour.central'].builtin.tests,
      notes: 'Same values, re-checked (synthetic).',
    });
    await expect(releasePackVersion(db, drafter, mine.id)).rejects.toMatchObject({
      code: 'own_draft',
    });
    await discardPackDraft(db, drafter, mine.id);

    await releasePackVersion(db, reviewer, versionId);
    await expect(
      db.execute(sql`update control.rule_pack_version set notes = 'x' where id = ${versionId}`),
    ).rejects.toThrow();
    const catalogue = await packCatalogue(db, support);
    const kaVersions = catalogue.find((p) => p.pack === 'state.KA')!.versions;
    expect(kaVersions[0]).toMatchObject({ version, status: 'released' });
    expect(kaVersions.at(-1)).toMatchObject({ version: 1, status: 'built_in' });
    expect(kaVersions.every((v) => v.results.every((r) => r.passed))).toBe(true);
  });

  it('an institution switches on from a date; earlier dates keep the version they had', async () => {
    let packs = await institutionPacks(deps, owner, t.institutionId);
    expect(packs.find((p) => p.pack === 'state.KA')?.available.map((a) => a.version)).toContain(
      version,
    );
    await expect(
      adoptPackVersion(deps, clerk, {
        institutionId: t.institutionId,
        pack: 'state.KA',
        version,
        fromDate: '2027-04-01',
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      adoptPackVersion(deps, owner, {
        institutionId: t.institutionId,
        pack: 'state.KA',
        version,
        fromDate: '2027-03-01',
      }),
    ).rejects.toMatchObject({ code: 'before_effective' });
    await expect(
      adoptPackVersion(deps, owner, {
        institutionId: t.institutionId,
        pack: 'state.TN',
        version: 1,
        fromDate: '2027-04-01',
      }),
    ).rejects.toMatchObject({ code: 'pack_not_for_institution' });
    await adoptPackVersion(deps, owner, {
      institutionId: t.institutionId,
      pack: 'state.KA',
      version,
      fromDate: '2027-04-01',
    });
    packs = await institutionPacks(deps, owner, t.institutionId);
    expect(packs.find((p) => p.pack === 'state.KA')).toMatchObject({
      inUse: { version: 1 },
      scheduled: { version, fromDate: '2027-04-01' },
    });

    // Payroll for March 2027 uses the old slab; for April, the new one.
    await withTenant(db, t.orgId, async (tx) => {
      expect(
        (await payrollRulesAt(tx, t.institutionId, '2027-03-31')).pt?.slabs[0]?.amountPaise,
      ).toBe(20_000);
      expect(
        (await payrollRulesAt(tx, t.institutionId, '2027-04-30')).pt?.slabs[0]?.amountPaise,
      ).toBe(25_000);
      expect(await packFor(tx, t.institutionId, 'state.KA', '2027-05-01')).toMatchObject({
        version,
        builtin: false,
        fromDate: '2027-04-01',
      });
    });
  });
});
