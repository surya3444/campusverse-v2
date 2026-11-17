import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { concessionOn, instalmentLines, type Concession } from '../domain/money.js';
import {
  DATE,
  FinanceError,
  institution,
  placeOf,
  refreshInvoice,
  today,
  type FinanceDeps,
} from './common.js';

export type HeadInput = {
  institutionId: string;
  code: string;
  name: string;
  taxClass: 'education_exempt' | 'taxable';
  rteExempt: boolean;
  refundable: boolean;
};

async function placeFor(deps: FinanceDeps, actor: Actor, institutionId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, institutionId)),
  );
}

export async function createHead(
  deps: FinanceDeps,
  actor: Actor,
  input: HeadInput,
): Promise<{ id: string }> {
  const place = await placeFor(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_head (org_id, institution_id, code, name, tax_class, rte_exempt, refundable)
        values (app_current_org(), ${input.institutionId}, ${input.code}, ${input.name.trim()}, ${input.taxClass},
          ${input.rteExempt}, ${input.refundable})
        on conflict (org_id, institution_id, code) do nothing returning id::text`);
      if (!row) throw new FinanceError('head_exists');
      return {
        result: row,
        audit: {
          action: 'finance.plan.manage',
          entityType: 'fee_head',
          entityId: row.id,
          dataClass: 'operational',
          detail: { code: input.code },
        },
      };
    },
  );
}

export type Head = {
  id: string;
  code: string;
  name: string;
  taxClass: string;
  rteExempt: boolean;
  refundable: boolean;
};

export async function listHeads(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<Head[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    return [
      ...(await tx.execute<Head>(sql`
        select id::text, code, name, tax_class as "taxClass", rte_exempt as "rteExempt", refundable
        from fee_head where org_id = app_current_org() and institution_id = ${institutionId} order by code`)),
    ];
  });
}

export type PlanInput = {
  institutionId: string;
  name: string;
  groupIds: string[];
  lines: { headId: string; amountPaise: number }[];
  instalments: { label: string; dueOn: string; shareBp: number }[];
  lateFeePaise: number;
  graceDays: number;
};

function checkPlan(p: Omit<PlanInput, 'institutionId'>) {
  if (p.lines.length === 0) throw new FinanceError('no_lines');
  if (p.instalments.length === 0) throw new FinanceError('no_instalments');
  if (p.instalments.reduce((a, i) => a + i.shareBp, 0) !== 10_000)
    throw new FinanceError('shares_not_100');
  if (p.instalments.some((i) => !DATE.test(i.dueOn))) throw new FinanceError('bad_date');
  if (p.lines.some((l) => !Number.isSafeInteger(l.amountPaise) || l.amountPaise <= 0))
    throw new FinanceError('bad_amount');
  if (new Set(p.lines.map((l) => l.headId)).size !== p.lines.length)
    throw new FinanceError('head_twice');
}

async function writeContents(tx: Tx, planId: string, p: Omit<PlanInput, 'institutionId'>) {
  await tx.execute(
    sql`delete from fee_plan_line where org_id = app_current_org() and plan_id = ${planId}`,
  );
  await tx.execute(
    sql`delete from fee_instalment where org_id = app_current_org() and plan_id = ${planId}`,
  );
  for (const l of p.lines) {
    await tx.execute(sql`
      insert into fee_plan_line (org_id, plan_id, head_id, amount_paise)
      values (app_current_org(), ${planId}, ${l.headId}, ${l.amountPaise})`);
  }
  for (const [i, inst] of [...p.instalments]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
    .entries()) {
    await tx.execute(sql`
      insert into fee_instalment (org_id, plan_id, seq, label, due_on, share_bp)
      values (app_current_org(), ${planId}, ${i + 1}, ${inst.label.trim()}, ${inst.dueOn}::date, ${inst.shareBp})`);
  }
}

/** A new plan, or a new draft version of an existing plan family (fee changed mid-year). */
export async function savePlan(
  deps: FinanceDeps,
  actor: Actor,
  input: PlanInput & { planId?: string | undefined },
): Promise<{ id: string; version: number }> {
  checkPlan(input);
  const place = await placeFor(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      let plan: { id: string; version: number };
      if (input.planId) {
        const [existing] = await tx.execute<{
          id: string;
          version: number;
          state: string;
          familyId: string;
        }>(sql`
          select id::text, version, state, family_id::text as "familyId" from fee_plan
          where org_id = app_current_org() and id = ${input.planId} for update`);
        if (!existing) throw new FinanceError('plan_not_found');
        if (existing.state === 'draft') {
          await tx.execute(sql`
            update fee_plan set name = ${input.name.trim()}, group_ids = ${`{${input.groupIds.join(',')}}`}::uuid[],
              late_fee_paise = ${input.lateFeePaise}, grace_days = ${input.graceDays}
            where org_id = app_current_org() and id = ${existing.id}`);
          plan = existing;
        } else {
          const [next] = await tx.execute<{ id: string; version: number }>(sql`
            insert into fee_plan (org_id, family_id, version, institution_id, name, group_ids, late_fee_paise, grace_days,
              created_by_person_id)
            values (app_current_org(), ${existing.familyId},
              (select max(version) + 1 from fee_plan where org_id = app_current_org() and family_id = ${existing.familyId}),
              ${input.institutionId}, ${input.name.trim()}, ${`{${input.groupIds.join(',')}}`}::uuid[],
              ${input.lateFeePaise}, ${input.graceDays}, ${actor.personId})
            returning id::text, version`);
          if (!next) throw new Error('savePlan: no version');
          plan = next;
        }
      } else {
        const [created] = await tx.execute<{ id: string; version: number }>(sql`
          insert into fee_plan (org_id, family_id, institution_id, name, group_ids, late_fee_paise, grace_days,
            created_by_person_id)
          values (app_current_org(), uuidv7(), ${input.institutionId}, ${input.name.trim()},
            ${`{${input.groupIds.join(',')}}`}::uuid[], ${input.lateFeePaise}, ${input.graceDays}, ${actor.personId})
          returning id::text, version`);
        if (!created) throw new Error('savePlan: no row');
        plan = created;
      }
      await writeContents(tx, plan.id, input);
      return {
        result: plan,
        audit: {
          action: 'finance.plan.manage',
          entityType: 'fee_plan',
          entityId: plan.id,
          dataClass: 'operational',
          detail: { version: plan.version },
        },
      };
    },
  );
}

export type PlanDetail = {
  id: string;
  familyId: string;
  version: number;
  name: string;
  state: string;
  groupIds: string[];
  lateFeePaise: number;
  graceDays: number;
  lines: { headId: string; code: string; name: string; amountPaise: number }[];
  instalments: { seq: number; label: string; dueOn: string; shareBp: number }[];
  totalPaise: number;
  /** The published version this would replace, for the comparison and the fee-limit warning. */
  previousTotalPaise: number | null;
  /** Invoices raised from this version: 0 after publishing means nobody has been billed yet. */
  invoicesIssued: number;
};

async function loadPlan(tx: Tx, planId: string): Promise<PlanDetail & { institutionId: string }> {
  const [p] = await tx.execute<
    Omit<
      PlanDetail,
      'lines' | 'instalments' | 'totalPaise' | 'previousTotalPaise' | 'invoicesIssued'
    > & {
      institutionId: string;
    }
  >(sql`
    select id::text, family_id::text as "familyId", version, name, state, group_ids::text[] as "groupIds",
      late_fee_paise::int as "lateFeePaise", grace_days as "graceDays", institution_id::text as "institutionId"
    from fee_plan where org_id = app_current_org() and id = ${planId}`);
  if (!p) throw new FinanceError('plan_not_found');
  const lines = await tx.execute<PlanDetail['lines'][number]>(sql`
    select l.head_id::text as "headId", h.code, h.name, l.amount_paise::int as "amountPaise"
    from fee_plan_line l join fee_head h on h.org_id = l.org_id and h.id = l.head_id
    where l.org_id = app_current_org() and l.plan_id = ${planId} order by h.code`);
  const instalments = await tx.execute<PlanDetail['instalments'][number]>(sql`
    select seq, label, due_on::text as "dueOn", share_bp as "shareBp" from fee_instalment
    where org_id = app_current_org() and plan_id = ${planId} order by seq`);
  const [prev] = await tx.execute<{ total: number }>(sql`
    select coalesce(sum(l.amount_paise), 0)::int as total from fee_plan p
    join fee_plan_line l on l.org_id = p.org_id and l.plan_id = p.id
    where p.org_id = app_current_org() and p.family_id = ${p.familyId} and p.state = 'published' and p.id <> ${planId}
    group by p.id`);
  const [issued] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from fee_invoice where org_id = app_current_org() and plan_id = ${planId}`);
  return {
    ...p,
    invoicesIssued: issued?.n ?? 0,
    lines: [...lines],
    instalments: [...instalments],
    totalPaise: lines.reduce((a, l) => a + l.amountPaise, 0),
    previousTotalPaise: prev?.total ?? null,
  };
}

