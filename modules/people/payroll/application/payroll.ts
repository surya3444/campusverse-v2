// Payroll, step 1 (docs/specs/PAYROLL.md): dated salaries, a month's run from loss of pay (staff
// attendance's payroll inputs), approval by a second person, marking paid, and payslips.
import type { FieldKeys } from '@campusverse/crypto';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { memberKind } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { payrollRulesAt } from '@campusverse/platform-rulepacks';
import { payrollInputsIn, type HolidaysPort } from '@campusverse/shared-staff-attendance';
import { sql } from 'drizzle-orm';
import {
  EARNINGS,
  arrearsFor,
  computeSlip,
  type ArrearsDelta,
  monthBounds,
  monthlyGross,
  type Earning,
  type Salary,
  type Slip,
} from '../domain/pay.js';

type Permissions = ReturnType<typeof createPermissions>;
/** `keys`: the field keys, to open staff PANs for the TDS statement (24Q) and Form 16 figures. */
export type PayrollDeps = {
  db: Db;
  permissions: Permissions;
  holidays: HolidaysPort;
  keys?: FieldKeys | undefined;
};

export const PAYROLL_RUN_APPROVED = 'payroll.run.approved.v1';
export const PAYROLL_RUN_PAID = 'payroll.run.paid.v1';

export class PayrollError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'not_staff'
      | 'bad_month'
      | 'run_not_found'
      | 'not_draft'
      | 'not_approved'
      | 'own_run'
      | 'nobody_to_pay'
      | 'future_month'
      | 'not_a_leaver'
      | 'no_salary'
      | 'settlement_not_found'
      | 'not_prepared'
      | 'paid_date'
      | 'challan_invalid'
      | 'challan_duplicate'
      | 'challan_not_found'
      | 'bad_quarter',
  ) {
    super(`payroll: ${code}`);
    this.name = 'PayrollError';
  }
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new PayrollError('institution_not_found');
  return p;
}
export const res = (
  actor: Actor,
  p: { campusId: string; institutionId: string },
  subject?: string,
) => ({
  orgId: actor.orgId,
  place: p,
  ...(subject ? { subjectPersonId: subject } : {}),
});

