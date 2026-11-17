// Arrears (rule book §13.7 Assignments & Arrears) and the ESI return: a raise back-dated into an
// approved month is paid in the next run, once; the ESI file lists members with an IP number.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createStaff } from '@campusverse/people-records';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveRun,
  prepareRun,
  previewRun,
  setSalary,
  statutoryReturns,
  type PayrollDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const deps: PayrollDeps = { db, permissions, holidays: async () => [] };
const R = 100;

let t: SeededTenant;
let owner: Actor;
let principal: Actor;
let staffId: string;
const salary = (basic: number, effectiveFrom: string) => ({
  basic: basic * R,
  da: 0,
  hra: 4_000 * R,
  conveyance: 0,
  special: 0,
  other: 0,
  pf: true,
  esi: true,
  pt: false,
  tdsPaise: 0,
  otherDeductionPaise: 0,
  institutionId: t.institutionId,
  personId: staffId,
  effectiveFrom,
});
const month = async (m: string) => {
  const { runId } = await prepareRun(deps, owner, { institutionId: t.institutionId, month: m });
  await approveRun(deps, principal, runId);
  return runId;
};

beforeAll(async () => {
  t = await seedTenant(db, 'Arrears');
  const actor = async (grants: string[]): Promise<Actor> => ({
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, grants),
  });
  owner = await actor(['payroll.salary.manage', 'payroll.run.prepare', 'people.staff.create']);
  principal = await actor(['payroll.run.approve']);
  staffId = await createStaff(
    { db, permissions, keys: parseFieldKeys(env.FIELD_KEYS), placements: [] },
    owner,
    {
      institutionId: t.institutionId,
      name: 'Synthetic Arrears Teacher',
      phone: '+919000000711',
      joinedOn: '2026-08-01',
    },
  );
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(
      sql`update staff_profile set esi_number = '3100000001' where person_id = ${staffId}`,
    ),
  );
  await setSalary(deps, owner, salary(15_000, '2026-08-01'));
});
afterAll(() => close());

describe('arrears', () => {
  it('pays a back-dated raise in the next run, once, with the PF and ESI on it', async () => {
    await month('2026-09');
    // The raise comes in October, back-dated to 1 September.
    await setSalary(deps, owner, salary(17_000, '2026-09-01'));
    const oct = await previewRun(deps, owner, { institutionId: t.institutionId, month: '2026-10' });
    const slip = oct.slips.find((s) => s.personId === staffId)!;
    expect(slip.arrears).toBe(2_000 * R);
    expect(slip.arrearsMonths).toEqual(['2026-09']);
    // October's own pay (₹21,000) plus September's ₹2,000.
    expect(slip.gross).toBe(23_000 * R);
    const runId = await month('2026-10');
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number; gross: string }>(sql`
        select count(*)::int as n, sum(gross_paise)::text as gross from payroll_arrear
        where run_id = ${runId} and person_id = ${staffId} and for_month = '2026-09-01'`),
    );
    expect(row).toEqual({ n: 1, gross: String(2_000 * R) });

    // November: September's difference is paid; nothing more.
    const nov = await previewRun(deps, owner, { institutionId: t.institutionId, month: '2026-11' });
    expect(nov.slips.find((s) => s.personId === staffId)).toMatchObject({
      arrears: 0,
      arrearsMonths: [],
    });

    // The ESI file for October lists the member with their IP number.
    const r = await statutoryReturns(deps, owner, runId);
    expect(r.esiMembers).toBe(1);
    expect(r.esi.split('\n')[1]).toBe('3100000001,SYNTHETIC ARREARS TEACHER,31,23000,,');
    expect(r.withoutIp).toEqual([]);
  });
});
