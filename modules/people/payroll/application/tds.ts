// Payroll › Statutory, TDS on salaries (rule book §13.7 "TDS (24Q), Form 16"; §15; P0 item 14).
// The challans that deposited each month's tax; the quarter's 24Q worksheet (deductee rows
// linked to challans, for the Return Preparation Utility); and each employee's Form 16 Part B
// figures for the year. Part A of Form 16 is downloaded from TRACES; the tax computation
// (regime, declarations) is the payroll officer's until it is modelled here.
import { withTenant, type Tx } from '@campusverse/db';
import { pansForExport } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command } from '@campusverse/platform-events';
import { institutionInfo } from '@campusverse/platform-organisation';
import type { Actor } from '@campusverse/platform-permissions';
import { TDS_SALARY } from '@campusverse/rules';
import { sql } from 'drizzle-orm';
import {
  csvLine,
  depositDue,
  linkChallans,
  quarterMonths,
  rupeesText,
  statementDue,
  type Quarter,
} from '../domain/tds.js';
import { PayrollError, place, res, type PayrollDeps } from './payroll.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reading TDS needs the right to prepare or approve pay runs; writing and files, to prepare. */
async function allowed(
  deps: PayrollDeps,
  tx: Tx,
  actor: Actor,
  institutionId: string,
  write: boolean,
) {
  const r = res(actor, await place(tx, institutionId));
  if (write || !(await deps.permissions.can(tx, actor, 'payroll.run.approve', r)).allowed)
    await deps.permissions.assertCan(tx, actor, 'payroll.run.prepare', r);
}

export type TdsChallan = {
  id: string;
  month: string;
  bsrCode: string;
  challanSerial: string;
  depositedOn: string;
  amountPaise: number;
  /** Deposited after the due date (interest is due on late deposits). */
  late: boolean;
};

const challansIn = async (tx: Tx, institutionId: string, months: string[]) =>
  (
    await tx.execute<Omit<TdsChallan, 'late'>>(sql`
      select id::text, to_char(month, 'YYYY-MM') as month, bsr_code as "bsrCode",
        challan_serial as "challanSerial", deposited_on::text as "depositedOn", amount_paise::int as "amountPaise"
      from payroll_tds_challan where org_id = app_current_org() and institution_id = ${institutionId}
        and to_char(month, 'YYYY-MM') = any(${`{${months.join(',')}}`}::text[])
      order by month, deposited_on, challan_serial`)
  ).map((c) => ({ ...c, late: c.depositedOn > depositDue(c.month) }));

/** Records a TDS challan (BSR code, serial, date, amount) against a salary month. */
export async function recordTdsChallan(
  deps: PayrollDeps,
  actor: Actor,
  input: {
    institutionId: string;
    month: string;
    bsrCode: string;
    challanSerial: string;
    depositedOn: string;
    amountPaise: number;
  },
): Promise<{ id: string }> {
  if (
    !MONTH.test(input.month) ||
    !/^\d{7}$/.test(input.bsrCode) ||
    !/^\d{5}$/.test(input.challanSerial) ||
    !DATE.test(input.depositedOn) ||
    input.depositedOn < `${input.month}-01` ||
    !Number.isSafeInteger(input.amountPaise) ||
    input.amountPaise <= 0
  )
    throw new PayrollError('challan_invalid');
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p) },
    async (tx) => {
      const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
      if (input.depositedOn > (d?.d ?? '')) throw new PayrollError('challan_invalid');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into payroll_tds_challan (org_id, institution_id, month, bsr_code, challan_serial, deposited_on,
          amount_paise, recorded_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${`${input.month}-01`}::date, ${input.bsrCode},
          ${input.challanSerial}, ${input.depositedOn}::date, ${input.amountPaise}, ${actor.personId})
        on conflict do nothing returning id::text`);
      if (!row) throw new PayrollError('challan_duplicate');
      return {
        result: row,
        audit: {
          action: 'payroll.tds.challan_record',
          entityType: 'payroll_tds_challan',
          entityId: row.id,
          dataClass: 'operational',
          detail: { ...input },
        },
      };
    },
  );
}

/** Removes a wrongly entered challan (it is re-entered correctly; the audit keeps both). */
export async function deleteTdsChallan(
  deps: PayrollDeps,
  actor: Actor,
  challanId: string,
): Promise<void> {
  const p = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from payroll_tds_challan
      where org_id = app_current_org() and id = ${challanId}`);
    if (!c) throw new PayrollError('challan_not_found');
    return place(tx, c.institutionId);
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p) },
    async (tx) => {
      const [c] = await tx.execute<Record<string, string | number>>(sql`
        delete from payroll_tds_challan where org_id = app_current_org() and id = ${challanId}
        returning bsr_code as "bsrCode", challan_serial as "challanSerial", deposited_on::text as "depositedOn",
          amount_paise::int as "amountPaise"`);
      if (!c) throw new PayrollError('challan_not_found');
      return {
        result: undefined,
        audit: {
          action: 'payroll.tds.challan_delete',
          entityType: 'payroll_tds_challan',
          entityId: challanId,
          dataClass: 'operational',
          detail: c,
        },
      };
    },
  );
}