async function canAny(
  deps: PayrollDeps,
  tx: Tx,
  actor: Actor,
  p: { campusId: string; institutionId: string },
  permissions: string[],
) {
  for (const perm of permissions)
    if ((await deps.permissions.can(tx, actor, perm, res(actor, p))).allowed) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Salaries
// ---------------------------------------------------------------------------------------------

export type SalaryInput = Salary & {
  institutionId: string;
  personId: string;
  effectiveFrom: string;
};

export type SalaryRow = Salary & {
  id: string;
  personId: string;
  effectiveFrom: string;
  setBy: string;
  createdAt: string;
};

const salarySelect = sql`
  select s.id::text, s.person_id::text as "personId", s.effective_from::text as "effectiveFrom",
    s.basic_paise::text as basic, s.da_paise::text as da, s.hra_paise::text as hra,
    s.conveyance_paise::text as conveyance, s.special_paise::text as special, s.other_paise::text as other,
    s.pf, s.esi, s.pt, s.tds_paise::text as "tdsPaise", s.other_deduction_paise::text as "otherDeductionPaise",
    s.set_by_person_id::text as "setBy", s.created_at::text as "createdAt"
  from payroll_salary s`;

type RawSalary = Omit<SalaryRow, Earning | 'tdsPaise' | 'otherDeductionPaise'> &
  Record<Earning | 'tdsPaise' | 'otherDeductionPaise', string>;
const toSalary = (r: RawSalary): SalaryRow =>
  ({
    ...r,
    ...Object.fromEntries(EARNINGS.map((k) => [k, Number(r[k])])),
    tdsPaise: Number(r.tdsPaise),
    otherDeductionPaise: Number(r.otherDeductionPaise),
  }) as unknown as SalaryRow;

/** The salary in force on a date for each person (the latest effective on or before it). */
export async function salariesOn(tx: Tx, institutionId: string, onDate: string) {
  const rows = await tx.execute<RawSalary>(sql`
    ${salarySelect}
    where s.org_id = app_current_org() and s.institution_id = ${institutionId}
      and s.effective_from <= ${onDate}::date
      and not exists (select 1 from payroll_salary n where n.org_id = s.org_id
        and n.institution_id = s.institution_id and n.person_id = s.person_id
        and n.effective_from <= ${onDate}::date and n.effective_from > s.effective_from)`);
  return new Map(rows.map((r) => [r.personId, toSalary(r)]));
}

/** Sets a staff member's salary from a date. A change is a new row; history stays. */
export async function setSalary(
  deps: PayrollDeps,
  actor: Actor,
  input: SalaryInput,
): Promise<{ id: string }> {
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.salary.manage', resource: res(actor, p) },
    async (tx) => {
      if (
        (await memberKind(tx, {
          institutionId: input.institutionId,
          personId: input.personId,
          onDate: input.effectiveFrom,
        })) !== 'staff'
      ) {
        // Joining later than the salary's date is fine if they're staff today.
        const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
        if (
          (await memberKind(tx, {
            institutionId: input.institutionId,
            personId: input.personId,
            onDate: d?.d ?? '',
          })) !== 'staff'
        )
          throw new PayrollError('not_staff');
      }
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into payroll_salary (org_id, institution_id, person_id, effective_from, basic_paise, da_paise,
          hra_paise, conveyance_paise, special_paise, other_paise, pf, esi, pt, tds_paise, other_deduction_paise,
          set_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.personId}, ${input.effectiveFrom}::date,
          ${input.basic}, ${input.da}, ${input.hra}, ${input.conveyance}, ${input.special}, ${input.other},
          ${input.pf}, ${input.esi}, ${input.pt}, ${input.tdsPaise}, ${input.otherDeductionPaise}, ${actor.personId})
        on conflict (org_id, institution_id, person_id, effective_from) do nothing
        returning id::text`);
      // Same date again: a correction replaces that row's figures (no slip uses it yet, or it's refused).
      const id =
        row?.id ??
        (
          await tx.execute<{ id: string }>(sql`
            select id::text from payroll_salary where org_id = app_current_org()
              and institution_id = ${input.institutionId} and person_id = ${input.personId}
              and effective_from = ${input.effectiveFrom}::date`)
        )[0]?.id ??
        '';
      if (!row) {
        const [used] = await tx.execute(sql`
          select 1 from payroll_slip sl join payroll_run r on r.org_id = sl.org_id and r.id = sl.run_id
          where sl.org_id = app_current_org() and sl.salary_id = ${id} and r.state <> 'draft'`);
        if (used) throw new PayrollError('not_draft');
        await tx.execute(sql`
          delete from payroll_slip where org_id = app_current_org() and salary_id = ${id}`);
        await tx.execute(sql`
          update payroll_salary set basic_paise = ${input.basic}, da_paise = ${input.da}, hra_paise = ${input.hra},
            conveyance_paise = ${input.conveyance}, special_paise = ${input.special}, other_paise = ${input.other},
            pf = ${input.pf}, esi = ${input.esi}, pt = ${input.pt}, tds_paise = ${input.tdsPaise},
            other_deduction_paise = ${input.otherDeductionPaise}, set_by_person_id = ${actor.personId}
          where org_id = app_current_org() and id = ${id}`);
      }
      return {
        result: { id },
        audit: {
          action: 'payroll.salary.set',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'sensitive',
          detail: {
            institutionId: input.institutionId,
            effectiveFrom: input.effectiveFrom,
            grossPaise: monthlyGross(input),
            corrected: !row,
          },
        },
      };
    },
  );
}

export type StaffSalary = {
  personId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  salary: SalaryRow | null;
  /** A full month on the current salary, for the list. */
  estimate: { grossPaise: number; netPaise: number } | null;
};

/** Every staff member today with their current salary. */
export async function salaries(
  deps: PayrollDeps,
  actor: Actor,
  institutionId: string,
): Promise<StaffSalary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, institutionId);
    await deps.permissions.assertCan(tx, actor, 'payroll.salary.manage', res(actor, p));
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = d?.d ?? '';
    const rules = await payrollRulesAt(tx, institutionId, today);
    const month = Number(today.slice(5, 7));
    const current = await salariesOn(tx, institutionId, today);
    const inputs = await payrollInputsIn(tx, deps.holidays, institutionId, today.slice(0, 7));
    return inputs.staff.map((s) => {
      const salary = current.get(s.personId) ?? null;
      const slip = salary
        ? computeSlip({ salary, rules, calendarDays: 30, lopHalves: 0, month })
        : null;
      return {
        personId: s.personId,
        name: s.name,
        employeeCode: s.employeeCode,
        designation: s.designation,
        salary,
        estimate: slip ? { grossPaise: slip.gross, netPaise: slip.net } : null,
      };
    });
  });
}

/** One person's salary history, newest first (`manage`, or the person themselves). */
export async function salaryHistory(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<SalaryRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, input.institutionId);
    const self = actor.personId === input.personId;
    await deps.permissions.assertCan(
      tx,
      actor,
      self ? 'payroll.slip.self' : 'payroll.salary.manage',
      res(actor, p, self ? input.personId : undefined),
    );
    const rows = await tx.execute<RawSalary>(sql`
      ${salarySelect}
      where s.org_id = app_current_org() and s.institution_id = ${input.institutionId}
        and s.person_id = ${input.personId}
      order by s.effective_from desc`);
    return rows.map(toSalary);
  });
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export type SlipRow = Slip & {
  personId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  /** Earlier months whose back pay this slip includes ("2026-09"). */
  arrearsMonths: string[];
};

export type RunPreview = {
  month: string;
  attendanceThrough: string;
  slips: SlipRow[];
  /** Staff without a salary in force: skipped. */
  noSalary: { personId: string; name: string; employeeCode: string }[];
  totals: { grossPaise: number; deductionsPaise: number; netPaise: number; employerPaise: number };
};

type ArrearsMonth = { month: string; salaryId: string; delta: ArrearsDelta };

/**
 * Back pay due to each person for the 12 months before `month` (rule book §13.7 Assignments &
 * Arrears): each approved month recomputed on the salary now in force for it, less its slip and
 * any arrears already paid for it in approved runs.
 */
async function arrearsDue(
  tx: Tx,
  institutionId: string,
  month: string,
  personIds: string[],
): Promise<Map<string, ArrearsMonth[]>> {
  const out = new Map<string, ArrearsMonth[]>();
  if (personIds.length === 0) return out;
  const prior = await tx.execute<{
    personId: string;
    month: string;
    salaryId: string;
    calendarDays: number;
    lopHalves: number;
    gross: string;
    pf: string;
    employerPf: string;
    esi: string;
    employerEsi: string;
  }>(sql`
    select sl.person_id::text as "personId", to_char(r.month, 'YYYY-MM') as month, sl.salary_id::text as "salaryId",
      sl.calendar_days as "calendarDays", sl.lop_halves as "lopHalves",
      (sl.gross_paise - sl.arrears_paise + coalesce(a.gross, 0))::text as gross,
      (sl.pf_paise - coalesce(own.pf, 0) + coalesce(a.pf, 0))::text as pf,
      (sl.employer_pf_paise - coalesce(own.employer_pf, 0) + coalesce(a.employer_pf, 0))::text as "employerPf",
      (sl.esi_paise - coalesce(own.esi, 0) + coalesce(a.esi, 0))::text as esi,
      (sl.employer_esi_paise - coalesce(own.employer_esi, 0) + coalesce(a.employer_esi, 0))::text as "employerEsi"
    from payroll_slip sl
    join payroll_run r on r.org_id = sl.org_id and r.id = sl.run_id
    -- Arrears this slip itself paid for earlier months: not part of its own month's pay.
    left join lateral (
      select sum(pa.pf_paise) as pf, sum(pa.employer_pf_paise) as employer_pf, sum(pa.esi_paise) as esi,
        sum(pa.employer_esi_paise) as employer_esi
      from payroll_arrear pa where pa.org_id = sl.org_id and pa.run_id = sl.run_id and pa.person_id = sl.person_id
    ) own on true
    -- Arrears later approved runs paid for this month.
    left join lateral (
      select sum(pa.gross_paise) as gross, sum(pa.pf_paise) as pf, sum(pa.employer_pf_paise) as employer_pf,
        sum(pa.esi_paise) as esi, sum(pa.employer_esi_paise) as employer_esi
      from payroll_arrear pa join payroll_run pr on pr.org_id = pa.org_id and pr.id = pa.run_id
      where pa.org_id = sl.org_id and pa.person_id = sl.person_id and pa.for_month = r.month
        and pr.state in ('approved', 'paid')
    ) a on true
    where sl.org_id = app_current_org() and r.institution_id = ${institutionId}
      and r.state in ('approved', 'paid')
      and sl.person_id = any(${`{${personIds.join(',')}}`}::uuid[])
      and r.month < ${`${month}-01`}::date and r.month >= (${`${month}-01`}::date - interval '12 months')
    order by r.month`);
  const salaryCache = new Map<string, Awaited<ReturnType<typeof salariesOn>>>();
  for (const p of prior) {
    const { last } = monthBounds(p.month);
    if (!salaryCache.has(last)) salaryCache.set(last, await salariesOn(tx, institutionId, last));
    const now = salaryCache.get(last)?.get(p.personId);
    if (!now || now.id === p.salaryId) continue;
    const delta = arrearsFor({
      salary: now,
      rules: await payrollRulesAt(tx, institutionId, last),
      calendarDays: p.calendarDays,
      lopHalves: p.lopHalves,
      month: Number(p.month.slice(5)),
      paid: {
        gross: Number(p.gross),
        pf: Number(p.pf),
        employerPf: Number(p.employerPf),
        esi: Number(p.esi),
        employerEsi: Number(p.employerEsi),
      },
    });
    if (!delta) continue;
    out.set(p.personId, [
      ...(out.get(p.personId) ?? []),
      { month: p.month, salaryId: now.id, delta },
    ]);
  }
  return out;
}

const sumArrears = (ms: ArrearsMonth[]): ArrearsDelta | undefined =>
  ms.length === 0
    ? undefined
    : ms.reduce(
        (t, m) => ({
          gross: t.gross + m.delta.gross,
          pf: t.pf + m.delta.pf,
          employerPf: t.employerPf + m.delta.employerPf,
          esi: t.esi + m.delta.esi,
          employerEsi: t.employerEsi + m.delta.employerEsi,
        }),
        { gross: 0, pf: 0, employerPf: 0, esi: 0, employerEsi: 0 },
      );

async function computeRun(
  tx: Tx,
  deps: PayrollDeps,
  institutionId: string,
  month: string,
): Promise<RunPreview & { salaryIds: Map<string, string>; arrears: Map<string, ArrearsMonth[]> }> {
  if (!MONTH.test(month)) throw new PayrollError('bad_month');
  const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  if (`${month}-01` > (d?.d ?? '')) throw new PayrollError('future_month');
  const { last, days } = monthBounds(month);
  const rules = await payrollRulesAt(tx, institutionId, last);
  const inputs = await payrollInputsIn(tx, deps.holidays, institutionId, month);
  const pay = await salariesOn(tx, institutionId, last);
  const arrears = await arrearsDue(
    tx,
    institutionId,
    month,
    inputs.staff.map((x) => x.personId),
  );
  const slips: SlipRow[] = [];
  const noSalary: RunPreview['noSalary'] = [];
  const salaryIds = new Map<string, string>();
  for (const s of inputs.staff) {
    const salary = pay.get(s.personId);
    if (!salary) {
      noSalary.push({ personId: s.personId, name: s.name, employeeCode: s.employeeCode });
      continue;
    }
    salaryIds.set(s.personId, salary.id);
    // Loss of pay in half days (staff attendance counts in halves).
    const lopHalves = Math.round(s.row.lossOfPay * 2);
    slips.push({
      personId: s.personId,
      name: s.name,
      employeeCode: s.employeeCode,
      designation: s.designation,
      ...computeSlip({
        salary,
        rules,
        calendarDays: days,
        lopHalves,
        month: Number(month.slice(5)),
        arrears: sumArrears(arrears.get(s.personId) ?? []),
      }),
      arrearsMonths: (arrears.get(s.personId) ?? []).map((m) => m.month),
    });
  }
  const sum = (f: (x: SlipRow) => number) => slips.reduce((a, x) => a + f(x), 0);
  return {
    month,
    attendanceThrough: inputs.through,
    slips,
    noSalary,
    salaryIds,
    arrears,
    totals: {
      grossPaise: sum((x) => x.gross),
      deductionsPaise: sum((x) => x.gross - x.net),
      netPaise: sum((x) => x.net),
      employerPaise: sum((x) => x.employerPf + x.employerEsi + x.employerLwf),
    },
  };
}

/** What preparing a month would do. Writes nothing. */
export async function previewRun(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; month: string },
): Promise<RunPreview> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, input.institutionId);
    await deps.permissions.assertCan(tx, actor, 'payroll.run.prepare', res(actor, p));
    const run = await computeRun(tx, deps, input.institutionId, input.month);
    return {
      month: run.month,
      attendanceThrough: run.attendanceThrough,
      slips: run.slips,
      noSalary: run.noSalary,
      totals: run.totals,
    };
  });
}

/** Prepares (or recomputes) the month's draft run with its slips. */
export async function prepareRun(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; month: string },
): Promise<{ runId: string; slips: number; netPaise: number }> {
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p) },
    async (tx) => {
      const run = await computeRun(tx, deps, input.institutionId, input.month);
      if (run.slips.length === 0) throw new PayrollError('nobody_to_pay');
      const first = `${input.month}-01`;
      const [existing] = await tx.execute<{ id: string; state: string }>(sql`
        select id::text, state from payroll_run where org_id = app_current_org()
          and institution_id = ${input.institutionId} and month = ${first}::date for update`);
      if (existing && existing.state !== 'draft') throw new PayrollError('not_draft');
      let runId = existing?.id ?? '';
      if (existing) {
        await tx.execute(
          sql`delete from payroll_slip where org_id = app_current_org() and run_id = ${runId}`,
        );
        await tx.execute(sql`
          update payroll_run set attendance_through = ${run.attendanceThrough}::date,
            prepared_by_person_id = ${actor.personId}, prepared_at = now()
          where org_id = app_current_org() and id = ${runId}`);
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into payroll_run (org_id, institution_id, month, attendance_through, prepared_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${first}::date, ${run.attendanceThrough}::date,
            ${actor.personId})
          returning id::text`);
        runId = row?.id ?? '';
      }
      for (const s of run.slips) {
        const e = s.earnings;
        await tx.execute(sql`
          insert into payroll_slip (org_id, run_id, person_id, salary_id, snapshot, calendar_days, lop_halves,
            basic_paise, da_paise, hra_paise, conveyance_paise, special_paise, other_paise, gross_paise,
            pf_paise, esi_paise, pt_paise, tds_paise, other_deduction_paise, net_paise,
            employer_pf_paise, employer_esi_paise, arrears_paise, lwf_paise, employer_lwf_paise)
          values (app_current_org(), ${runId}, ${s.personId}, ${run.salaryIds.get(s.personId) ?? null},
            ${JSON.stringify({ name: s.name, employeeCode: s.employeeCode, designation: s.designation, capped: s.capped, arrearsMonths: s.arrearsMonths })}::jsonb,
            ${s.calendarDays}, ${s.lopHalves}, ${e.basic}, ${e.da}, ${e.hra}, ${e.conveyance}, ${e.special}, ${e.other},
            ${s.gross}, ${s.pf}, ${s.esi}, ${s.pt}, ${s.tds}, ${s.otherDeduction}, ${s.net},
            ${s.employerPf}, ${s.employerEsi}, ${s.arrears}, ${s.lwf}, ${s.employerLwf})`);
        for (const a of run.arrears.get(s.personId) ?? [])
          await tx.execute(sql`
            insert into payroll_arrear (org_id, run_id, person_id, for_month, salary_id, gross_paise, pf_paise,
              employer_pf_paise, esi_paise, employer_esi_paise)
            values (app_current_org(), ${runId}, ${s.personId}, ${`${a.month}-01`}::date, ${a.salaryId},
              ${a.delta.gross}, ${a.delta.pf}, ${a.delta.employerPf}, ${a.delta.esi}, ${a.delta.employerEsi})`);
      }
      return {
        result: { runId, slips: run.slips.length, netPaise: run.totals.netPaise },
        audit: {
          action: existing ? 'payroll.run.recompute' : 'payroll.run.prepare',
          entityType: 'payroll_run',
          entityId: runId,
          dataClass: 'sensitive',
          detail: {
            month: input.month,
            slips: run.slips.length,
            noSalary: run.noSalary.length,
            netPaise: run.totals.netPaise,
          },
        },
      };
    },
  );
}

