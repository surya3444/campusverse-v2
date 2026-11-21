// Fees collected for others (owner's brief, 21 Nov 2026): an engineering college's fee includes
// the affiliating university's share (VTU), a school's the board's registration fee. The college
// holds that money until it pays it on, so it is tracked apart from its own: billed, collected
// (split at every payment, outside payees first), remitted with a bank reference, and still held.
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { DATE, FinanceError, institution, placeOf, today, type FinanceDeps } from './common.js';

export const REMITTANCE_RECORDED = 'finance.remittance.recorded.v1';

export type PayeeKind = 'university' | 'board' | 'government' | 'other';
export const PAYEE_KINDS: readonly PayeeKind[] = ['university', 'board', 'government', 'other'];

export type PayeeInput = {
  institutionId: string;
  kind: PayeeKind;
  name: string;
  shortName: string;
};

export type PayeeSummary = {
  id: string;
  kind: PayeeKind;
  name: string;
  shortName: string;
  /** The heads collected for it. */
  heads: string[];
  billedPaise: number;
  collectedPaise: number;
  remittedPaise: number;
  /** Collected and not paid on yet: held for it. */
  toRemitPaise: number;
  /** Billed and not collected yet. */
  toCollectPaise: number;
};

export type PayeesView = {
  /** Academic years the institution's plans bill for, newest first. */
  years: string[];
  year: string | null;
  payees: PayeeSummary[];
  /** Held for all payees together. */
  heldPaise: number;
};

/** A payee of this institution, or payee_not_found. */
export async function payeeOf(tx: Tx, institutionId: string, payeeId: string) {
  const [p] = await tx.execute<{ id: string }>(sql`
    select id::text from fee_payee
    where org_id = app_current_org() and id = ${payeeId} and institution_id = ${institutionId}`);
  if (!p) throw new FinanceError('payee_not_found');
  return p;
}

const yearFilter = (year: string | null) =>
  year === null ? sql`true` : sql`pl.period_label = ${year}`;

/** Billed, collected and remitted per payee of an institution, for one year or all. */
async function figures(tx: Tx, institutionId: string, year: string | null, payeeId?: string) {
  const one = payeeId ? sql`and p.id = ${payeeId}` : sql``;
  return tx.execute<Omit<PayeeSummary, 'toRemitPaise' | 'toCollectPaise'>>(sql`
    select p.id::text, p.kind, p.name, p.short_name as "shortName",
      coalesce((select array_agg(h.name order by h.code) from fee_head h
        where h.org_id = p.org_id and h.payee_id = p.id), '{}') as heads,
      coalesce((select sum(l.amount_paise) from fee_invoice_line l
        join fee_head h on h.org_id = l.org_id and h.id = l.head_id
        join fee_invoice i on i.org_id = l.org_id and i.id = l.invoice_id and i.state <> 'written_off'
        join fee_plan pl on pl.org_id = i.org_id and pl.id = i.plan_id
        where l.org_id = p.org_id and h.payee_id = p.id and ${yearFilter(year)}), 0)::bigint::float8 as "billedPaise",
      coalesce((select sum(a.amount_paise) from fee_allocation a
        join fee_invoice i on i.org_id = a.org_id and i.id = a.invoice_id
        join fee_plan pl on pl.org_id = i.org_id and pl.id = i.plan_id
        where a.org_id = p.org_id and a.payee_id = p.id and ${yearFilter(year)}), 0)::bigint::float8 as "collectedPaise",
      coalesce((select sum(r.amount_paise) from fee_remittance r
        where r.org_id = p.org_id and r.payee_id = p.id
          and ${year === null ? sql`true` : sql`r.period_label = ${year}`}), 0)::bigint::float8 as "remittedPaise"
    from fee_payee p
    where p.org_id = app_current_org() and p.institution_id = ${institutionId} ${one}
    order by p.short_name`);
}

const summary = (f: Omit<PayeeSummary, 'toRemitPaise' | 'toCollectPaise'>): PayeeSummary => ({
  ...f,
  toRemitPaise: f.collectedPaise - f.remittedPaise,
  toCollectPaise: Math.max(0, f.billedPaise - f.collectedPaise),
});

async function yearsOf(tx: Tx, institutionId: string): Promise<string[]> {
  return (
    await tx.execute<{ y: string }>(sql`
      select distinct period_label as y from fee_plan
      where org_id = app_current_org() and institution_id = ${institutionId} and period_label is not null
      order by 1 desc`)
  ).map((r) => r.y);
}

