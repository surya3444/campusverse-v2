import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit } from '@campusverse/platform-audit';
import { command, emit } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { allocate, rupees } from '../domain/money.js';
import {
  allocateToInvoice,
  FinanceError,
  institution,
  issueReceipt,
  ONLINE_PAYMENT_STARTED,
  PAYMENT_SUCCEEDED,
  payeeNames,
  placeOf,
  refreshInvoice,
  today,
  type FinanceDeps,
  type PlacementLookup,
} from './common.js';
import { parseWebhook, type Gateway } from './gateway.js';

type OpenInvoice = {
  id: string;
  label: string;
  balance: number;
  legalEntityId: string;
  institutionId: string;
};

/** A student's unpaid invoices, oldest due first: the school's allocation rule. */
async function openInvoices(tx: Tx, studentId: string): Promise<OpenInvoice[]> {
  return [
    ...(await tx.execute<OpenInvoice>(sql`
      select id::text, label, (total_paise - paid_paise)::int as balance, legal_entity_id::text as "legalEntityId",
        institution_id::text as "institutionId"
      from fee_invoice
      where org_id = app_current_org() and student_person_id = ${studentId} and paid_paise < total_paise
        and state <> 'written_off'
      order by due_on, instalment_seq, id`)),
  ];
}

/** Late fees, once per invoice, on invoices past their due date and grace days. */
async function applyLateFees(tx: Tx, studentId: string) {
  const late = await tx.execute<{ id: string; fee: number }>(sql`
    select i.id::text, p.late_fee_paise::int as fee from fee_invoice i
    join fee_plan p on p.org_id = i.org_id and p.id = i.plan_id
    where i.org_id = app_current_org() and i.student_person_id = ${studentId} and not i.late_fee_applied
      and i.paid_paise < i.total_paise and p.late_fee_paise > 0 and i.due_on + p.grace_days < app_today()
    for update of i`);
  for (const l of late) {
    await tx.execute(sql`
      insert into fee_invoice_line (org_id, invoice_id, kind, amount_paise, reason)
      values (app_current_org(), ${l.id}, 'late_fee', ${l.fee}, 'Paid after the due date')`);
    await tx.execute(
      sql`update fee_invoice set late_fee_applied = true where org_id = app_current_org() and id = ${l.id}`,
    );
    await refreshInvoice(tx, l.id);
  }
}