async function loadRun(tx: Tx, runId: string) {
  const [r] = await tx.execute<{
    id: string;
    institutionId: string;
    month: string;
    state: 'draft' | 'approved' | 'paid';
    preparedBy: string;
  }>(sql`
    select id::text, institution_id::text as "institutionId", to_char(month, 'YYYY-MM') as month, state,
      prepared_by_person_id::text as "preparedBy"
    from payroll_run where org_id = app_current_org() and id = ${runId} for update`);
  if (!r) throw new PayrollError('run_not_found');
  return r;
}

/** A second person approves a draft; the slips are frozen from then on. */
export async function approveRun(deps: PayrollDeps, actor: Actor, runId: string): Promise<void> {
  const p = await withTenant(deps.db, actor.orgId, async (tx) =>
    place(tx, (await loadRun(tx, runId)).institutionId),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.approve', resource: res(actor, p) },
    async (tx) => {
      const r = await loadRun(tx, runId);
      if (r.state !== 'draft') throw new PayrollError('not_draft');
      if (r.preparedBy === actor.personId) throw new PayrollError('own_run');
      await tx.execute(sql`
        update payroll_run set state = 'approved', approved_by_person_id = ${actor.personId}, approved_at = now()
        where org_id = app_current_org() and id = ${runId}`);
      return {
        result: undefined,
        audit: {
          action: 'payroll.run.approve',
          entityType: 'payroll_run',
          entityId: runId,
          dataClass: 'sensitive',
          detail: { month: r.month },
        },
        events: [
          {
            type: PAYROLL_RUN_APPROVED,
            payload: { runId, institutionId: r.institutionId, month: r.month },
          },
        ],
      };
    },
  );
}