/** Every payee of an institution with what is billed, collected, paid on and held for it. */
export async function payees(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
  /** Null: every year. Left out: the newest year the plans bill for. */
  asked: string | null | undefined,
): Promise<PayeesView> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    const years = await yearsOf(tx, institutionId);
    const year = asked === undefined ? (years[0] ?? null) : asked;
    const list = (await figures(tx, institutionId, year)).map(summary);
    return {
      years,
      year,
      payees: list,
      heldPaise: list.reduce((a, p) => a + p.toRemitPaise, 0),
    };
  });
}

/** Adds an outside body the institution collects for (VTU, CBSE, the state government). */
export async function savePayee(
  deps: FinanceDeps,
  actor: Actor,
  input: PayeeInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  const shortName = input.shortName.trim();
  if (!PAYEE_KINDS.includes(input.kind)) throw new FinanceError('bad_payee_kind');
  if (!name || name.length > 120 || !shortName || shortName.length > 20)
    throw new FinanceError('bad_payee_name');
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, input.institutionId)),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_payee (org_id, institution_id, kind, name, short_name)
        values (app_current_org(), ${input.institutionId}, ${input.kind}, ${name}, ${shortName})
        on conflict (org_id, institution_id, short_name) do nothing returning id::text`);
      if (!row) throw new FinanceError('payee_exists');
      return {
        result: row,
        audit: {
          action: 'finance.payee.add',
          entityType: 'fee_payee',
          entityId: row.id,
          dataClass: 'operational',
          detail: { kind: input.kind, shortName },
        },
      };
    },
  );
}

/**
 * Who a head is collected for. Only until it is first billed: after that, money already split on
 * receipts and remittances would no longer add up. Make a new head instead.
 */
export async function setHeadPayee(
  deps: FinanceDeps,
  actor: Actor,
  input: { headId: string; payeeId: string | null },
): Promise<void> {
  const head = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [h] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from fee_head
      where org_id = app_current_org() and id = ${input.headId}`);
    if (!h) throw new FinanceError('head_not_found');
    return { ...h, place: placeOf(await institution(tx, h.institutionId)) };
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place: head.place } },
    async (tx) => {
      if (input.payeeId) await payeeOf(tx, head.institutionId, input.payeeId);
      const [used] = await tx.execute(sql`
        select 1 from fee_invoice_line where org_id = app_current_org() and head_id = ${input.headId} limit 1`);
      if (used) throw new FinanceError('head_in_use');
      await tx.execute(sql`
        update fee_head set payee_id = ${input.payeeId} where org_id = app_current_org() and id = ${input.headId}`);
      return {
        result: undefined,
        audit: {
          action: 'finance.head.collected_for',
          entityType: 'fee_head',
          entityId: input.headId,
          dataClass: 'operational',
          detail: { payeeId: input.payeeId },
        },
      };
    },
  );
}

export type PayeeStatement = {
  payee: PayeeSummary;
  years: string[];
  year: string | null;
  /** Student by student, as the university asks for it. */
  students: {
    studentId: string;
    name: string;
    /** Class and admission number, when the academic module knows them. */
    placement: string | null;
    reference: string | null;
    billedPaise: number;
    collectedPaise: number;
  }[];
  remittances: {
    id: string;
    paidOn: string;
    amountPaise: number;
    reference: string;
    periodLabel: string | null;
    note: string | null;
    recordedBy: string;
  }[];
};

