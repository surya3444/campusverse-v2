// Payroll › Gratuity & Final Settlement (rule book §13.7; Labour Codes since 21 Nov 2025): each
// recent leaver, what they are owed, and the deadline two working days after the last day.
// Prepared by payroll staff, approved through the workflow engine, paid with a reference.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames, staffLeftSince } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { gratuityRulesAt, payrollRulesAt } from '@campusverse/platform-rulepacks';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import { sql } from 'drizzle-orm';
import { addWorkingDays, settlementFor, type SettlementFigures } from '../domain/settlement.js';
import { PayrollError, place, res, salariesOn, type PayrollDeps } from './payroll.js';

export const SETTLEMENT_PAID = 'payroll.settlement.paid.v1';
const PROCESS = 'payroll.settlement' as const;
/** Leavers shown: those who left in the last 120 days. */
const WINDOW_DAYS = 120;

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function dueOn(deps: PayrollDeps, tx: Tx, institutionId: string, lastDay: string) {
  const holidays = await deps.holidays(
    tx,
    institutionId,
    plusDays(lastDay, 1),
    plusDays(lastDay, 21),
  );
  return addWorkingDays(lastDay, 2, new Set(holidays));
}

async function figures(
  tx: Tx,
  institutionId: string,
  l: { personId: string; leftOn: string; joinedOn: string | null; employmentType: string | null },
): Promise<SettlementFigures | null> {
  const salary = (await salariesOn(tx, institutionId, l.leftOn)).get(l.personId);
  if (!salary) return null;
  const [paid] = await tx.execute(sql`
    select 1 from payroll_slip sl join payroll_run r on r.org_id = sl.org_id and r.id = sl.run_id
    where sl.org_id = app_current_org() and r.institution_id = ${institutionId} and sl.person_id = ${l.personId}
      and r.month = date_trunc('month', ${l.leftOn}::date)::date and r.state in ('approved', 'paid')`);
  return settlementFor({
    salary,
    rules: await payrollRulesAt(tx, institutionId, l.leftOn),
    gratuityRules: await gratuityRulesAt(tx, institutionId, l.leftOn),
    lastDay: l.leftOn,
    joinedOn: l.joinedOn,
    fixedTerm: l.employmentType === 'contract',
    monthPaid: !!paid,
  });
}

export type SettlementRow = {
  personId: string;
  name: string;
  employeeCode: string;
  lastDay: string;
  dueOn: string;
  joinedOn: string | null;
  fixedTerm: boolean;
  state: 'to_prepare' | 'prepared' | 'approved' | 'rejected' | 'paid';
  id: string | null;
  /** Stored once prepared; worked out live before that. Null without a salary. */
  figures: SettlementFigures | null;
  overdue: boolean;
  paidOn: string | null;
  paidLate: boolean;
  reference: string | null;
  decisionNote: string | null;
  approval: ApprovalState | null;
};

/** Recent leavers of an institution with what each is owed and when it falls due. */
export async function settlements(
  deps: PayrollDeps,
  actor: Actor,
  institutionId: string,
): Promise<SettlementRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await place(tx, institutionId);
    await deps.permissions.assertCan(tx, actor, 'payroll.run.prepare', res(actor, p));
    const now = await today(tx);
    const leavers = await staffLeftSince(tx, institutionId, plusDays(now, -WINDOW_DAYS));
    const stored = await tx.execute<{
      id: string;
      personId: string;
      dueOn: string;
      state: SettlementRow['state'];
      salaryDays: number;
      salaryNetPaise: string;
      gratuityWagesPaise: string;
      serviceMonths: number;
      gratuityYears: number;
      gratuityPaise: string;
      totalPaise: string;
      paidOn: string | null;
      reference: string | null;
      decisionNote: string | null;
    }>(sql`
      select distinct on (person_id) id::text, person_id::text as "personId", due_on::text as "dueOn", state,
        salary_days as "salaryDays", salary_net_paise::text as "salaryNetPaise",
        gratuity_wages_paise::text as "gratuityWagesPaise", service_months as "serviceMonths",
        gratuity_years as "gratuityYears", gratuity_paise::text as "gratuityPaise", total_paise::text as "totalPaise",
        paid_on::text as "paidOn", payment_reference as reference, decision_note as "decisionNote"
      from payroll_settlement where org_id = app_current_org() and institution_id = ${institutionId}
      order by person_id, prepared_at desc`);
    const byPerson = new Map(stored.map((s) => [s.personId, s]));
    const approvals = await approvalStates(
      tx,
      deps.permissions,
      actor,
      PROCESS,
      stored.map((s) => s.id),
    );
    const names = await displayNames(
      tx,
      leavers.map((l) => l.personId),
    );
    const out: SettlementRow[] = [];
    for (const l of leavers) {
      const s = byPerson.get(l.personId);
      const due = s?.dueOn ?? (await dueOn(deps, tx, institutionId, l.leftOn));
      const f: SettlementFigures | null = s
        ? {
            salaryDays: s.salaryDays,
            salaryNetPaise: Number(s.salaryNetPaise),
            gratuityWagesPaise: Number(s.gratuityWagesPaise),
            serviceMonths: s.serviceMonths,
            gratuityYears: s.gratuityYears,
            gratuityPaise: Number(s.gratuityPaise),
            totalPaise: Number(s.totalPaise),
          }
        : await figures(tx, institutionId, l);
      const paidOn = s?.state === 'paid' ? s.paidOn : null;
      out.push({
        personId: l.personId,
        name: names[l.personId] ?? l.name,
        employeeCode: l.employeeCode,
        lastDay: l.leftOn,
        dueOn: due,
        joinedOn: l.joinedOn,
        fixedTerm: l.employmentType === 'contract',
        state: s?.state ?? 'to_prepare',
        id: s?.id ?? null,
        figures: f,
        overdue: !paidOn && now > due,
        paidOn,
        paidLate: !!paidOn && paidOn > due,
        reference: s?.reference ?? null,
        decisionNote: s?.decisionNote ?? null,
        approval: s ? (approvals[s.id] ?? null) : null,
      });
    }
    return out;
  });
}