/** Records that an approved run was paid: the date, how, and a reference. */
export async function markRunPaid(
  deps: PayrollDeps,
  actor: Actor,
  input: {
    runId: string;
    paidOn: string;
    mode: 'bank' | 'cash' | 'cheque';
    reference: string | null;
  },
): Promise<void> {
  const p = await withTenant(deps.db, actor.orgId, async (tx) =>
    place(tx, (await loadRun(tx, input.runId)).institutionId),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p) },
    async (tx) => {
      const r = await loadRun(tx, input.runId);
      if (r.state !== 'approved') throw new PayrollError('not_approved');
      await tx.execute(sql`
        update payroll_run set state = 'paid', paid_on = ${input.paidOn}::date, payment_mode = ${input.mode},
          payment_ref = ${input.reference?.trim() || null}
        where org_id = app_current_org() and id = ${input.runId}`);
      return {
        result: undefined,
        audit: {
          action: 'payroll.run.pay',
          entityType: 'payroll_run',
          entityId: input.runId,
          dataClass: 'sensitive',
          detail: { month: r.month, paidOn: input.paidOn, mode: input.mode },
        },
        events: [
          {
            type: PAYROLL_RUN_PAID,
            payload: { runId: input.runId, institutionId: r.institutionId, month: r.month },
          },
        ],
      };
    },
  );
}

