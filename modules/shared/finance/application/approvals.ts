// Concessions, refunds and reversals: one person asks, a different person decides (maker-checker).
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command, emit, type EventInput } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import {
  approvalStates,
  decideApproval,
  startApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import { sql } from 'drizzle-orm';
import { rupees } from '../domain/money.js';
import {
  DATE,
  FinanceError,
  institution,
  issueReceipt,
  PAYMENT_REVERSED,
  placeOf,
  refreshInvoice,
  REFUND_ISSUED,
  today,
  type FinanceDeps,
} from './common.js';
import { applyConcessions } from './plans.js';

/** Where a student is billed, for the permission check; a student with no invoices can't have fees changed. */
async function studentPlace(tx: Tx, studentId: string) {
  const [i] = await tx.execute<{ institutionId: string }>(sql`
    select institution_id::text as "institutionId" from fee_invoice
    where org_id = app_current_org() and student_person_id = ${studentId} order by due_on desc limit 1`);
  if (!i) throw new FinanceError('no_invoices');
  return placeOf(await institution(tx, i.institutionId));
}

async function paymentPlace(tx: Tx, paymentId: string) {
  const [p] = await tx.execute<{ institutionId: string }>(sql`
    select institution_id::text as "institutionId" from fee_payment where org_id = app_current_org() and id = ${paymentId}`);
  if (!p) throw new FinanceError('payment_not_found');
  return placeOf(await institution(tx, p.institutionId));
}

/** Refunds are decided through the shared approval engine, with amount limits (§12.4 decision 6). */
const REFUND = 'finance.refund';

const notSelf = (requestedBy: string, actor: Actor) => {
  if (requestedBy === actor.personId) throw new FinanceError('maker_cannot_approve');
};

export type ConcessionInput = {
  studentId: string;
  headId: string | null;
  kind: 'percent' | 'amount';
  value: number;
  category: 'rte' | 'staff_child' | 'sibling' | 'merit' | 'need' | 'other';
  from: string;
  to: string;
  reason: string;
};

export async function requestConcession(
  deps: FinanceDeps,
  actor: Actor,
  input: ConcessionInput,
): Promise<{ id: string }> {
  if (!DATE.test(input.from) || !DATE.test(input.to) || input.to < input.from)
    throw new FinanceError('bad_dates');
  if (
    !Number.isSafeInteger(input.value) ||
    input.value <= 0 ||
    (input.kind === 'percent' && input.value > 10_000)
  ) {
    throw new FinanceError('bad_amount');
  }
  if (input.reason.trim().length < 3) throw new FinanceError('reason_required');
  const place = await withTenant(deps.db, actor.orgId, (tx) => studentPlace(tx, input.studentId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'finance.concession.request',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.studentId },
    },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_concession (org_id, student_person_id, head_id, kind, value, category, valid_during, reason,
          requested_by_person_id)
        values (app_current_org(), ${input.studentId}, ${input.headId}, ${input.kind}, ${input.value}, ${input.category},
          daterange(${input.from}::date, ${input.to}::date, '[]'), ${input.reason.trim()}, ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('requestConcession: no row');
      return {
        result: row,
        audit: {
          action: 'finance.concession.request',
          entityType: 'fee_concession',
          entityId: row.id,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: {
            studentId: input.studentId,
            kind: input.kind,
            value: input.value,
            category: input.category,
          },
        },
      };
    },
  );
}