export async function planDetail(
  deps: FinanceDeps,
  actor: Actor,
  planId: string,
): Promise<PlanDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = await loadPlan(tx, planId);
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, p.institutionId)),
    });
    const detail: PlanDetail & { institutionId?: string } = { ...p };
    delete detail.institutionId;
    return detail;
  });
}

export type PlanSummary = {
  id: string;
  name: string;
  version: number;
  state: string;
  totalPaise: number;
  groups: number;
};

export async function listPlans(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<PlanSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    return [
      ...(await tx.execute<PlanSummary>(sql`
        select p.id::text, p.name, p.version, p.state, cardinality(p.group_ids) as groups,
          coalesce((select sum(amount_paise) from fee_plan_line where org_id = p.org_id and plan_id = p.id), 0)::int as "totalPaise"
        from fee_plan p where p.org_id = app_current_org() and p.institution_id = ${institutionId} and p.state <> 'retired'
        order by p.name, p.version desc`)),
    ];
  });
}

/** Publishing fixes the amounts. The previous published version of the family is retired. */
export async function publishPlan(deps: FinanceDeps, actor: Actor, planId: string): Promise<void> {
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, (await loadPlan(tx, planId)).institutionId)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const p = await loadPlan(tx, planId);
      if (p.state !== 'draft') throw new FinanceError('not_a_draft');
      checkPlan({
        ...p,
        lines: p.lines.map((l) => ({ headId: l.headId, amountPaise: l.amountPaise })),
      });
      await tx.execute(sql`
        update fee_plan set state = 'retired' where org_id = app_current_org() and family_id = ${p.familyId} and state = 'published'`);
      await tx.execute(sql`
        update fee_plan set state = 'published', published_by_person_id = ${actor.personId}, published_at = now()
        where org_id = app_current_org() and id = ${planId}`);
      return {
        result: undefined,
        audit: {
          action: 'finance.plan.manage',
          entityType: 'fee_plan',
          entityId: planId,
          dataClass: 'operational',
          detail: { published: p.version, totalPaise: p.totalPaise },
        },
      };
    },
  );
}