export type RunSummary = {
  runId: string;
  month: string;
  state: 'draft' | 'approved' | 'paid';
  slips: number;
  grossPaise: number;
  netPaise: number;
  preparedBy: string;
  approvedBy: string | null;
  paidOn: string | null;
  attendanceThrough: string;
};

const runSelect = sql`
  select r.id::text as "runId", to_char(r.month, 'YYYY-MM') as month, r.state,
    (select count(*) from payroll_slip where org_id = r.org_id and run_id = r.id)::int as slips,
    coalesce((select sum(gross_paise) from payroll_slip where org_id = r.org_id and run_id = r.id), 0)::text as "grossPaise",
    coalesce((select sum(net_paise) from payroll_slip where org_id = r.org_id and run_id = r.id), 0)::text as "netPaise",
    r.prepared_by_person_id::text as "preparedBy", r.approved_by_person_id::text as "approvedBy",
    r.paid_on::text as "paidOn", r.attendance_through::text as "attendanceThrough"
  from payroll_run r`;
type RawRun = Omit<RunSummary, 'grossPaise' | 'netPaise'> & {
  grossPaise: string;
  netPaise: string;
};
const toRun = (r: RawRun): RunSummary => ({
  ...r,
  grossPaise: Number(r.grossPaise),
  netPaise: Number(r.netPaise),
});