/** Approving applies the concession to the student's unpaid invoices in its dates. */
export async function decideConcession(
  deps: FinanceDeps,
  actor: Actor,
  input: { concessionId: string; approve: boolean; note?: string | null | undefined },
): Promise<void> {
  if (!input.approve && (input.note ?? '').trim().length < 3)
    throw new FinanceError('note_required');
  const c = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ studentId: string; requestedBy: string }>(sql`
      select student_person_id::text as "studentId", requested_by_person_id::text as "requestedBy"
      from fee_concession where org_id = app_current_org() and id = ${input.concessionId} and state = 'requested'`);
    if (!row) throw new FinanceError('concession_not_found');
    return { ...row, place: await studentPlace(tx, row.studentId) };
  });
  notSelf(c.requestedBy, actor);
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'finance.concession.approve',
      resource: { orgId: actor.orgId, place: c.place, subjectPersonId: c.studentId },
    },
    async (tx) => {
      const [row] = await tx.execute(sql`
        update fee_concession set state = ${input.approve ? 'approved' : 'rejected'}, decided_by_person_id = ${actor.personId},
          decided_at = now(), note = ${input.note?.trim() || null}
        where org_id = app_current_org() and id = ${input.concessionId} and state = 'requested' returning 1`);
      if (!row) throw new FinanceError('concession_not_found');
      if (input.approve) {
        const open = await tx.execute<{ id: string; dueOn: string }>(sql`
          select id::text, due_on::text as "dueOn" from fee_invoice
          where org_id = app_current_org() and student_person_id = ${c.studentId} and paid_paise = 0 and state <> 'written_off'`);
        for (const i of open) {
          await applyConcessions(tx, i.id, c.studentId, i.dueOn);
          await refreshInvoice(tx, i.id);
        }
      }
      return {
        result: undefined,
        audit: {
          action: 'finance.concession.approve',
          entityType: 'fee_concession',
          entityId: input.concessionId,
          dataClass: 'personal',
          ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
          detail: { decision: input.approve ? 'approved' : 'rejected' },
        },
      };
    },
  );
}

/** Paid minus what is already refunded or asked for: a refund can never exceed it. */
async function refundable(tx: Tx, paymentId: string) {
  const [r] = await tx.execute<{
    state: string;
    amount: number;
    taken: number;
    studentId: string;
    legalEntityId: string;
  }>(sql`
    select p.state, p.amount_paise::int as amount, p.student_person_id::text as "studentId", p.legal_entity_id::text as "legalEntityId",
      coalesce((select sum(amount_paise) from fee_refund f where f.org_id = p.org_id and f.payment_id = p.id
        and f.state <> 'rejected'), 0)::int as taken
    from fee_payment p where p.org_id = app_current_org() and p.id = ${paymentId} for update`);
  if (!r) throw new FinanceError('payment_not_found');
  return r;
}

export async function requestRefund(
  deps: FinanceDeps,
  actor: Actor,
  input: { paymentId: string; amountPaise: number; reason: string },
): Promise<{ id: string }> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new FinanceError('bad_amount');
  if (input.reason.trim().length < 3) throw new FinanceError('reason_required');
  const place = await withTenant(deps.db, actor.orgId, (tx) => paymentPlace(tx, input.paymentId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.refund.request', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const r = await refundable(tx, input.paymentId);
      if (r.state !== 'succeeded') throw new FinanceError('not_refundable');
      if (input.amountPaise > r.amount - r.taken)
        throw new FinanceError('more_than_paid', { leftPaise: r.amount - r.taken });
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_refund (org_id, payment_id, amount_paise, reason, requested_by_person_id)
        values (app_current_org(), ${input.paymentId}, ${input.amountPaise}, ${input.reason.trim()}, ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('requestRefund: no row');
      const student = (await displayNames(tx, [r.studentId]))[r.studentId] ?? '';
      await startApproval(tx, {
        process: REFUND,
        subjectId: row.id,
        institutionId: place.institutionId,
        amountPaise: input.amountPaise,
        summary: `${student} · refund · ${rupees(input.amountPaise)}`,
        requestedBy: actor.personId,
      });
      return {
        result: row,
        audit: {
          action: 'finance.refund.request',
          entityType: 'fee_refund',
          entityId: row.id,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: { amountPaise: input.amountPaise },
        },
      };
    },
  );
}

/**
 * Decides the current approval step of a refund through the shared engine (the designer can add
 * steps above an amount). The last approval records the payout (bank or UPI reference) and issues
 * a refund voucher with the next receipt number; the original receipt is untouched. Money leaves
 * the school's books only there, so the payout reference is required at that step.
 */