type Slip = {
  runId: string;
  month: string;
  state: string;
  paidOn: string | null;
  personId: string;
  name: string;
  employeeCode: string | null;
  basic: number;
  da: number;
  hra: number;
  conveyance: number;
  special: number;
  other: number;
  arrears: number;
  gross: number;
  pf: number;
  pt: number;
  tds: number;
};

/** Approved and paid runs' slips in the months (drafts are not pay yet). */
const slipsIn = (tx: Tx, institutionId: string, months: string[]) =>
  tx.execute<Slip>(sql`
    select r.id::text as "runId", to_char(r.month, 'YYYY-MM') as month, r.state, r.paid_on::text as "paidOn",
      s.person_id::text as "personId", s.snapshot ->> 'name' as name, s.snapshot ->> 'employeeCode' as "employeeCode",
      s.basic_paise::int as basic, s.da_paise::int as da, s.hra_paise::int as hra,
      s.conveyance_paise::int as conveyance, s.special_paise::int as special, s.other_paise::int as other,
      s.arrears_paise::int as arrears, s.gross_paise::int as gross, s.pf_paise::int as pf, s.pt_paise::int as pt,
      s.tds_paise::int as tds
    from payroll_slip s join payroll_run r on r.org_id = s.org_id and r.id = s.run_id
    where s.org_id = app_current_org() and r.institution_id = ${institutionId} and r.state in ('approved', 'paid')
      and to_char(r.month, 'YYYY-MM') = any(${`{${months.join(',')}}`}::text[])
    order by r.month, s.snapshot ->> 'name'`);

const checkQuarter = (fy: number, quarter: number): Quarter => {
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100 || ![1, 2, 3, 4].includes(quarter))
    throw new PayrollError('bad_quarter');
  return quarter as Quarter;
};

export const COLUMNS_24Q = [
  'Month',
  'Challan BSR code',
  'Challan serial no.',
  'Date of deposit',
  'Employee code',
  'PAN',
  'Name',
  'Date of payment',
  'Amount paid (₹)',
  'TDS deducted (₹)',
  'TDS deposited (₹)',
] as const;

export type TdsQuarter = {
  fy: number;
  quarter: Quarter;
  tan: string | null;
  legalEntity: string;
  statementDue: string;
  months: {
    month: string;
    run: { id: string; state: string; paidOn: string | null } | null;
    deductedPaise: number;
    depositedPaise: number;
    depositDue: string;
    challans: TdsChallan[];
  }[];
  deductees: number;
  /** Staff with tax deducted and no PAN on record (the statement needs it). */
  withoutPan: { personId: string; name: string }[];
  /** Deductions no challan covers yet. */
  unlinked: { personId: string; name: string; month: string; tdsPaise: number }[];
  /** Ready to prepare in the utility: TAN set, every month paid, every deduction under a challan, every PAN known. */
  ready: boolean;
  source: { title: string; verified: boolean };
  /** The 24Q worksheet (CSV, with PANs), only when asked for: audited. */
  file: string | null;
};