/** The school's runs, newest first (people who prepare or approve). */
export async function runs(
  deps: PayrollDeps,
  actor: Actor,
  institutionId: string,
): Promise<RunSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, institutionId);
    if (!(await canAny(deps, tx, actor, p, ['payroll.run.prepare', 'payroll.run.approve'])))
      await deps.permissions.assertCan(tx, actor, 'payroll.run.prepare', res(actor, p));
    const rows = await tx.execute<RawRun>(sql`
      ${runSelect} where r.org_id = app_current_org() and r.institution_id = ${institutionId}
      order by r.month desc limit 36`);
    return rows.map(toRun);
  });
}

export type StoredSlip = SlipRow & { runId: string; month: string; state: RunSummary['state'] };

const slipSelect = sql`
  select sl.run_id::text as "runId", to_char(r.month, 'YYYY-MM') as month, r.state,
    sl.person_id::text as "personId", sl.snapshot ->> 'name' as name,
    sl.snapshot ->> 'employeeCode' as "employeeCode", sl.snapshot ->> 'designation' as designation,
    coalesce((sl.snapshot ->> 'capped')::boolean, false) as capped,
    sl.calendar_days as "calendarDays", sl.lop_halves as "lopHalves",
    sl.calendar_days * 2 - sl.lop_halves as "paidHalves",
    json_build_object('basic', sl.basic_paise, 'da', sl.da_paise, 'hra', sl.hra_paise,
      'conveyance', sl.conveyance_paise, 'special', sl.special_paise, 'other', sl.other_paise) as earnings,
    sl.gross_paise::text as gross, sl.pf_paise::text as pf, sl.esi_paise::text as esi, sl.pt_paise::text as pt,
    sl.tds_paise::text as tds, sl.other_deduction_paise::text as "otherDeduction", sl.net_paise::text as net,
    sl.employer_pf_paise::text as "employerPf", sl.employer_esi_paise::text as "employerEsi",
    sl.arrears_paise::text as arrears, sl.lwf_paise::text as lwf, sl.employer_lwf_paise::text as "employerLwf",
    coalesce(sl.snapshot -> 'arrearsMonths', '[]'::jsonb) as "arrearsMonths"
  from payroll_slip sl join payroll_run r on r.org_id = sl.org_id and r.id = sl.run_id`;