type ApprovedConcession = {
  headId: string | null;
  concession: Concession;
  validFrom: string;
  validUntil: string;
  reason: string;
};

async function concessionsFor(tx: Tx, studentId: string): Promise<ApprovedConcession[]> {
  const rows = await tx.execute<{
    headId: string | null;
    kind: 'percent' | 'amount';
    value: string;
    from: string;
    until: string;
    reason: string;
  }>(sql`
    select head_id::text as "headId", kind, value::text, lower(valid_during)::text as from, upper(valid_during)::text as until, reason
    from fee_concession where org_id = app_current_org() and student_person_id = ${studentId} and state = 'approved'`);
  return rows.map((r) => ({
    headId: r.headId,
    concession:
      r.kind === 'percent'
        ? { kind: 'percent', basisPoints: Number(r.value) }
        : { kind: 'amount', amount: Number(r.value) },
    validFrom: r.from,
    validUntil: r.until,
    reason: r.reason,
  }));
}

/** Writes concession lines for a charge line, once each, by the approved concessions on its date. */
export async function applyConcessions(
  tx: Tx,
  invoiceId: string,
  studentId: string,
  dueOn: string,
) {
  const list = (await concessionsFor(tx, studentId)).filter(
    (c) => c.validFrom <= dueOn && dueOn < c.validUntil,
  );
  if (list.length === 0) return;
  const charges = await tx.execute<{ headId: string; amount: number; given: number }>(sql`
    select c.head_id::text as "headId", sum(c.amount_paise) filter (where c.kind = 'charge')::int as amount,
      coalesce(-sum(c.amount_paise) filter (where c.kind = 'concession'), 0)::int as given
    from fee_invoice_line c where c.org_id = app_current_org() and c.invoice_id = ${invoiceId} and c.head_id is not null
    group by c.head_id`);
  for (const ch of charges) {
    for (const c of list.filter((x) => x.headId === null || x.headId === ch.headId)) {
      const left = ch.amount - ch.given;
      const amount = Math.min(concessionOn(ch.amount, c.concession), left);
      if (amount <= 0) continue;
      await tx.execute(sql`
        insert into fee_invoice_line (org_id, invoice_id, head_id, kind, amount_paise, reason)
        values (app_current_org(), ${invoiceId}, ${ch.headId}, 'concession', ${-amount}, ${c.reason})`);
      ch.given += amount;
    }
  }
}