/**
 * A quarter of TDS on salaries: each month's deduction against the challans that deposited it,
 * and what still stops the 24Q statement. With `file`, the deductee worksheet with full PANs.
 */
export async function tdsQuarter(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; fy: number; quarter: number; file?: boolean | undefined },
): Promise<TdsQuarter> {
  const quarter = checkQuarter(input.fy, input.quarter);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await allowed(deps, tx, actor, input.institutionId, !!input.file);
    const inst = await institutionInfo(tx, input.institutionId);
    if (!inst) throw new PayrollError('institution_not_found');
    const months = quarterMonths(input.fy, quarter);
    const slips = await slipsIn(tx, input.institutionId, months);
    const challans = await challansIn(tx, input.institutionId, months);
    const taxed = slips.filter((s) => s.tds > 0);
    const { links, unlinked } = linkChallans(
      taxed.map((s) => ({ key: `${s.runId}:${s.personId}`, month: s.month, tdsPaise: s.tds })),
      challans.map((c) => ({ id: c.id, month: c.month, amountPaise: c.amountPaise })),
    );
    if (!deps.keys) throw new Error('tdsQuarter: field keys missing');
    const pans = await pansForExport(tx, deps.keys, actor.orgId, [
      ...new Set(taxed.map((s) => s.personId)),
    ]);
    const withoutPan = [
      ...new Map(
        taxed
          .filter((s) => !pans[s.personId])
          .map((s) => [s.personId, { personId: s.personId, name: s.name }]),
      ).values(),
    ];
    const monthly = months.map((m) => {
      const run = slips.find((s) => s.month === m);
      const own = challans.filter((c) => c.month === m);
      return {
        month: m,
        run: run ? { id: run.runId, state: run.state, paidOn: run.paidOn } : null,
        deductedPaise: taxed.filter((s) => s.month === m).reduce((a, s) => a + s.tds, 0),
        depositedPaise: own.reduce((a, c) => a + c.amountPaise, 0),
        depositDue: depositDue(m),
        challans: own,
      };
    });
    let file: string | null = null;
    if (input.file) {
      const byId = new Map(challans.map((c) => [c.id, c]));
      file = [
        csvLine([...COLUMNS_24Q]),
        ...taxed.map((s) => {
          const c = byId.get(links.get(`${s.runId}:${s.personId}`) ?? '');
          return csvLine([
            s.month,
            c?.bsrCode ?? '',
            c?.challanSerial ?? '',
            c?.depositedOn ?? '',
            s.employeeCode,
            pans[s.personId] ?? 'PANNOTAVBL',
            s.name,
            s.paidOn ?? '',
            rupeesText(s.gross),
            rupeesText(s.tds),
            c ? rupeesText(s.tds) : '0.00',
          ]);
        }),
      ].join('\n');
      await writeAudit(tx, actor, {
        action: 'payroll.tds.statement_export',
        entityType: 'institution',
        entityId: input.institutionId,
        dataClass: 'restricted',
        detail: { fy: input.fy, quarter, rows: taxed.length },
      });
    }
    return {
      fy: input.fy,
      quarter,
      tan: inst.tan,
      legalEntity: inst.legalEntityName,
      statementDue: statementDue(input.fy, quarter),
      months: monthly,
      deductees: new Set(taxed.map((s) => s.personId)).size,
      withoutPan,
      unlinked: unlinked.map((u) => {
        const s = taxed.find((x) => `${x.runId}:${x.personId}` === u.key);
        return {
          personId: s?.personId ?? '',
          name: s?.name ?? '',
          month: u.month,
          tdsPaise: u.tdsPaise,
        };
      }),
      ready:
        !!inst.tan &&
        withoutPan.length === 0 &&
        unlinked.length === 0 &&
        monthly.every((m) => m.run?.state === 'paid'),
      source: { title: TDS_SALARY.source.title, verified: TDS_SALARY.source.verified },
      file,
    };
  });
}