const MONEY = [
  'gross',
  'pf',
  'esi',
  'pt',
  'tds',
  'otherDeduction',
  'net',
  'employerPf',
  'employerEsi',
  'arrears',
  'lwf',
  'employerLwf',
] as const;
type RawSlip = Omit<StoredSlip, (typeof MONEY)[number] | 'earnings'> &
  Record<(typeof MONEY)[number], string> & { earnings: Record<Earning, number | string> };
const toSlip = (r: RawSlip): StoredSlip =>
  ({
    ...r,
    ...Object.fromEntries(MONEY.map((k) => [k, Number(r[k])])),
    earnings: Object.fromEntries(EARNINGS.map((k) => [k, Number(r.earnings[k])])),
  }) as unknown as StoredSlip;

/** A run with every slip (people who prepare or approve). */
export async function runDetail(
  deps: PayrollDeps,
  actor: Actor,
  runId: string,
): Promise<RunSummary & { payslips: StoredSlip[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [head] = await tx.execute<RawRun & { institutionId: string }>(sql`
      ${runSelect} where r.org_id = app_current_org() and r.id = ${runId}`);
    if (!head) throw new PayrollError('run_not_found');
    const [inst] = await tx.execute<{ id: string }>(sql`
      select institution_id::text as id from payroll_run where org_id = app_current_org() and id = ${runId}`);
    const p = await place(tx, inst?.id ?? '');
    if (!(await canAny(deps, tx, actor, p, ['payroll.run.prepare', 'payroll.run.approve'])))
      await deps.permissions.assertCan(tx, actor, 'payroll.run.prepare', res(actor, p));
    const slips = await tx.execute<RawSlip>(sql`
      ${slipSelect} where sl.org_id = app_current_org() and sl.run_id = ${runId}
      order by sl.snapshot ->> 'name'`);
    return { ...toRun(head), payslips: slips.map(toSlip) };
  });
}

