// Final settlement (rule book §13.7; Labour Codes): a leaver's salary to the last day and
// gratuity, due two working days after the last day, prepared by one person, approved by another
// through the workflow engine, and paid with a reference.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createStaff, exitStaff } from '@campusverse/people-records';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  decideSettlement,
  markSettlementPaid,
  prepareSettlement,
  setSalary,
  settlements,
  type PayrollDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const deps: PayrollDeps = { db, permissions, holidays: async () => [] };
const people = { db, permissions, keys: parseFieldKeys(env.FIELD_KEYS), placements: [] };
const R = 100;
const ist = (offsetDays: number) =>
  new Date(Date.now() + 330 * 60_000 + offsetDays * 864e5).toISOString().slice(0, 10);

let t: SeededTenant;
let owner: Actor;
let office: Actor;
let principal: Actor;
let clerk: Actor;
let leaver: string;
let noSalary: string;
const lastDay = ist(-6);

beforeAll(async () => {
  t = await seedTenant(db, 'Settlement');
  const actor = async (grants: string[]): Promise<Actor> => ({
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, grants),
  });
  owner = await actor([
    'payroll.salary.manage',
    'people.staff.create',
    'people.staff.exit',
    'payroll.run.prepare',
  ]);
  office = await actor(['payroll.run.prepare']);
  principal = await actor(['payroll.run.approve']);
  clerk = await actor(['people.staff.read']);
  const hire = (name: string, phone: string) =>
    createStaff(people, owner, {
      institutionId: t.institutionId,
      name,
      phone,
      joinedOn: '2019-04-01',
    });
  leaver = await hire('Synthetic Leaving Teacher', '+919000000611');
  noSalary = await hire('Synthetic Unsalaried Clerk', '+919000000612');
  await setSalary(deps, owner, {
    basic: 15_000 * R,
    da: 3_000 * R,
    hra: 6_000 * R,
    conveyance: 0,
    special: 6_000 * R,
    other: 0,
    pf: true,
    esi: false,
    pt: true,
    tdsPaise: 0,
    otherDeductionPaise: 0,
    institutionId: t.institutionId,
    personId: leaver,
    effectiveFrom: ist(-60),
  });
  for (const id of [leaver, noSalary])
    await exitStaff(people, owner, id, { lastDay, reason: 'Resigned to move city' });
});
afterAll(() => close());

describe('final settlement', () => {
  it('lists each leaver with what they are owed and the two-working-day deadline', async () => {
    const rows = await settlements(deps, office, t.institutionId);
    const row = rows.find((r) => r.personId === leaver)!;
    expect(row).toMatchObject({
      state: 'to_prepare',
      lastDay,
      dueOn: addWorkingDays(lastDay, 2, new Set()),
      overdue: true,
      fixedTerm: false,
    });
    // Seven years and more of service: gratuity on ₹18,000 basic + DA.
    expect(row.figures?.gratuityWagesPaise).toBe(18_000 * R);
    expect(row.figures?.gratuityYears).toBeGreaterThanOrEqual(7);
    expect(row.figures?.gratuityPaise).toBeGreaterThan(0);
    expect(rows.find((r) => r.personId === noSalary)?.figures).toBeNull();
    await expect(settlements(deps, clerk, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });

  it('is prepared by one person, approved by another, and paid with a reference', async () => {
    await expect(
      prepareSettlement(deps, office, { institutionId: t.institutionId, personId: noSalary }),
    ).rejects.toMatchObject({ code: 'no_salary' });
    await expect(
      prepareSettlement(deps, office, { institutionId: t.institutionId, personId: t.studentId }),
    ).rejects.toMatchObject({ code: 'not_a_leaver' });
    const id = await prepareSettlement(deps, office, {
      institutionId: t.institutionId,
      personId: leaver,
    });
    let row = (await settlements(deps, office, t.institutionId)).find((r) => r.id === id)!;
    expect(row).toMatchObject({ state: 'prepared', approval: { status: 'pending', mine: false } });
    await expect(
      markSettlementPaid(deps, office, { settlementId: id, paidOn: ist(0), reference: 'NEFT123' }),
    ).rejects.toMatchObject({ code: 'not_approved' });
    await expect(
      decideSettlement(deps, office, { settlementId: id, approve: true, note: null }),
    ).rejects.toMatchObject({ code: 'own_request' });
    expect(
      await decideSettlement(deps, principal, { settlementId: id, approve: true, note: null }),
    ).toBe('approved');
    await expect(
      markSettlementPaid(deps, office, {
        settlementId: id,
        paidOn: ist(-30),
        reference: 'NEFT123',
      }),
    ).rejects.toMatchObject({ code: 'paid_date' });
    await markSettlementPaid(deps, office, {
      settlementId: id,
      paidOn: ist(0),
      reference: 'NEFT/SYN/0001',
    });
    row = (await settlements(deps, office, t.institutionId)).find((r) => r.id === id)!;
    // Paid today, after the deadline: on record as late, no longer overdue.
    expect(row).toMatchObject({
      state: 'paid',
      overdue: false,
      paidLate: true,
      reference: 'NEFT/SYN/0001',
    });
    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ detail: { late: boolean } }>(sql`
        select detail from audit_event where action = 'payroll.settlement.paid' and entity_id = ${leaver}`),
    );
    expect(audit?.detail.late).toBe(true);
  });
});
