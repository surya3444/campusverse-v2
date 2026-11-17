// TDS on salaries (rule book §13.7 "TDS (24Q), Form 16"): challans recorded against salary months,
// the quarter's deductions linked to them, what still stops the 24Q statement, the worksheet with
// full PANs (audited), and each employee's Form 16 Part B figures. All data synthetic.
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { updateStaff } from '@campusverse/people-records';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteTdsChallan,
  form16Figures,
  recordTdsChallan,
  tdsQuarter,
  type PayrollDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const keys = parseFieldKeys(env.FIELD_KEYS);
const deps: PayrollDeps = { db, permissions, holidays: async () => [], keys };

let t: SeededTenant;
let office: Actor;
let principal: Actor;
let clerk: Actor;
const q = (query: ReturnType<typeof sql>) => withTenant(db, t.orgId, (tx) => tx.execute(query));

/** An approved (or paid) run for a 2025-26 month with the teacher's slip: ₹50,000 gross, ₹2,500 TDS. */
async function run(month: string, paidOn: string | null) {
  const first = `${month}-01`;
  await q(sql`
    with s as (
      insert into payroll_salary (org_id, institution_id, person_id, effective_from, basic_paise, set_by_person_id)
      values (app_current_org(), ${t.institutionId}, ${t.teacherId}, ${first}::date, 5000000, ${office.personId})
      returning id),
    r as (
      insert into payroll_run (org_id, institution_id, month, attendance_through, prepared_by_person_id)
      values (app_current_org(), ${t.institutionId}, ${first}::date,
        (${first}::date + interval '1 month - 1 day')::date, ${office.personId})
      returning id)
    insert into payroll_slip (org_id, run_id, person_id, salary_id, snapshot, calendar_days, lop_halves,
      basic_paise, da_paise, hra_paise, conveyance_paise, special_paise, other_paise, gross_paise, pf_paise,
      esi_paise, pt_paise, tds_paise, other_deduction_paise, net_paise, employer_pf_paise, employer_esi_paise)
    select app_current_org(), r.id, ${t.teacherId}, s.id, '{"name":"Synthetic Teacher","employeeCode":"EMP-1"}'::jsonb,
      30, 0, 5000000, 0, 0, 0, 0, 0, 5000000, 180000, 0, 20000, 250000, 0, 4550000, 180000, 0
    from r, s`);
  // Frozen slips: the run is approved (and paid) only after its slips are in.
  await q(sql`
    update payroll_run set state = 'approved', approved_by_person_id = ${principal.personId}, approved_at = now()
    where org_id = app_current_org() and institution_id = ${t.institutionId} and month = ${first}::date`);
  if (paidOn) await pay(month, paidOn);
}
const pay = (month: string, paidOn: string) =>
  q(sql`
    update payroll_run set state = 'paid', paid_on = ${paidOn}::date, payment_mode = 'bank'
    where org_id = app_current_org() and institution_id = ${t.institutionId} and month = ${`${month}-01`}::date`);

beforeAll(async () => {
  t = await seedTenant(db, 'Tds');
  const actor = async (grants: string[]): Promise<Actor> => ({
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, grants),
  });
  office = await actor(['payroll.run.prepare', 'people.staff.update']);
  principal = await actor(['payroll.run.approve']);
  clerk = await actor(['people.staff.read']);
  await run('2025-04', '2025-04-30');
  await run('2025-05', '2025-05-31');
  await run('2025-06', null);
});
afterAll(() => close());