/** Works out and records a leaver's settlement, and sends it for approval. */
export async function prepareSettlement(
  deps: PayrollDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<string> {
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, input.institutionId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p, input.personId) },
    async (tx) => {
      const now = await today(tx);
      const l = (await staffLeftSince(tx, input.institutionId, plusDays(now, -WINDOW_DAYS))).find(
        (x) => x.personId === input.personId,
      );
      if (!l) throw new PayrollError('not_a_leaver');
      const f = await figures(tx, input.institutionId, l);
      if (!f) throw new PayrollError('no_salary');
      const due = await dueOn(deps, tx, input.institutionId, l.leftOn);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into payroll_settlement (org_id, institution_id, person_id, last_day, due_on, salary_days,
          salary_net_paise, gratuity_wages_paise, service_months, gratuity_years, gratuity_paise, fixed_term,
          total_paise, prepared_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.personId}, ${l.leftOn}::date, ${due}::date,
          ${f.salaryDays}, ${f.salaryNetPaise}, ${f.gratuityWagesPaise}, ${f.serviceMonths}, ${f.gratuityYears},
          ${f.gratuityPaise}, ${l.employmentType === 'contract'}, ${f.totalPaise}, ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('prepareSettlement: no row');
      const name = (await displayNames(tx, [input.personId]))[input.personId] ?? l.name;
      await startApproval(tx, {
        process: PROCESS,
        subjectId: row.id,
        institutionId: input.institutionId,
        amountPaise: f.totalPaise,
        summary: `Final settlement: ${name}, due ${due}`,
        requestedBy: actor.personId,
      });
      return {
        result: row.id,
        audit: {
          action: 'payroll.settlement.prepare',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'sensitive',
          detail: {
            lastDay: l.leftOn,
            dueOn: due,
            totalPaise: f.totalPaise,
            gratuityPaise: f.gratuityPaise,
          },
        },
      };
    },
  );
}

/** Decides the settlement's approval step through the workflow engine. */
export async function decideSettlement(
  deps: PayrollDeps,
  actor: Actor,
  input: { settlementId: string; approve: boolean; note: string | null },
): Promise<'approved' | 'rejected' | 'pending'> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [s] = await tx.execute<{ institutionId: string; personId: string; state: string }>(sql`
      select institution_id::text as "institutionId", person_id::text as "personId", state
      from payroll_settlement where org_id = app_current_org() and id = ${input.settlementId} for update`);
    if (!s) throw new PayrollError('settlement_not_found');
    const p = await place(tx, s.institutionId);
    // Payroll staff see it; who may decide each step is the approval designer's.
    const r = res(actor, p, s.personId);
    if (
      !(await deps.permissions.can(tx, actor, 'payroll.run.prepare', r)).allowed &&
      !(await deps.permissions.can(tx, actor, 'payroll.run.approve', r)).allowed
    )
      await deps.permissions.assertCan(tx, actor, 'payroll.run.approve', r);
    if (s.state !== 'prepared') throw new PayrollError('not_prepared');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: input.settlementId,
      approve: input.approve,
      note: input.note,
    });
    if (outcome !== 'pending')
      await tx.execute(sql`
        update payroll_settlement set state = ${outcome}, decided_at = now(), decision_note = ${input.note?.trim() || null}
        where org_id = app_current_org() and id = ${input.settlementId}`);
    return outcome;
  });
}

/** Records the payment of an approved settlement: its date (never before the last day) and reference. */
export async function markSettlementPaid(
  deps: PayrollDeps,
  actor: Actor,
  input: { settlementId: string; paidOn: string; reference: string },
): Promise<void> {
  const institutionId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [s] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from payroll_settlement
      where org_id = app_current_org() and id = ${input.settlementId}`);
    if (!s) throw new PayrollError('settlement_not_found');
    return s.institutionId;
  });
  const p = await withTenant(deps.db, actor.orgId, (tx) => place(tx, institutionId));
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'payroll.run.prepare', resource: res(actor, p) },
    async (tx) => {
      const [s] = await tx.execute<{
        state: string;
        lastDay: string;
        dueOn: string;
        personId: string;
      }>(sql`
        select state, last_day::text as "lastDay", due_on::text as "dueOn", person_id::text as "personId"
        from payroll_settlement where org_id = app_current_org() and id = ${input.settlementId} for update`);
      if (!s) throw new PayrollError('settlement_not_found');
      if (s.state !== 'approved') throw new PayrollError('not_approved');
      if (input.paidOn < s.lastDay || input.paidOn > (await today(tx)))
        throw new PayrollError('paid_date');
      await tx.execute(sql`
        update payroll_settlement set state = 'paid', paid_on = ${input.paidOn}::date,
          payment_reference = ${input.reference.trim()}
        where org_id = app_current_org() and id = ${input.settlementId}`);
      return {
        result: undefined,
        audit: {
          action: 'payroll.settlement.paid',
          entityType: 'person',
          entityId: s.personId,
          dataClass: 'sensitive',
          detail: { paidOn: input.paidOn, dueOn: s.dueOn, late: input.paidOn > s.dueOn },
        },
        events: [
          {
            type: SETTLEMENT_PAID,
            payload: { settlementId: input.settlementId, late: input.paidOn > s.dueOn },
          },
        ],
      };
    },
  );
}