export async function decideRefund(
  deps: FinanceDeps,
  actor: Actor,
  input: {
    refundId: string;
    approve: boolean;
    payoutRef?: string | null | undefined;
    note?: string | null | undefined;
  },
): Promise<'paid' | 'rejected' | 'pending'> {
  const note = input.note?.trim() || null;
  const payoutRef = input.payoutRef?.trim() || null;
  if (!input.approve && (note ?? '').length < 3) throw new FinanceError('note_required');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [f] = await tx.execute<{ paymentId: string; requestedBy: string; amount: number }>(sql`
      select payment_id::text as "paymentId", requested_by_person_id::text as "requestedBy",
        amount_paise::int as amount
      from fee_refund where org_id = app_current_org() and id = ${input.refundId} and state = 'requested'
      for update`);
    if (!f) throw new FinanceError('refund_not_found');
    notSelf(f.requestedBy, actor);
    const a = (await approvalStates(tx, deps.permissions, actor, REFUND, [input.refundId]))[
      input.refundId
    ];
    if (input.approve && a && a.step === a.steps && !payoutRef)
      throw new FinanceError('payout_ref_required');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: REFUND,
      subjectId: input.refundId,
      approve: input.approve,
      note,
    });
    if (outcome === 'pending') {
      await writeAudit(tx, actor, {
        action: 'finance.refund.step_approve',
        entityType: 'fee_refund',
        entityId: input.refundId,
        dataClass: 'personal',
        detail: { amountPaise: f.amount, step: a?.step ?? null },
      });
      return outcome;
    }
    const paid = outcome === 'approved';
    await tx.execute(sql`
      update fee_refund set state = ${paid ? 'paid' : 'rejected'}, decided_by_person_id = ${actor.personId},
        decided_at = now(), payout_ref = ${paid ? payoutRef : null}, paid_at = ${paid ? sql`now()` : null}
      where org_id = app_current_org() and id = ${input.refundId}`);
    if (paid) {
      const p = await refundable(tx, f.paymentId);
      const voucher = await issueReceipt(tx, actor, {
        kind: 'refund',
        legalEntityId: p.legalEntityId,
        paymentId: f.paymentId,
        refundId: input.refundId,
        studentId: p.studentId,
        amountPaise: -f.amount,
        snapshot: { payoutRef, total: rupees(f.amount), totalPaise: f.amount },
      });
      if (p.taken >= p.amount) {
        await tx.execute(
          sql`update fee_payment set state = 'refunded' where org_id = app_current_org() and id = ${f.paymentId}`,
        );
      }
      await emit(tx, {
        type: REFUND_ISSUED,
        payload: {
          refundId: input.refundId,
          paymentId: f.paymentId,
          voucherId: voucher.id,
          amountPaise: f.amount,
        },
      });
    }
    await writeAudit(tx, actor, {
      action: 'finance.refund.approve',
      entityType: 'fee_refund',
      entityId: input.refundId,
      dataClass: 'personal',
      ...(note ? { reason: note } : {}),
      detail: { decision: paid ? 'paid' : 'rejected', amountPaise: f.amount },
    });
    return paid ? 'paid' : 'rejected';
  });
}