/** One payee: its figures, each student's share, and what has been paid on. */
export async function payeeStatement(
  deps: FinanceDeps,
  actor: Actor,
  payeeId: string,
  /** Null: every year. Left out: the newest year the plans bill for. */
  asked: string | null | undefined,
): Promise<PayeeStatement> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [p] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from fee_payee
      where org_id = app_current_org() and id = ${payeeId}`);
    if (!p) throw new FinanceError('payee_not_found');
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, p.institutionId)),
    });
    const years = await yearsOf(tx, p.institutionId);
    const year = asked === undefined ? (years[0] ?? null) : asked;
    const [f] = await figures(tx, p.institutionId, year, payeeId);
    if (!f) throw new FinanceError('payee_not_found');
    const students = await tx.execute<{
      studentId: string;
      name: string;
      billedPaise: number;
      collectedPaise: number;
    }>(sql`
      with billed as (
        select i.student_person_id as s, sum(l.amount_paise) as amount from fee_invoice_line l
        join fee_head h on h.org_id = l.org_id and h.id = l.head_id
        join fee_invoice i on i.org_id = l.org_id and i.id = l.invoice_id and i.state <> 'written_off'
        join fee_plan pl on pl.org_id = i.org_id and pl.id = i.plan_id
        where l.org_id = app_current_org() and h.payee_id = ${payeeId} and ${yearFilter(year)}
        group by i.student_person_id),
      paid as (
        select i.student_person_id as s, sum(a.amount_paise) as amount from fee_allocation a
        join fee_invoice i on i.org_id = a.org_id and i.id = a.invoice_id
        join fee_plan pl on pl.org_id = i.org_id and pl.id = i.plan_id
        where a.org_id = app_current_org() and a.payee_id = ${payeeId} and ${yearFilter(year)}
        group by i.student_person_id)
      select coalesce(b.s, c.s)::text as "studentId", pe.legal_name as name,
        coalesce(b.amount, 0)::bigint::float8 as "billedPaise", coalesce(c.amount, 0)::bigint::float8 as "collectedPaise"
      from billed b full join paid c on c.s = b.s
      join person pe on pe.org_id = app_current_org() and pe.id = coalesce(b.s, c.s)
      order by pe.legal_name`);
    const lookup = { personIds: students.map((s) => s.studentId), onDate: await today(tx) };
    const places = await Promise.all(
      (deps.placements ?? []).map((pl) => pl.getPlacements(tx, lookup)),
    );
    const remittances = await tx.execute<PayeeStatement['remittances'][number]>(sql`
      select r.id::text, r.paid_on::text as "paidOn", r.amount_paise::bigint::float8 as "amountPaise", r.reference,
        r.period_label as "periodLabel", r.note, pe.legal_name as "recordedBy"
      from fee_remittance r join person pe on pe.org_id = r.org_id and pe.id = r.recorded_by_person_id
      where r.org_id = app_current_org() and r.payee_id = ${payeeId}
        and ${year === null ? sql`true` : sql`r.period_label = ${year}`}
      order by r.paid_on desc, r.created_at desc`);
    return {
      payee: summary(f),
      years,
      year,
      students: students.map((s) => {
        const place = places.map((m) => m.get(s.studentId)).find((x) => x !== undefined);
        return {
          ...s,
          placement: place?.displayLabel ?? null,
          reference: place?.reference ?? null,
        };
      }),
      remittances: [...remittances],
    };
  });
}

export type RemittanceInput = {
  payeeId: string;
  /** The year the money was collected for; null where the plans name no year. */
  periodLabel: string | null;
  amountPaise: number;
  paidOn: string;
  reference: string;
  note?: string | null | undefined;
};

/**
 * Records money paid on to a payee (a bank transfer or demand draft to the university). It can't
 * be more than is held for it for that year, nor dated ahead. Remittances are never edited.
 */
export async function recordRemittance(
  deps: FinanceDeps,
  actor: Actor,
  input: RemittanceInput,
): Promise<{ id: string }> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new FinanceError('bad_amount');
  if (!DATE.test(input.paidOn)) throw new FinanceError('bad_date');
  const reference = input.reference.trim();
  if (!reference || reference.length > 60) throw new FinanceError('reference_required');
  if (input.periodLabel !== null && !/^\d{4}-\d{2}$/.test(input.periodLabel))
    throw new FinanceError('bad_year');
  const p = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ institutionId: string; shortName: string }>(sql`
      select institution_id::text as "institutionId", short_name as "shortName" from fee_payee
      where org_id = app_current_org() and id = ${input.payeeId}`);
    if (!row) throw new FinanceError('payee_not_found');
    return { ...row, place: placeOf(await institution(tx, row.institutionId)) };
  });
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.remittance.record', resource: { orgId: actor.orgId, place: p.place } },
    async (tx) => {
      if (input.paidOn > (await today(tx))) throw new FinanceError('future_date');
      // Locked so two people recording at once can't both pay on the same money.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.payeeId}, 0))`);
      const [f] = await figures(tx, p.institutionId, input.periodLabel, input.payeeId);
      const held = f ? f.collectedPaise - f.remittedPaise : 0;
      if (input.amountPaise > held) throw new FinanceError('more_than_held', { heldPaise: held });
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_remittance (org_id, institution_id, payee_id, period_label, amount_paise, paid_on, reference,
          note, recorded_by_person_id)
        values (app_current_org(), ${p.institutionId}, ${input.payeeId}, ${input.periodLabel}, ${input.amountPaise},
          ${input.paidOn}, ${reference}, ${input.note?.trim() || null}, ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('recordRemittance: no row');
      return {
        result: row,
        audit: {
          action: 'finance.remittance.record',
          entityType: 'fee_remittance',
          entityId: row.id,
          dataClass: 'operational',
          detail: {
            payee: p.shortName,
            amountPaise: input.amountPaise,
            periodLabel: input.periodLabel,
            reference,
          },
        },
        events: [
          {
            type: REMITTANCE_RECORDED,
            payload: {
              remittanceId: row.id,
              payeeId: input.payeeId,
              institutionId: p.institutionId,
              amountPaise: input.amountPaise,
              periodLabel: input.periodLabel,
            },
          },
        ],
      };
    },
  );
}