describe('TDS on salaries', () => {
  it('shows what still stops the 24Q: TAN, unpaid months, deposits and PANs', async () => {
    await expect(
      tdsQuarter(deps, clerk, { institutionId: t.institutionId, fy: 2025, quarter: 1 }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      tdsQuarter(deps, office, { institutionId: t.institutionId, fy: 2025, quarter: 5 }),
    ).rejects.toMatchObject({ code: 'bad_quarter' });
    const r = await tdsQuarter(deps, principal, {
      institutionId: t.institutionId,
      fy: 2025,
      quarter: 1,
    });
    expect(r).toMatchObject({ tan: null, deductees: 1, ready: false, statementDue: '2025-07-31' });
    expect(r.months.map((m) => [m.month, m.run?.state, m.deductedPaise, m.depositDue])).toEqual([
      ['2025-04', 'paid', 250000, '2025-05-07'],
      ['2025-05', 'paid', 250000, '2025-06-07'],
      ['2025-06', 'approved', 250000, '2025-07-07'],
    ]);
    expect(r.unlinked).toHaveLength(3);
    expect(r.withoutPan.map((p) => p.personId)).toEqual([t.teacherId]);
    expect(r.file).toBeNull();
  });

  it('records challans (one per bank receipt), flags late ones, and links deductions to them', async () => {
    const challan = (month: string, serial: string, depositedOn: string, amountPaise = 250000) =>
      recordTdsChallan(deps, office, {
        institutionId: t.institutionId,
        month,
        bsrCode: '0510001',
        challanSerial: serial,
        depositedOn,
        amountPaise,
      });
    await expect(challan('2025-04', '1', '2025-05-05')).rejects.toMatchObject({
      code: 'challan_invalid',
    });
    await expect(challan('2025-04', '00011', '2025-03-31')).rejects.toMatchObject({
      code: 'challan_invalid',
    });
    await expect(
      recordTdsChallan(deps, principal, {
        institutionId: t.institutionId,
        month: '2025-04',
        bsrCode: '0510001',
        challanSerial: '00011',
        depositedOn: '2025-05-05',
        amountPaise: 250000,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await challan('2025-04', '00011', '2025-05-05');
    await expect(challan('2025-04', '00011', '2025-05-05')).rejects.toMatchObject({
      code: 'challan_duplicate',
    });
    const wrong = await challan('2025-05', '00012', '2025-06-20', 100);
    await deleteTdsChallan(deps, office, wrong.id);
    await challan('2025-05', '00013', '2025-06-20');
    await challan('2025-06', '00014', '2025-07-04');
    const r = await tdsQuarter(deps, office, {
      institutionId: t.institutionId,
      fy: 2025,
      quarter: 1,
    });
    expect(r.months.map((m) => m.challans.map((c) => [c.challanSerial, c.late]))).toEqual([
      [['00011', false]],
      [['00013', true]],
      [['00014', false]],
    ]);
    expect(r.unlinked).toHaveLength(0);
    expect(r.ready).toBe(false); // no TAN, June not paid, no PAN
  });

  it('gives the worksheet with full PANs only to the preparer, and audits it', async () => {
    await updateStaff({ db, permissions, keys, placements: [] }, office, t.teacherId, {
      pan: 'ABCDE1234F',
    });
    await q(sql`update legal_entity set tan = 'BLRS12345A' where org_id = app_current_org()`);
    await pay('2025-06', '2025-06-30');
    await expect(
      tdsQuarter(deps, principal, {
        institutionId: t.institutionId,
        fy: 2025,
        quarter: 1,
        file: true,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    const r = await tdsQuarter(deps, office, {
      institutionId: t.institutionId,
      fy: 2025,
      quarter: 1,
      file: true,
    });
    expect(r).toMatchObject({ tan: 'BLRS12345A', ready: true, withoutPan: [] });
    const lines = r.file!.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      '2025-04,0510001,00011,2025-05-05,EMP-1,ABCDE1234F,Synthetic Teacher,2025-04-30,50000.00,2500.00,2500.00',
    );
    const [audit] = await q(sql`
      select count(*)::int as n from audit_event where org_id = app_current_org() and action = 'payroll.tds.statement_export'`);
    expect(audit).toMatchObject({ n: 1 });
  });

  it('adds up each employee’s Form 16 Part B figures for the year', async () => {
    const f = await form16Figures(deps, office, {
      institutionId: t.institutionId,
      fy: 2025,
      file: true,
    });
    expect(f.rows).toEqual([
      expect.objectContaining({
        personId: t.teacherId,
        from: '2025-04',
        to: '2025-06',
        grossPaise: 15000000,
        ptPaise: 60000,
        pfPaise: 540000,
        tdsByQuarter: [750000, 0, 0, 0],
        tdsPaise: 750000,
      }),
    ]);
    expect(f.file!.split('\n')[1]).toContain(
      'EMP-1,ABCDE1234F,Synthetic Teacher,2025-04,2025-06,150000.00',
    );
  });
});