export const COLUMNS_FORM16 = [
  'Employee code',
  'PAN',
  'Name',
  'From',
  'To',
  'Basic (₹)',
  'DA (₹)',
  'HRA (₹)',
  'Conveyance (₹)',
  'Special (₹)',
  'Other (₹)',
  'Arrears (₹)',
  'Gross salary (₹)',
  'Professional tax, s.16(iii) (₹)',
  'Employee PF (₹)',
  'TDS Q1 (₹)',
  'TDS Q2 (₹)',
  'TDS Q3 (₹)',
  'TDS Q4 (₹)',
  'TDS total (₹)',
] as const;

export type Form16Row = {
  personId: string;
  name: string;
  employeeCode: string | null;
  from: string;
  to: string;
  grossPaise: number;
  ptPaise: number;
  pfPaise: number;
  tdsByQuarter: [number, number, number, number];
  tdsPaise: number;
};

/**
 * Each employee's Form 16 Part B figures for a financial year, from approved and paid runs:
 * salary by component, professional tax, employee PF and TDS by quarter. With `file`, a CSV with
 * full PANs (audited). The tax computation and Part A (from TRACES) are not here.
 */
export async function form16Figures(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; fy: number; file?: boolean | undefined },
): Promise<{ fy: number; tan: string | null; rows: Form16Row[]; file: string | null }> {
  checkQuarter(input.fy, 1);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await allowed(deps, tx, actor, input.institutionId, !!input.file);
    const inst = await institutionInfo(tx, input.institutionId);
    if (!inst) throw new PayrollError('institution_not_found');
    const months = ([1, 2, 3, 4] as const).flatMap((q) => quarterMonths(input.fy, q));
    const slips = await slipsIn(tx, input.institutionId, months);
    const PARTS = ['basic', 'da', 'hra', 'conveyance', 'special', 'other', 'arrears'] as const;
    const sums = new Map<string, Form16Row>();
    const parts = new Map<string, Record<(typeof PARTS)[number], number>>();
    for (const s of slips) {
      let r = sums.get(s.personId);
      if (!r) {
        r = {
          personId: s.personId,
          name: s.name,
          employeeCode: s.employeeCode,
          from: s.month,
          to: s.month,
          grossPaise: 0,
          ptPaise: 0,
          pfPaise: 0,
          tdsByQuarter: [0, 0, 0, 0],
          tdsPaise: 0,
        };
        sums.set(s.personId, r);
      }
      const p = parts.get(s.personId) ?? Object.fromEntries(PARTS.map((k) => [k, 0]));
      for (const k of PARTS) p[k] = (p[k] ?? 0) + s[k];
      parts.set(s.personId, p as Record<(typeof PARTS)[number], number>);
      r.to = s.month;
      r.grossPaise += s.gross;
      r.ptPaise += s.pt;
      r.pfPaise += s.pf;
      r.tdsPaise += s.tds;
      const q = Math.floor(months.indexOf(s.month) / 3);
      r.tdsByQuarter[q] = (r.tdsByQuarter[q] ?? 0) + s.tds;
    }
    const all = [...sums.values()].sort((a, b) => a.name.localeCompare(b.name));
    let file: string | null = null;
    if (input.file) {
      if (!deps.keys) throw new Error('form16Figures: field keys missing');
      const pans = await pansForExport(
        tx,
        deps.keys,
        actor.orgId,
        all.map((r) => r.personId),
      );
      file = [
        csvLine([...COLUMNS_FORM16]),
        ...all.map((r) =>
          csvLine([
            r.employeeCode,
            pans[r.personId] ?? 'PANNOTAVBL',
            r.name,
            r.from,
            r.to,
            ...[
              ...PARTS.map((k) => parts.get(r.personId)?.[k] ?? 0),
              r.grossPaise,
              r.ptPaise,
              r.pfPaise,
            ].map(rupeesText),
            ...r.tdsByQuarter.map(rupeesText),
            rupeesText(r.tdsPaise),
          ]),
        ),
      ].join('\n');
      await writeAudit(tx, actor, {
        action: 'payroll.tds.form_sixteen_export',
        entityType: 'institution',
        entityId: input.institutionId,
        dataClass: 'restricted',
        detail: { fy: input.fy, rows: all.length },
      });
    }
    return {
      fy: input.fy,
      tan: inst.tan,
      rows: all,
      file,
    };
  });
}