/** A bounced cheque or a wrong collection. A different person approves; then the receipt is reversed. */
export async function requestReversal(
  deps: FinanceDeps,
  actor: Actor,
  input: { paymentId: string; reason: string; chargePaise: number },
): Promise<{ id: string }> {
  if (input.reason.trim().length < 3) throw new FinanceError('reason_required');
  if (!Number.isSafeInteger(input.chargePaise) || input.chargePaise < 0)
    throw new FinanceError('bad_amount');
  const place = await withTenant(deps.db, actor.orgId, (tx) => paymentPlace(tx, input.paymentId));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.reversal.request', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const p = await refundable(tx, input.paymentId);
      if (p.state !== 'succeeded' || p.taken > 0) throw new FinanceError('not_reversible');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into fee_reversal (org_id, payment_id, reason, charge_paise, requested_by_person_id)
        values (app_current_org(), ${input.paymentId}, ${input.reason.trim()}, ${input.chargePaise}, ${actor.personId})
        on conflict do nothing returning id::text`);
      if (!row) throw new FinanceError('reversal_open');
      return {
        result: row,
        audit: {
          action: 'finance.reversal.request',
          entityType: 'fee_reversal',
          entityId: row.id,
          dataClass: 'personal',
          reason: input.reason.trim(),
          detail: { paymentId: input.paymentId, chargePaise: input.chargePaise },
        },
      };
    },
  );
}

/**
 * Approving takes the money back off the invoices (negative allocations), issues a credit note with
 * the next number, adds any bank charge to the latest invoice, and tells the parent.
 */
export async function decideReversal(
  deps: FinanceDeps,
  actor: Actor,
  input: { reversalId: string; approve: boolean; note?: string | null | undefined },
): Promise<void> {
  const r = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{
      paymentId: string;
      requestedBy: string;
      charge: number;
      reason: string;
    }>(sql`
      select payment_id::text as "paymentId", requested_by_person_id::text as "requestedBy", charge_paise::int as charge, reason
      from fee_reversal where org_id = app_current_org() and id = ${input.reversalId} and state = 'requested'`);
    if (!row) throw new FinanceError('reversal_not_found');
    return { ...row, place: await paymentPlace(tx, row.paymentId) };
  });
  notSelf(r.requestedBy, actor);
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.reversal.approve', resource: { orgId: actor.orgId, place: r.place } },
    async (tx) => {
      const [row] = await tx.execute(sql`
        update fee_reversal set state = ${input.approve ? 'approved' : 'rejected'}, decided_by_person_id = ${actor.personId},
          decided_at = now()
        where org_id = app_current_org() and id = ${input.reversalId} and state = 'requested' returning 1`);
      if (!row) throw new FinanceError('reversal_not_found');
      const events: EventInput[] = [];
      if (input.approve) {
        const p = await refundable(tx, r.paymentId);
        if (p.state !== 'succeeded') throw new FinanceError('not_reversible');
        // Undone share by share, so money held for the university goes back down with it.
        const allocations = await tx.execute<{
          invoiceId: string;
          payeeId: string | null;
          amount: number;
        }>(sql`
          select invoice_id::text as "invoiceId", payee_id::text as "payeeId", sum(amount_paise)::int as amount
          from fee_allocation
          where org_id = app_current_org() and payment_id = ${r.paymentId}
          group by invoice_id, payee_id having sum(amount_paise) > 0 order by invoice_id`);
        for (const a of allocations) {
          await tx.execute(sql`
            insert into fee_allocation (org_id, payment_id, invoice_id, amount_paise, payee_id)
            values (app_current_org(), ${r.paymentId}, ${a.invoiceId}, ${-a.amount}, ${a.payeeId})`);
        }
        for (const invoiceId of new Set(allocations.map((a) => a.invoiceId)))
          await refreshInvoice(tx, invoiceId);
        const last = allocations.at(-1);
        if (r.charge > 0 && last) {
          await tx.execute(sql`
            insert into fee_invoice_line (org_id, invoice_id, kind, amount_paise, reason, created_by_person_id)
            values (app_current_org(), ${last.invoiceId}, 'bounce_charge', ${r.charge}, ${r.reason}, ${actor.personId})`);
          await refreshInvoice(tx, last.invoiceId);
        }
        await tx.execute(sql`
          update fee_payment set state = 'reversed', credit_paise = 0 where org_id = app_current_org() and id = ${r.paymentId}`);
        const note = await issueReceipt(tx, actor, {
          kind: 'reversal',
          legalEntityId: p.legalEntityId,
          paymentId: r.paymentId,
          studentId: p.studentId,
          amountPaise: -p.amount,
          snapshot: {
            reason: r.reason,
            chargePaise: r.charge,
            total: rupees(-p.amount),
            totalPaise: -p.amount,
          },
        });
        events.push({
          type: PAYMENT_REVERSED,
          payload: {
            paymentId: r.paymentId,
            studentId: p.studentId,
            creditNoteId: note.id,
            amountPaise: p.amount,
            chargePaise: r.charge,
            onDate: await today(tx),
          },
        });
      }
      return {
        result: undefined,
        audit: {
          action: 'finance.reversal.approve',
          entityType: 'fee_reversal',
          entityId: input.reversalId,
          dataClass: 'personal',
          ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
          detail: { decision: input.approve ? 'approved' : 'rejected' },
        },
        events,
      };
    },
  );
}

export type Approval = {
  kind: 'concession' | 'refund' | 'reversal';
  id: string;
  studentId: string;
  student: string;
  detail: string;
  amountPaise: number | null;
  reason: string;
  requestedBy: string;
  requestedById: string;
  at: string;
  /** Refunds: the approval in the shared engine (step, who decides, whether the viewer may). */
  approval: ApprovalState | null;
};

/** Everything waiting for a checker in one institution. The maker's own requests are marked, not hidden. */
export async function pendingApprovals(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<Approval[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = placeOf(await institution(tx, institutionId));
    const can = async (p: string) =>
      (await deps.permissions.can(tx, actor, p, { orgId: actor.orgId, place })).allowed;
    const [concessions, refunds, reversals] = await Promise.all([
      can('finance.concession.approve'),
      can('finance.refund.approve'),
      can('finance.reversal.approve'),
    ]);
    if (!concessions && !refunds && !reversals) {
      await deps.permissions.assertCan(tx, actor, 'finance.concession.approve', {
        orgId: actor.orgId,
        place,
      });
    }
    const rows = await tx.execute<Omit<Approval, 'approval'>>(sql`
      select 'concession' as kind, c.id::text, c.student_person_id::text as "studentId", s.legal_name as student,
        c.kind || ':' || c.value || ':' || c.category as detail, null::int as "amountPaise", c.reason,
        m.legal_name as "requestedBy", c.requested_by_person_id::text as "requestedById", c.created_at::text as at
      from fee_concession c join person s on s.org_id = c.org_id and s.id = c.student_person_id
      join person m on m.org_id = c.org_id and m.id = c.requested_by_person_id
      where c.org_id = app_current_org() and c.state = 'requested' and ${concessions}
        and exists (select 1 from fee_invoice i where i.org_id = c.org_id and i.student_person_id = c.student_person_id
          and i.institution_id = ${institutionId})
      union all
      select 'refund', f.id::text, p.student_person_id::text, s.legal_name, 'refund', f.amount_paise::int, f.reason,
        m.legal_name, f.requested_by_person_id::text, f.created_at::text
      from fee_refund f join fee_payment p on p.org_id = f.org_id and p.id = f.payment_id
      join person s on s.org_id = p.org_id and s.id = p.student_person_id
      join person m on m.org_id = f.org_id and m.id = f.requested_by_person_id
      where f.org_id = app_current_org() and f.state = 'requested' and p.institution_id = ${institutionId} and ${refunds}
      union all
      select 'reversal', v.id::text, p.student_person_id::text, s.legal_name, 'reversal', p.amount_paise::int, v.reason,
        m.legal_name, v.requested_by_person_id::text, v.created_at::text
      from fee_reversal v join fee_payment p on p.org_id = v.org_id and p.id = v.payment_id
      join person s on s.org_id = p.org_id and s.id = p.student_person_id
      join person m on m.org_id = v.org_id and m.id = v.requested_by_person_id
      where v.org_id = app_current_org() and v.state = 'requested' and p.institution_id = ${institutionId} and ${reversals}
      order by at`);
    const approvals = await approvalStates(
      tx,
      deps.permissions,
      actor,
      REFUND,
      rows.filter((r) => r.kind === 'refund').map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, approval: approvals[r.id] ?? null }));
  });
}
