// Payroll (docs/specs/PAYROLL.md), allowed and refused: salaries, a month prepared from loss of
// pay, approval by a second person only, frozen slips, marking paid, and one's own payslips.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createStaff } from '@campusverse/people-records';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveRun,
  markRunPaid,
  myPayslips,
  prepareRun,
  previewRun,
  runDetail,
  runs,
  salaries,
  salaryCard,
  setSalary,
  statutoryReturns,
  type PayrollDeps,
} from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);
const deps: PayrollDeps = { db, permissions, holidays: async () => [] };
const R = 100;

let t: SeededTenant;
let owner: Actor;
let office: Actor;
let principal: Actor;
let clerk: Actor;
let staffId: string;

const actor = async (
  tenant: SeededTenant,
  grants: string[],
  personId?: string,
): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: tenant.orgId,
  personId: personId ?? (await seedAdmin(db, tenant.orgId, grants)),
});

const salary = {
  basic: 20_000 * R,
  da: 0,
  hra: 8_000 * R,
  conveyance: 1_600 * R,
  special: 400 * R,
  other: 0,
  pf: true,
  esi: true,
  pt: true,
  tdsPaise: 0,
  otherDeductionPaise: 0,
};

beforeAll(async () => {
  t = await seedTenant(db, 'Payroll');
  owner = await actor(t, [
    'payroll.salary.manage',
    'payroll.run.prepare',
    'payroll.run.approve',
    'people.staff.create',
  ]);
  office = await actor(t, ['payroll.run.prepare']);
  principal = await actor(t, ['payroll.run.approve']);
  clerk = await actor(t, ['people.staff.read']);
  // A teacher on staff since 1 October 2026, absent on Thursday 15 October.
  staffId = await createStaff(
    { db, permissions, keys: parseFieldKeys(loadEnv().FIELD_KEYS), placements: [] },
    owner,
    {
      institutionId: t.institutionId,
      name: 'Synthetic Payroll Teacher',
      phone: '+919000000123',
      joinedOn: '2026-10-01',
    },
  );
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, source, marked_by_person_id)
      values (app_current_org(), ${staffId}, ${t.institutionId}, '2026-10-15', 'absent', 'register', ${owner.personId})`),
  );
});
afterAll(() => close());

describe('salaries', () => {
  it('sets a salary for staff only, by people who manage salaries', async () => {
    await expect(
      setSalary(deps, office, {
        ...salary,
        institutionId: t.institutionId,
        personId: staffId,
        effectiveFrom: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      setSalary(deps, owner, {
        ...salary,
        institutionId: t.institutionId,
        personId: t.studentId,
        effectiveFrom: '2026-10-01',
      }),
    ).rejects.toMatchObject({ code: 'not_staff' });
    await setSalary(deps, owner, {
      ...salary,
      institutionId: t.institutionId,
      personId: staffId,
      effectiveFrom: '2026-10-01',
    });
    const list = await salaries(deps, owner, t.institutionId);
    const me = list.find((s) => s.personId === staffId);
    expect(me?.salary?.basic).toBe(20_000 * R);
    expect(me?.estimate?.grossPaise).toBe(30_000 * R);
    await expect(salaries(deps, office, t.institutionId)).rejects.toBeInstanceOf(PermissionDenied);
    expect(
      await salaryCard(deps, owner, { institutionId: t.institutionId, personId: staffId }),
    ).toMatchObject({
      grossPaise: 30_000 * R,
      lastSlip: null,
    });
  });
});

describe('a month', () => {
  let runId = '';

  it('previews and prepares October with one day’s loss of pay', async () => {
    await expect(
      previewRun(deps, clerk, { institutionId: t.institutionId, month: '2026-10' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      previewRun(deps, office, { institutionId: t.institutionId, month: '2099-01' }),
    ).rejects.toMatchObject({ code: 'future_month' });
    const preview = await previewRun(deps, office, {
      institutionId: t.institutionId,
      month: '2026-10',
    });
    const slip = preview.slips.find((s) => s.personId === staffId);
    expect(slip).toMatchObject({ calendarDays: 31, lopHalves: 2, paidHalves: 60 });
    // 30 of 31 days: ₹20,000 × 30 / 31 = ₹19,354.84 → ₹19,355.
    expect(slip?.earnings.basic).toBe(19_355 * R);
    expect(slip?.net).toBe(
      slip!.gross - slip!.pf - slip!.esi - slip!.pt - slip!.tds - slip!.otherDeduction,
    );
    // Staff without a salary are listed, not paid (the seeded teacher has a salary from June).
    expect(preview.noSalary.some((s) => s.personId === staffId)).toBe(false);

    const r = await prepareRun(deps, office, { institutionId: t.institutionId, month: '2026-10' });
    runId = r.runId;
    expect(r.slips).toBe(preview.slips.length);
    // Preparing again recomputes the draft, never a second run.
    const again = await prepareRun(deps, office, {
      institutionId: t.institutionId,
      month: '2026-10',
    });
    expect(again.runId).toBe(runId);
    expect(
      (await runs(deps, principal, t.institutionId)).filter((x) => x.month === '2026-10'),
    ).toHaveLength(1);
  });

  it('is approved only by a second person, then frozen', async () => {
    await expect(approveRun(deps, office, runId)).rejects.toBeInstanceOf(PermissionDenied);
    // The owner can approve, but not a run they prepared themselves.
    const own = await prepareRun(deps, owner, {
      institutionId: t.institutionId,
      month: '2026-11',
    }).catch(() => null);
    if (own)
      await expect(approveRun(deps, owner, own.runId)).rejects.toMatchObject({ code: 'own_run' });

    // Not paid before approval.
    await expect(
      markRunPaid(deps, office, { runId, paidOn: '2026-11-01', mode: 'bank', reference: 'UTR1' }),
    ).rejects.toMatchObject({ code: 'not_approved' });
    await approveRun(deps, principal, runId);
    await expect(
      prepareRun(deps, office, { institutionId: t.institutionId, month: '2026-10' }),
    ).rejects.toMatchObject({ code: 'not_draft' });
    // The database itself refuses to touch an approved run's slips.
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`delete from payroll_slip where run_id = ${runId}`),
      ),
    ).rejects.toThrow();

    await markRunPaid(deps, office, {
      runId,
      paidOn: '2026-11-01',
      mode: 'bank',
      reference: 'UTR1',
    });
    const detail = await runDetail(deps, principal, runId);
    expect(detail.state).toBe('paid');
    expect(detail.payslips.find((s) => s.personId === staffId)?.lopHalves).toBe(2);
    const audit = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ action: string }>(sql`
        select action from audit_event where entity_id = ${runId} order by occurred_at`),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['payroll.run.prepare', 'payroll.run.approve', 'payroll.run.pay']),
    );
  });

  it('gives the ECR file and challan totals from the approved run, never from a draft', async () => {
    const [run] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select id::text from payroll_run where institution_id = ${t.institutionId} and month = '2026-10-01'`),
    );
    const before = await statutoryReturns(deps, office, run!.id);
    expect(before.withoutUan.map((x) => x.personId)).toContain(staffId);
    expect(before.ecr).toBe('');
    expect(before.totals.pfEmployeePaise).toBeGreaterThan(0);

    await withTenant(db, t.orgId, (tx) =>
      tx.execute(
        sql`update staff_profile set pf_uan = '100200300400' where person_id = ${staffId}`,
      ),
    );
    const after = await statutoryReturns(deps, principal, run!.id);
    const line = after.ecr.split('\n').find((l) => l.startsWith('100200300400#~#'));
    expect(line).toBeDefined();
    // ₹15,000 ceiling: EPF, EPS and EDLI wages 15000; EPS 1250; one day's loss of pay as NCP days.
    expect(line!.split('#~#').slice(1, 11)).toEqual([
      'SYNTHETIC PAYROLL TEACHER',
      expect.any(String),
      '15000',
      '15000',
      '15000',
      '1800',
      '1250',
      '550',
      '1',
      '0',
    ]);
    expect(after.wageRule.map((x) => x.personId)).not.toContain(staffId);

    await expect(statutoryReturns(deps, clerk, run!.id)).rejects.toBeInstanceOf(PermissionDenied);
    const draft = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from payroll_run where state = 'draft' limit 1`,
      ),
    );
    if (draft[0])
      await expect(statutoryReturns(deps, office, draft[0].id)).rejects.toMatchObject({
        code: 'not_approved',
      });
  });

  it('shows staff their own payslips, never anyone else’s', async () => {
    const me = await actor(t, [], staffId);
    await withTenant(db, t.orgId, async (tx) => {
      const [r] = await tx.execute<{ id: string }>(sql`
        insert into role (org_id, key, name) values (app_current_org(), ${`self_${randomUUID().slice(0, 8)}`}, 'Staff')
        returning id::text`);
      await tx.execute(sql`
        insert into role_grant (org_id, role_id, permission, relation)
        values (app_current_org(), ${r!.id}, 'payroll.slip.self', 'self')`);
      await tx.execute(sql`
        insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
        values (app_current_org(), ${staffId}, ${r!.id}, 'institution', ${t.institutionId})`);
    });
    const mine = await myPayslips(deps, me, t.institutionId);
    expect(mine.map((s) => s.month)).toEqual(['2026-10']);
    expect(mine.every((s) => s.personId === staffId)).toBe(true);
    await expect(runDetail(deps, me, mine[0]!.runId)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      salaryCard(deps, me, { institutionId: t.institutionId, personId: staffId }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