export type IssuePreview = {
  students: number;
  invoices: number;
  totalPaise: number;
  alreadyIssued: number;
  /** Instalments already due before today are not billed to students who join later. */
  skippedPastDue: number;
  /** State pack note: a fee increase over the published version, for the school to check. */
  increaseOverPreviousBp: number | null;
};

async function issuePlan(
  tx: Tx,
  deps: Pick<FinanceDeps, 'audience'>,
  planId: string,
  commit: boolean,
  actorId: string | null,
  onlyStudentId: string | null = null,
  /** A later first day (a rider starting next month): who is covered, and what is already due, from then. */
  asOf: string | null = null,
) {
  const p = await loadPlan(tx, planId);
  if (p.state !== 'published') throw new FinanceError('not_published');
  const inst = await institution(tx, p.institutionId);
  const issuedOn = await today(tx);
  const d = asOf && asOf > issuedOn ? asOf : issuedOn;
  const everyone = await deps.audience.students(tx, p.institutionId, p.groupIds, d);
  const students = onlyStudentId ? everyone.filter((s) => s === onlyStudentId) : everyone;
  const split = instalmentLines(
    p.lines.map((l) => ({ headId: l.headId, amount: l.amountPaise })),
    p.instalments.map((i) => i.shareBp),
  );
  const existing = new Set(
    (
      await tx.execute<{ k: string }>(sql`
        select student_person_id::text || ':' || instalment_seq as k from fee_invoice
        where org_id = app_current_org() and plan_family_id = ${p.familyId}`)
    ).map((r) => r.k),
  );
  let invoices = 0;
  let total = 0;
  let already = 0;
  let skipped = 0;
  const issued: string[] = [];
  for (const studentId of students) {
    // A student with no invoice yet joined after the plan was first billed: past instalments are skipped.
    const isNew = !p.instalments.some((i) => existing.has(`${studentId}:${i.seq}`));
    for (const [n, i] of p.instalments.entries()) {
      if (existing.has(`${studentId}:${i.seq}`)) {
        already++;
        continue;
      }
      // An admission (one student) never back-bills; a first plan-wide issue bills the whole year.
      // A rider with a later first day (asOf) is never billed what fell due before it.
      if (
        i.dueOn < d &&
        ((asOf !== null && onlyStudentId !== null) ||
          (isNew && (onlyStudentId !== null || issuedAnyBefore(existing))))
      ) {
        skipped++;
        continue;
      }
      const lines = split[n] ?? [];
      invoices++;
      total += lines.reduce((a, l) => a + l.amount, 0);
      if (!commit) continue;
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_invoice (org_id, legal_entity_id, institution_id, student_person_id, plan_id, plan_family_id,
          instalment_seq, label, issued_on, due_on, total_paise)
        values (app_current_org(), ${inst.legalEntityId}, ${p.institutionId}, ${studentId}, ${p.id}, ${p.familyId},
          ${i.seq}, ${i.label}, ${issuedOn}::date, ${i.dueOn}::date, 0)
        on conflict do nothing returning id::text`);
      if (!row) continue;
      for (const l of lines) {
        await tx.execute(sql`
          insert into fee_invoice_line (org_id, invoice_id, head_id, kind, amount_paise, created_by_person_id)
          values (app_current_org(), ${row.id}, ${l.headId}, 'charge', ${l.amount}, ${actorId})`);
      }
      await applyConcessions(tx, row.id, studentId, i.dueOn);
      await refreshInvoice(tx, row.id);
      issued.push(row.id);
    }
  }
  return {
    preview: {
      students: students.length,
      invoices,
      totalPaise: total,
      alreadyIssued: already,
      skippedPastDue: skipped,
      increaseOverPreviousBp:
        p.previousTotalPaise && p.totalPaise > p.previousTotalPaise
          ? Math.floor(((p.totalPaise - p.previousTotalPaise) * 10_000) / p.previousTotalPaise)
          : null,
    } satisfies IssuePreview,
    issued,
    place: placeOf(inst),
  };
}

/** Mid-year joiners: once a plan has billed anyone, it never back-bills instalments already due. */
const issuedAnyBefore = (existing: Set<string>) => existing.size > 0;

/** What issuing a plan's invoices would do. Writes nothing. */
export async function previewIssue(
  deps: FinanceDeps,
  actor: Actor,
  planId: string,
): Promise<IssuePreview> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await issuePlan(tx, deps, planId, false, null);
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.issue', {
      orgId: actor.orgId,
      place: r.place,
    });
    return r.preview;
  });
}

/** Issues the invoices. Safe to repeat: each student and instalment is billed once. */
export async function issueInvoices(
  deps: FinanceDeps,
  actor: Actor,
  planId: string,
): Promise<IssuePreview> {
  const place = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => (await issuePlan(tx, deps, planId, false, null)).place,
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.invoice.issue', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const r = await issuePlan(tx, deps, planId, true, actor.personId);
      return {
        result: r.preview,
        audit: {
          action: 'finance.invoice.issue',
          entityType: 'fee_plan',
          entityId: planId,
          dataClass: 'personal',
          detail: { invoices: r.issued.length },
        },
      };
    },
  );
}

/** An explicit change to one invoice, with its reason: the way a mid-year fee change reaches a student. */
export async function adjustInvoice(
  deps: FinanceDeps,
  actor: Actor,
  input: { invoiceId: string; amountPaise: number; reason: string },
): Promise<void> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise === 0)
    throw new FinanceError('bad_amount');
  if (input.reason.trim().length < 3) throw new FinanceError('reason_required');
  const place = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [i] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from fee_invoice where org_id = app_current_org() and id = ${input.invoiceId}`);
    if (!i) throw new FinanceError('invoice_not_found');
    return placeOf(await institution(tx, i.institutionId));
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.invoice.issue', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      await tx.execute(sql`
        insert into fee_invoice_line (org_id, invoice_id, kind, amount_paise, reason, created_by_person_id)
        values (app_current_org(), ${input.invoiceId}, 'adjustment', ${input.amountPaise}, ${input.reason.trim()}, ${actor.personId})`);
      await refreshInvoice(tx, input.invoiceId);
      const [after] = await tx.execute<{ total: number }>(sql`
        select total_paise::int as total from fee_invoice where org_id = app_current_org() and id = ${input.invoiceId}`);
      if ((after?.total ?? 0) < 0) throw new FinanceError('below_zero');
      return {
        result: undefined,
        audit: {
          action: 'finance.invoice.issue',
          entityType: 'fee_invoice',
          entityId: input.invoiceId,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: { amountPaise: input.amountPaise },
        },
      };
    },
  );
}

/**
 * Bills one new student on every published plan that covers them (an admission). Instalments
 * already due before today are skipped, as for any later joiner. Call inside the caller's command().
 */
export async function billStudent(
  tx: Tx,
  audience: FinanceDeps['audience'],
  input: { studentId: string; institutionId: string; actorId: string; asOf?: string },
): Promise<{ invoices: number; totalPaise: number }> {
  const plans = await tx.execute<{ id: string }>(sql`
    select id::text from fee_plan
    where org_id = app_current_org() and institution_id = ${input.institutionId} and state = 'published'`);
  let invoices = 0;
  let totalPaise = 0;
  for (const p of plans) {
    const r = await issuePlan(
      tx,
      { audience },
      p.id,
      true,
      input.actorId,
      input.studentId,
      input.asOf ?? null,
    );
    invoices += r.issued.length;
    totalPaise += r.preview.totalPaise;
  }
  return { invoices, totalPaise };
}

export type FeeDisclosure = {
  planId: string;
  name: string;
  totalPaise: number;
  lines: { head: string; amountPaise: number }[];
  instalments: { label: string; dueOn: string; amountPaise: number }[];
};

/**
 * The full fee structure for a class before anyone pays (the offer's fee disclosure): every
 * published plan that names one of these groups (the class, or one of its sections).
 */
export async function feeDisclosure(
  tx: Tx,
  institutionId: string,
  groupIds: string[],
): Promise<FeeDisclosure[]> {
  const plans = await tx.execute<{ id: string }>(sql`
    select id::text from fee_plan
    where org_id = app_current_org() and institution_id = ${institutionId} and state = 'published'
      and group_ids && ${`{${groupIds.join(',')}}`}::uuid[]`);
  const out: FeeDisclosure[] = [];
  for (const { id } of plans) {
    const p = await loadPlan(tx, id);
    const split = instalmentLines(
      p.lines.map((l) => ({ headId: l.headId, amount: l.amountPaise })),
      p.instalments.map((i) => i.shareBp),
    );
    out.push({
      planId: p.id,
      name: p.name,
      totalPaise: p.totalPaise,
      lines: p.lines.map((l) => ({ head: l.name, amountPaise: l.amountPaise })),
      instalments: p.instalments.map((i, n) => ({
        label: i.label,
        dueOn: i.dueOn,
        amountPaise: (split[n] ?? []).reduce((a, l) => a + l.amount, 0),
      })),
    });
  }
  return out;
}

/** What a student owes now, and what was paid between two dates (for clearance and fee certificates). */
export async function studentMoney(
  tx: Tx,
  input: { studentId: string; paidFrom: string; paidUntil: string },
): Promise<{ duePaise: number; paidPaise: number }> {
  const [row] = await tx.execute<{ due: number; paid: number }>(sql`
    select
      coalesce((select sum(total_paise - paid_paise) from fee_invoice where org_id = app_current_org()
        and student_person_id = ${input.studentId} and state <> 'written_off'), 0)::int as due,
      coalesce((select sum(amount_paise) from fee_receipt where org_id = app_current_org()
        and student_person_id = ${input.studentId} and issued_at::date >= ${input.paidFrom}::date
        and issued_at::date < ${input.paidUntil}::date), 0)::int as paid`);
  return { duePaise: row?.due ?? 0, paidPaise: row?.paid ?? 0 };
}

/**
 * Each student's fees overdue on a date (invoices due before it, not paid, not written off), for
 * exam eligibility. Read-only; call inside the tenant after the caller's own permission check.
 */
export async function overdueOf(
  tx: Tx,
  studentIds: string[],
  onDate: string,
): Promise<Record<string, number>> {
  if (studentIds.length === 0) return {};
  const rows = await tx.execute<{ id: string; overdue: number }>(sql`
    select student_person_id::text as id, sum(total_paise - paid_paise)::int as overdue from fee_invoice
    where org_id = app_current_org() and state <> 'written_off' and due_on < ${onDate}::date
      and student_person_id = any(${`{${studentIds.join(',')}}`}::uuid[])
    group by student_person_id having sum(total_paise - paid_paise) > 0`);
  return Object.fromEntries(rows.map((r) => [r.id, r.overdue]));
}

/** Whether any of these students has an invoice due on or after a date (a new year already billed). */
export async function anyInvoicesFrom(
  tx: Tx,
  studentIds: string[],
  from: string,
): Promise<boolean> {
  if (studentIds.length === 0) return false;
  const [row] = await tx.execute(sql`
    select 1 from fee_invoice where org_id = app_current_org() and due_on >= ${from}::date
      and student_person_id = any(${`{${studentIds.join(',')}}`}::uuid[]) limit 1`);
  return !!row;
}

export type GroupFeeInput = {
  institutionId: string;
  /** One audience group, such as a transport fare zone. */
  groupId: string;
  name: string;
  head: { code: string; name: string; rteExempt: boolean };
  amountPaise: number;
  instalments: { label: string; dueOn: string; shareBp: number }[];
};

/**
 * One fee for one group, set from the module that owns the group (Transport sets each fare zone's
 * fee on its own screen). In one transaction: the head is added if missing, the group's plan gets
 * a new version (or is created) and is published, retiring the previous version. Invoices already
 * issued stay as they were; issuing new ones is the usual preview and commit.
 */
export async function setGroupFee(
  deps: FinanceDeps,
  actor: Actor,
  input: GroupFeeInput,
): Promise<{ planId: string; version: number }> {
  checkPlan({
    name: input.name,
    groupIds: [input.groupId],
    lines: [{ headId: 'x', amountPaise: input.amountPaise }],
    instalments: input.instalments,
    lateFeePaise: 0,
    graceDays: 0,
  });
  const place = await placeFor(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.plan.manage', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      // Only a group this institution's audience offers (a fare zone on its own campus).
      const offered = await deps.audience.groups(tx, input.institutionId, await today(tx));
      const group = offered.find((g) => g.id === input.groupId);
      if (!group) throw new FinanceError('group_not_found');
      const planName = input.name.trim() || group.label;
      await tx.execute(sql`
        insert into fee_head (org_id, institution_id, code, name, tax_class, rte_exempt, refundable)
        values (app_current_org(), ${input.institutionId}, ${input.head.code}, ${input.head.name}, 'education_exempt',
          ${input.head.rteExempt}, false)
        on conflict (org_id, institution_id, code) do nothing`);
      const [head] = await tx.execute<{ id: string }>(sql`
        select id::text from fee_head
        where org_id = app_current_org() and institution_id = ${input.institutionId} and code = ${input.head.code}`);
      if (!head) throw new Error('setGroupFee: no head');
      // The group's own plan: the one naming exactly this group (newest version first).
      const [family] = await tx.execute<{ familyId: string }>(sql`
        select family_id::text as "familyId" from fee_plan
        where org_id = app_current_org() and institution_id = ${input.institutionId}
          and group_ids = ${`{${input.groupId}}`}::uuid[]
        order by created_at desc limit 1 for update`);
      const [plan] = await tx.execute<{ id: string; version: number }>(
        family
          ? sql`
            insert into fee_plan (org_id, family_id, version, institution_id, name, group_ids, created_by_person_id)
            values (app_current_org(), ${family.familyId},
              (select max(version) + 1 from fee_plan where org_id = app_current_org() and family_id = ${family.familyId}),
              ${input.institutionId}, ${planName}, ${`{${input.groupId}}`}::uuid[], ${actor.personId})
            returning id::text, version`
          : sql`
            insert into fee_plan (org_id, family_id, institution_id, name, group_ids, created_by_person_id)
            values (app_current_org(), uuidv7(), ${input.institutionId}, ${planName},
              ${`{${input.groupId}}`}::uuid[], ${actor.personId})
            returning id::text, version`,
      );
      if (!plan) throw new Error('setGroupFee: no plan');
      const contents = {
        name: planName,
        groupIds: [input.groupId],
        lines: [{ headId: head.id, amountPaise: input.amountPaise }],
        instalments: input.instalments,
        lateFeePaise: 0,
        graceDays: 0,
      };
      await writeContents(tx, plan.id, contents);
      if (family)
        await tx.execute(sql`
          update fee_plan set state = 'retired'
          where org_id = app_current_org() and family_id = ${family.familyId} and state in ('published', 'draft')
            and id <> ${plan.id}`);
      await tx.execute(sql`
        update fee_plan set state = 'published', published_by_person_id = ${actor.personId}, published_at = now()
        where org_id = app_current_org() and id = ${plan.id}`);
      return {
        result: { planId: plan.id, version: plan.version },
        audit: {
          action: 'finance.plan.manage',
          entityType: 'fee_plan',
          entityId: plan.id,
          dataClass: 'operational',
          detail: {
            version: plan.version,
            groupId: input.groupId,
            amountPaise: input.amountPaise,
            instalments: input.instalments.length,
            published: true,
          },
        },
      };
    },
  );
}

export type GroupFee = {
  groupId: string;
  planId: string;
  name: string;
  version: number;
  totalPaise: number;
  instalments: { label: string; dueOn: string; shareBp: number }[];
  /** Students invoiced on this plan family so far. */
  billed: number;
};

/** The published fee of each group that has a plan of its own (one group per plan). */
export async function groupFees(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
  groupIds: string[],
): Promise<GroupFee[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    if (groupIds.length === 0) return [];
    const rows = await tx.execute<
      Omit<GroupFee, 'instalments' | 'totalPaise'> & { totalPaise: string }
    >(sql`
      select p.group_ids[1]::text as "groupId", p.id::text as "planId", p.name, p.version,
        coalesce((select sum(amount_paise) from fee_plan_line where org_id = p.org_id and plan_id = p.id), 0)::text as "totalPaise",
        (select count(distinct student_person_id) from fee_invoice where org_id = p.org_id and plan_family_id = p.family_id)::int as billed
      from fee_plan p
      where p.org_id = app_current_org() and p.institution_id = ${institutionId} and p.state = 'published'
        and cardinality(p.group_ids) = 1 and p.group_ids[1] = any(${`{${groupIds.join(',')}}`}::uuid[])`);
    const out: GroupFee[] = [];
    for (const r of rows) {
      const insts = await tx.execute<GroupFee['instalments'][number]>(sql`
        select label, due_on::text as "dueOn", share_bp as "shareBp" from fee_instalment
        where org_id = app_current_org() and plan_id = ${r.planId} order by seq`);
      out.push({ ...r, totalPaise: Number(r.totalPaise), instalments: [...insts] });
    }
    return out;
  });
}

export type FinanceSummary = {
  billedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  students: number;
  /** Billed students who owe nothing now. */
  cleared: number;
};

/** Everything billed, collected and still owed at the school, for the dashboard. */
export async function financeSummary(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<FinanceSummary> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    const [r] = await tx.execute<Record<keyof FinanceSummary, string>>(sql`
      select coalesce(sum(total_paise), 0)::text as "billedPaise",
        coalesce(sum(least(paid_paise, total_paise)), 0)::text as "collectedPaise",
        coalesce(sum(greatest(total_paise - paid_paise, 0)), 0)::text as "outstandingPaise",
        coalesce(sum(greatest(total_paise - paid_paise, 0)) filter (where due_on < app_today()), 0)::text as "overduePaise",
        count(distinct student_person_id)::text as students,
        (select count(*) from (
          select student_person_id from fee_invoice
          where org_id = app_current_org() and institution_id = ${institutionId}
            and state not in ('written_off', 'adjusted')
          group by student_person_id having sum(greatest(total_paise - paid_paise, 0)) = 0) c)::text as cleared
      from fee_invoice
      where org_id = app_current_org() and institution_id = ${institutionId}
        and state not in ('written_off', 'adjusted')`);
    return {
      billedPaise: Number(r?.billedPaise ?? 0),
      collectedPaise: Number(r?.collectedPaise ?? 0),
      outstandingPaise: Number(r?.outstandingPaise ?? 0),
      overduePaise: Number(r?.overduePaise ?? 0),
      students: Number(r?.students ?? 0),
      cleared: Number(r?.cleared ?? 0),
    };
  });
}