/** The signed-in person's own payslips from approved and paid runs, newest first. */
export async function myPayslips(
  deps: PayrollDeps,
  actor: Actor,
  institutionId: string,
): Promise<StoredSlip[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, institutionId);
    await deps.permissions.assertCan(tx, actor, 'payroll.slip.self', res(actor, p, actor.personId));
    const rows = await tx.execute<RawSlip>(sql`
      ${slipSelect} where sl.org_id = app_current_org() and sl.person_id = ${actor.personId}
        and r.institution_id = ${institutionId} and r.state <> 'draft'
      order by r.month desc limit 24`);
    return rows.map(toSlip);
  });
}

/** One staff member's current salary and last payslip, for their staff record. */
export async function salaryCard(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<{
  grossPaise: number;
  netPaise: number;
  lastSlip: { month: string; netPaise: number } | null;
} | null> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, input.institutionId);
    await deps.permissions.assertCan(tx, actor, 'payroll.salary.manage', res(actor, p));
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const salary = (await salariesOn(tx, input.institutionId, d?.d ?? '')).get(input.personId);
    if (!salary) return null;
    const slip = computeSlip({
      salary,
      rules: await payrollRulesAt(tx, input.institutionId, d?.d ?? ''),
      calendarDays: 30,
      lopHalves: 0,
      month: Number((d?.d ?? '').slice(5, 7)),
    });
    const [last] = await tx.execute<{ month: string; net: string }>(sql`
      select to_char(r.month, 'YYYY-MM') as month, sl.net_paise::text as net
      from payroll_slip sl join payroll_run r on r.org_id = sl.org_id and r.id = sl.run_id
      where sl.org_id = app_current_org() and sl.person_id = ${input.personId} and r.state <> 'draft'
        and r.institution_id = ${input.institutionId}
      order by r.month desc limit 1`);
    return {
      grossPaise: slip.gross,
      netPaise: slip.net,
      lastSlip: last ? { month: last.month, netPaise: Number(last.net) } : null,
    };
  });
}

/** Verse AI: the latest run's state and totals, counts only (never anyone's pay). */
export async function payrollStatus(deps: PayrollDeps, actor: Actor, institutionId: string) {
  const all = await runs(deps, actor, institutionId);
  const latest = all[0];
  return latest
    ? { month: latest.month, state: latest.state, staff: latest.slips, netPaise: latest.netPaise }
    : null;
}