/** Where a student is billed: the institution of their open invoices. */
async function studentPlace(deps: FinanceDeps, actor: Actor, studentId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [i] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from fee_invoice
      where org_id = app_current_org() and student_person_id = ${studentId} order by due_on desc limit 1`);
    if (!i) throw new FinanceError('no_invoices');
    return placeOf(await institution(tx, i.institutionId));
  });
}

/** Spreads money over open invoices, records the allocations, and issues the receipt. */
async function settle(
  tx: Tx,
  actor: Actor | null,
  p: {
    paymentId: string;
    studentId: string;
    amountPaise: number;
    method: string;
    instrumentRef: string | null;
  },
  placements: PlacementLookup[] = [],
) {
  const invoices = await openInvoices(tx, p.studentId);
  const first = invoices[0];
  if (!first) throw new FinanceError('nothing_due');
  // One legal entity per payment and receipt: a sibling at another entity is billed separately.
  const sameEntity = invoices.filter((i) => i.legalEntityId === first.legalEntityId);
  const { allocations, credit } = allocate(
    p.amountPaise,
    sameEntity.map((i) => ({ invoiceId: i.id, balance: i.balance })),
  );
  // Each invoice's share is split by who it is collected for (the university first).
  const forOthers = new Map<string, number>();
  for (const a of allocations) {
    for (const part of await allocateToInvoice(tx, p.paymentId, a.invoiceId, a.amount)) {
      if (part.payeeId)
        forOthers.set(part.payeeId, (forOthers.get(part.payeeId) ?? 0) + part.amount);
    }
    await refreshInvoice(tx, a.invoiceId);
  }
  const names = await payeeNames(tx, [...forOthers.keys()]);
  await tx.execute(sql`
    update fee_payment set state = 'succeeded', succeeded_at = now(), credit_paise = ${credit},
      legal_entity_id = ${first.legalEntityId}, institution_id = ${first.institutionId}
    where org_id = app_current_org() and id = ${p.paymentId}`);
  const inst = await institution(tx, first.institutionId);
  const [student] = await tx.execute<{ name: string }>(sql`
    select legal_name as name from person where org_id = app_current_org() and id = ${p.studentId}`);
  const labels = new Map(sameEntity.map((i) => [i.id, i.label]));
  // Frozen on the receipt: the class and admission number on the day it was paid.
  const lookup = { personIds: [p.studentId], onDate: await today(tx) };
  const place = (await Promise.all(placements.map((pl) => pl.getPlacements(tx, lookup))))
    .map((m) => m.get(p.studentId))
    .find((x) => x !== undefined);
  const owedBefore = invoices.reduce((a, i) => a + i.balance, 0);
  const allocated = allocations.reduce((a, x) => a + x.amount, 0);
  const receipt = await issueReceipt(tx, actor, {
    kind: 'receipt',
    legalEntityId: first.legalEntityId,
    paymentId: p.paymentId,
    studentId: p.studentId,
    amountPaise: p.amountPaise,
    snapshot: {
      entity: inst.legalEntityName,
      institution: inst.name,
      student: student?.name ?? '',
      placement: place?.displayLabel ?? null,
      admissionNumber: place?.reference ?? null,
      balanceAfterPaise: owedBefore - allocated,
      method: p.method,
      instrumentRef: p.instrumentRef,
      lines: allocations.map((a) => ({
        invoice: labels.get(a.invoiceId) ?? '',
        amountPaise: a.amount,
      })),
      creditPaise: credit,
      // Money collected for others inside this payment (the rest is the institution's own).
      forOthers: [...forOthers].map(([id, amountPaise]) => ({
        payee: names.get(id)?.shortName ?? '',
        payeeName: names.get(id)?.name ?? '',
        amountPaise,
      })),
      totalPaise: p.amountPaise,
      total: rupees(p.amountPaise),
    },
  });
  await emit(tx, {
    type: PAYMENT_SUCCEEDED,
    payload: {
      paymentId: p.paymentId,
      studentId: p.studentId,
      receiptId: receipt.id,
      amountPaise: p.amountPaise,
    },
  });
  return receipt;
}

export type Collected = {
  paymentId: string;
  receiptId: string;
  receiptNumber: string;
  creditPaise: number;
};

async function byIdempotencyKey(
  deps: FinanceDeps,
  actor: Actor,
  key: string,
): Promise<Collected | null> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<Collected>(sql`
      select p.id::text as "paymentId", r.id::text as "receiptId", r.snapshot ->> 'number' as "receiptNumber",
        p.credit_paise::int as "creditPaise"
      from fee_payment p join fee_receipt r on r.org_id = p.org_id and r.payment_id = p.id and r.kind = 'receipt'
      where p.org_id = app_current_org() and p.idempotency_key = ${key}`);
    return row ?? null;
  });
}

/**
 * Collects at the counter (cash, cheque, UPI or card) and issues the receipt at once. The client
 * sends an Idempotency-Key: a retried request returns the same receipt, never a second one.
 */
export async function collectPayment(
  deps: FinanceDeps,
  actor: Actor,
  input: {
    studentId: string;
    amountPaise: number;
    method: 'cash' | 'cheque' | 'upi' | 'card';
    instrumentRef?: string | null | undefined;
    idempotencyKey: string;
  },
): Promise<Collected> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new FinanceError('bad_amount');
  if (input.method === 'cheque' && !input.instrumentRef?.trim())
    throw new FinanceError('cheque_number_required');
  const done = await byIdempotencyKey(deps, actor, input.idempotencyKey);
  if (done) return done;
  const place = await studentPlace(deps, actor, input.studentId);
  try {
    return await command(
      deps.db,
      deps.permissions,
      actor,
      { permission: 'finance.payment.collect', resource: { orgId: actor.orgId, place } },
      async (tx) => {
        const d = await today(tx);
        const [closed] = await tx.execute(sql`
          select 1 from fee_day_close where org_id = app_current_org() and cashier_person_id = ${actor.personId}
            and on_date = ${d}::date`);
        if (closed) throw new FinanceError('day_closed');
        await applyLateFees(tx, input.studentId);
        const first = (await openInvoices(tx, input.studentId))[0];
        if (!first) throw new FinanceError('nothing_due');
        const [payment] = await tx.execute<{ id: string }>(sql`
          insert into fee_payment (org_id, legal_entity_id, institution_id, student_person_id, amount_paise, method, state,
            idempotency_key, instrument_ref, collected_by_person_id, collected_on)
          values (app_current_org(), ${first.legalEntityId}, ${first.institutionId}, ${input.studentId}, ${input.amountPaise},
            ${input.method}, 'pending', ${input.idempotencyKey}, ${input.instrumentRef?.trim() || null}, ${actor.personId}, ${d}::date)
          returning id::text`);
        if (!payment) throw new Error('collect: no payment');
        const receipt = await settle(
          tx,
          actor,
          {
            paymentId: payment.id,
            studentId: input.studentId,
            amountPaise: input.amountPaise,
            method: input.method,
            instrumentRef: input.instrumentRef?.trim() || null,
          },
          deps.placements,
        );
        const [p] = await tx.execute<{ credit: number }>(sql`
          select credit_paise::int as credit from fee_payment where org_id = app_current_org() and id = ${payment.id}`);
        return {
          result: {
            paymentId: payment.id,
            receiptId: receipt.id,
            receiptNumber: receipt.number,
            creditPaise: p?.credit ?? 0,
          },
          audit: {
            action: 'finance.payment.collect',
            entityType: 'fee_payment',
            entityId: payment.id,
            dataClass: 'personal',
            detail: {
              amountPaise: input.amountPaise,
              method: input.method,
              receipt: receipt.number,
            },
          },
        };
      },
    );
  } catch (e) {
    // The same key at the same moment from a double tap: the first wins, the second gets its receipt.
    const err = e as { code?: string; cause?: { code?: string } };
    if ((err.cause?.code ?? err.code) === '23505') {
      const again = await byIdempotencyKey(deps, actor, input.idempotencyKey);
      if (again) return again;
    }
    throw e;
  }
}

export type OnlinePayment = { paymentId: string; url: string; amountPaise: number };

/**
 * Starts an online payment of everything due: a hosted payment link the parent opens. An open link
 * for the same amount is reused, so tapping Pay twice doesn't create two.
 */
export async function startOnlinePayment(
  deps: FinanceDeps,
  actor: Actor,
  input: { studentId: string },
): Promise<OnlinePayment> {
  const gateway = deps.gateway;
  if (!gateway) throw new FinanceError('online_payments_off');
  if (deps.onlinePaymentsAllowed && !(await deps.onlinePaymentsAllowed(actor.orgId)))
    throw new FinanceError('online_payments_off');
  const place = await studentPlace(deps, actor, input.studentId);
  const started = await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'finance.payment.pay',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.studentId },
    },
    async (tx) => {
      await applyLateFees(tx, input.studentId);
      const invoices = await openInvoices(tx, input.studentId);
      const first = invoices[0];
      if (!first) throw new FinanceError('nothing_due');
      const amount = invoices
        .filter((i) => i.legalEntityId === first.legalEntityId)
        .reduce((a, i) => a + i.balance, 0);
      const [open] = await tx.execute<{ id: string; url: string | null }>(sql`
        select id::text, pay_url as url from fee_payment
        where org_id = app_current_org() and student_person_id = ${input.studentId} and method = 'online'
          and state in ('initiated', 'pending') and amount_paise = ${amount} and created_at > now() - interval '1 day'
        order by created_at desc limit 1`);
      if (open?.url) {
        return {
          result: { paymentId: open.id, url: open.url, amountPaise: amount, reuse: true },
          audit: {
            action: 'finance.payment.pay',
            entityType: 'fee_payment',
            entityId: open.id,
            dataClass: 'personal',
            detail: { reused: true },
          },
        };
      }
      const [p] = await tx.execute<{ id: string }>(sql`
        insert into fee_payment (org_id, legal_entity_id, institution_id, student_person_id, amount_paise, method, state, gateway)
        values (app_current_org(), ${first.legalEntityId}, ${first.institutionId}, ${input.studentId}, ${amount}, 'online',
          'initiated', ${gateway.name})
        returning id::text`);
      if (!p) throw new Error('startOnlinePayment: no row');
      return {
        result: { paymentId: p.id, url: '', amountPaise: amount, reuse: false },
        audit: {
          action: 'finance.payment.pay',
          entityType: 'fee_payment',
          entityId: p.id,
          dataClass: 'personal',
          detail: { amountPaise: amount, studentId: input.studentId },
        },
      };
    },
  );
  if (started.reuse)
    return { paymentId: started.paymentId, url: started.url, amountPaise: started.amountPaise };

  // The gateway call is outside the transaction; the payment stays 'initiated' if it fails.
  let link: { id: string; url: string };
  try {
    link = await gateway.createLink({
      amountPaise: started.amountPaise,
      reference: started.paymentId,
      description: `School fees (${rupees(started.amountPaise)})`,
      returnUrl: deps.returnUrl,
    });
  } catch {
    await withTenant(deps.db, actor.orgId, (tx) =>
      tx.execute(
        sql`update fee_payment set state = 'failed' where org_id = app_current_org() and id = ${started.paymentId}`,
      ),
    );
    throw new FinanceError('gateway_unavailable');
  }
  await withTenant(deps.db, actor.orgId, async (tx) => {
    await tx.execute(sql`
      update fee_payment set state = 'pending', gateway_ref = ${link.id}, pay_url = ${link.url}
      where org_id = app_current_org() and id = ${started.paymentId}`);
    await tx.execute(sql`
      insert into ops.payment_ref (gateway, reference, org_id, payment_id)
      values (${gateway.name}, ${link.id}, app_current_org(), ${started.paymentId}) on conflict do nothing`);
    await emit(tx, { type: ONLINE_PAYMENT_STARTED, payload: { paymentId: started.paymentId } });
  });
  return { paymentId: started.paymentId, url: link.url, amountPaise: started.amountPaise };
}

/**
 * Marks an online payment paid and issues its receipt, once. Called by webhooks (repeatable) and by
 * the fallback status check. A paid amount that differs from what was asked goes to reconciliation.
 */
export async function completeOnlinePayment(
  db: Db,
  orgId: string,
  paymentId: string,
  amountPaidPaise: number,
  source: 'webhook' | 'status_check',
  placements: PlacementLookup[] = [],
): Promise<'applied' | 'duplicate' | 'unmatched'> {
  return withTenant(db, orgId, async (tx) => {
    const [p] = await tx.execute<{ state: string; amount: number; studentId: string }>(sql`
      select state, amount_paise::int as amount, student_person_id::text as "studentId" from fee_payment
      where org_id = app_current_org() and id = ${paymentId} for update`);
    if (!p) return 'unmatched';
    if (['succeeded', 'reversed', 'refunded', 'unmatched'].includes(p.state)) return 'duplicate';
    const audit = (detail: Record<string, string | number>) =>
      writeAudit(tx, null, {
        action: 'finance.payment.pay',
        entityType: 'fee_payment',
        entityId: paymentId,
        dataClass: 'personal',
        detail,
      });
    if (amountPaidPaise !== p.amount) {
      await tx.execute(
        sql`update fee_payment set state = 'unmatched' where org_id = app_current_org() and id = ${paymentId}`,
      );
      await audit({ outcome: 'unmatched', paidPaise: amountPaidPaise, source });
      return 'unmatched';
    }
    const receipt = await settle(
      tx,
      null,
      {
        paymentId,
        studentId: p.studentId,
        amountPaise: p.amount,
        method: 'online',
        instrumentRef: null,
      },
      placements,
    );
    await audit({ outcome: 'succeeded', receipt: receipt.number, source });
    return 'applied';
  });
}

/**
 * A gateway webhook: verified on the raw body, recorded once by event id, then applied. Applying is
 * itself idempotent, so a resend, or two different events for the same payment, give one receipt.
 */
export async function handleWebhook(
  db: Db,
  gateway: Gateway,
  input: { rawBody: Buffer; signature: string; eventId: string },
  placements: PlacementLookup[] = [],
): Promise<'applied' | 'duplicate' | 'unmatched' | 'ignored' | 'bad_signature'> {
  if (!input.signature || !gateway.verify(input.rawBody, input.signature)) return 'bad_signature';
  const event = parseWebhook(input.rawBody, input.eventId);
  const [fresh] = await db.execute(sql`
    insert into ops.webhook_event (gateway, event_id, outcome) values (${gateway.name}, ${event.eventId}, 'processing')
    on conflict do nothing returning 1`);
  const record = (outcome: string) =>
    db.execute(
      sql`update ops.webhook_event set outcome = ${outcome} where gateway = ${gateway.name} and event_id = ${event.eventId}`,
    );
  if (event.type !== 'payment_link.paid' || !event.linkId) {
    await record('ignored');
    return 'ignored';
  }
  const [ref] = await db.execute<{ orgId: string; paymentId: string }>(sql`
    select org_id::text as "orgId", payment_id::text as "paymentId" from ops.payment_ref
    where gateway = ${gateway.name} and reference = ${event.linkId}`);
  if (!ref) {
    await record('unmatched');
    return 'unmatched';
  }
  const outcome = await completeOnlinePayment(
    db,
    ref.orgId,
    ref.paymentId,
    event.amountPaidPaise,
    'webhook',
    placements,
  );
  // A resent event is applied again harmlessly; only the first records its own outcome.
  if (fresh) await record(outcome);
  return outcome;
}

/** The fallback status check: asks the gateway directly when a webhook is late or lost. */
export async function checkOnlinePayment(
  db: Db,
  gateway: Gateway,
  orgId: string,
  paymentId: string,
  placements: PlacementLookup[] = [],
): Promise<'applied' | 'duplicate' | 'unmatched' | 'pending' | 'failed'> {
  const p = await withTenant(db, orgId, async (tx) => {
    const [row] = await tx.execute<{ state: string; ref: string | null }>(sql`
      select state, gateway_ref as ref from fee_payment where org_id = app_current_org() and id = ${paymentId}`);
    return row ?? null;
  });
  if (!p?.ref || p.state !== 'pending') return 'duplicate';
  const status = await gateway.fetchLink(p.ref);
  if (status.status === 'paid')
    return completeOnlinePayment(
      db,
      orgId,
      paymentId,
      status.amountPaidPaise,
      'status_check',
      placements,
    );
  if (status.status === 'expired' || status.status === 'cancelled') {
    await withTenant(db, orgId, (tx) =>
      tx.execute(
        sql`update fee_payment set state = 'failed' where org_id = app_current_org() and id = ${paymentId} and state = 'pending'`,
      ),
    );
    return 'failed';
  }
  return 'pending';
}

export type Account = {
  studentId: string;
  name: string;
  balancePaise: number;
  creditPaise: number;
  invoices: {
    id: string;
    label: string;
    dueOn: string;
    state: string;
    totalPaise: number;
    paidPaise: number;
    lines: {
      kind: string;
      head: string | null;
      /** Collected for an outside body (its short name); null: the institution's own. */
      payee: string | null;
      amountPaise: number;
      reason: string | null;
    }[];
  }[];
  payments: {
    id: string;
    amountPaise: number;
    method: string;
    state: string;
    at: string;
    receiptId: string | null;
    receiptNumber: string | null;
  }[];
  concessions: {
    id: string;
    head: string | null;
    kind: string;
    value: number;
    category: string;
    reason: string;
    state: string;
    from: string;
    until: string;
  }[];
  canPayOnline: boolean;
};

/** A student's fees: invoices with their lines, payments with receipts, and concessions. */
export async function studentAccount(
  deps: FinanceDeps,
  actor: Actor,
  studentId: string,
): Promise<Account> {
  const place = await studentPlace(deps, actor, studentId).catch((e: unknown) => {
    if (e instanceof FinanceError && e.code === 'no_invoices') return null;
    throw e;
  });
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      ...(place ? { place } : {}),
      subjectPersonId: studentId,
    });
    const [s] = await tx.execute<{ name: string }>(sql`
      select legal_name as name from person where org_id = app_current_org() and id = ${studentId}`);
    if (!s) throw new FinanceError('student_not_found');
    const invoices = await tx.execute<Omit<Account['invoices'][number], 'lines'>>(sql`
      select id::text, label, due_on::text as "dueOn", state, total_paise::int as "totalPaise", paid_paise::int as "paidPaise"
      from fee_invoice where org_id = app_current_org() and student_person_id = ${studentId} order by due_on, instalment_seq`);
    const lines = await tx.execute<
      { invoiceId: string } & Account['invoices'][number]['lines'][number]
    >(sql`
      select l.invoice_id::text as "invoiceId", l.kind, h.name as head, fp.short_name as payee,
        l.amount_paise::int as "amountPaise", l.reason
      from fee_invoice_line l left join fee_head h on h.org_id = l.org_id and h.id = l.head_id
      left join fee_payee fp on fp.org_id = h.org_id and fp.id = h.payee_id
      join fee_invoice i on i.org_id = l.org_id and i.id = l.invoice_id
      where l.org_id = app_current_org() and i.student_person_id = ${studentId} order by l.created_at`);
    const payments = await tx.execute<Account['payments'][number]>(sql`
      select p.id::text, p.amount_paise::int as "amountPaise", p.method, p.state, p.created_at::text as at,
        r.id::text as "receiptId", r.snapshot ->> 'number' as "receiptNumber"
      from fee_payment p left join fee_receipt r on r.org_id = p.org_id and r.payment_id = p.id and r.kind = 'receipt'
      where p.org_id = app_current_org() and p.student_person_id = ${studentId} and p.state <> 'initiated'
      order by p.created_at desc`);
    const [credit] = await tx.execute<{ c: number }>(sql`
      select coalesce(sum(credit_paise), 0)::int as c from fee_payment
      where org_id = app_current_org() and student_person_id = ${studentId} and state = 'succeeded'`);
    const concessions = await tx.execute<Account['concessions'][number]>(sql`
      select c.id::text, h.name as head, c.kind, c.value::int as value, c.category, c.reason, c.state,
        lower(c.valid_during)::text as from, (upper(c.valid_during) - 1)::text as until
      from fee_concession c left join fee_head h on h.org_id = c.org_id and h.id = c.head_id
      where c.org_id = app_current_org() and c.student_person_id = ${studentId} order by c.created_at desc`);
    const canPay = deps.gateway
      ? (
          await deps.permissions.can(tx, actor, 'finance.payment.pay', {
            orgId: actor.orgId,
            ...(place ? { place } : {}),
            subjectPersonId: studentId,
          })
        ).allowed
      : false;
    return {
      studentId,
      name: s.name,
      balancePaise: invoices
        .filter((i) => i.state !== 'written_off')
        .reduce((a, i) => a + i.totalPaise - i.paidPaise, 0),
      creditPaise: credit?.c ?? 0,
      invoices: invoices.map((i) => ({
        ...i,
        lines: lines
          .filter((l) => l.invoiceId === i.id)
          .map((l) => ({
            kind: l.kind,
            head: l.head,
            payee: l.payee,
            amountPaise: l.amountPaise,
            reason: l.reason,
          })),
      })),
      payments: [...payments],
      concessions: [...concessions],
      canPayOnline: canPay,
    };
  });
}

export type Receipt = {
  id: string;
  number: string;
  kind: string;
  amountPaise: number;
  issuedAt: string;
  issuedBy: string | null;
  snapshot: Record<string, unknown>;
};

/** One receipt, exactly as issued, for printing or sharing. */
export async function receipt(
  deps: FinanceDeps,
  actor: Actor,
  receiptId: string,
): Promise<Receipt> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<Receipt & { studentId: string; institutionId: string }>(sql`
      select r.id::text, r.snapshot ->> 'number' as number, r.kind, r.amount_paise::int as "amountPaise",
        r.issued_at::text as "issuedAt", p2.legal_name as "issuedBy", r.snapshot,
        r.student_person_id::text as "studentId", p.institution_id::text as "institutionId"
      from fee_receipt r join fee_payment p on p.org_id = r.org_id and p.id = r.payment_id
      left join person p2 on p2.org_id = r.org_id and p2.id = r.issued_by_person_id
      where r.org_id = app_current_org() and r.id = ${receiptId}`);
    if (!r) throw new FinanceError('receipt_not_found');
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, r.institutionId)),
      subjectPersonId: r.studentId,
    });
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      amountPaise: r.amountPaise,
      issuedAt: r.issuedAt,
      issuedBy: r.issuedBy,
      snapshot: r.snapshot,
    };
  });
}
