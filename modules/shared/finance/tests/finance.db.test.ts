// Fees on real Postgres: plans, invoices, the counter, online payment through signed webhooks (the
// Milestone 11 exit check: repeated webhooks create one receipt), approvals, day close and dues.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  grantPermission,
  seedAdmin,
  seedTenant,
  syntheticPhone,
  type SeededTenant,
} from '@campusverse/db/seed';
import { createPermissions, PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkOnlinePayment,
  closeDay,
  collectPayment,
  createHead,
  dayCloseView,
  decideConcession,
  decideRefund,
  decideReversal,
  dues,
  fakeGateway,
  handleWebhook,
  issueInvoices,
  pendingApprovals,
  previewIssue,
  publishPlan,
  receipt,
  requestConcession,
  requestRefund,
  requestReversal,
  savePlan,
  sendReminders,
  sign,
  startOnlinePayment,
  studentAccount,
  type FinanceDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const gateway = fakeGateway();
afterAll(() => close());

let t: SeededTenant;
let students: string[];
const deps = (): FinanceDeps => ({
  db,
  permissions,
  gateway,
  audience: { groups: async () => [], students: async () => students },
});
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const as = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const ALL = [
  'finance.plan.manage',
  'finance.invoice.read',
  'finance.invoice.issue',
  'finance.payment.collect',
  'finance.concession.request',
  'finance.concession.approve',
  'finance.refund.request',
  'finance.refund.approve',
  'finance.reversal.request',
  'finance.reversal.approve',
  'finance.day.close',
  'finance.payment.reconcile',
];
let accountant: Actor;
let checker: Actor;
let clerk: Actor;
let parent: Actor;
let stranger: Actor;
let planId: string;

const one = <T>(rows: T[]) => rows[0] as T;
const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  withTenant(db, t.orgId, (tx) => tx.execute<T>(query)).then((r) => [...r]);
const balance = async (studentId: string) =>
  (await studentAccount(deps(), accountant, studentId)).balancePaise;

beforeAll(async () => {
  t = await seedTenant(db, 'Fees');
  accountant = as(await seedAdmin(db, t.orgId, ALL));
  checker = as(await seedAdmin(db, t.orgId, ALL));
  clerk = as(
    await seedAdmin(db, t.orgId, [
      'finance.invoice.read',
      'finance.payment.collect',
      'finance.day.close',
      'finance.reversal.request',
    ]),
  );
  parent = as(t.guardianId);
  await grantPermission(db, t.orgId, 'parent', 'finance.invoice.read', 'guardian');
  await grantPermission(db, t.orgId, 'parent', 'finance.payment.pay', 'guardian');
  const ids = await withTenant(db, t.orgId, async (tx) => {
    const made: string[] = [];
    for (const n of ['Second', 'Third']) {
      const [p] = await tx.execute<{ id: string }>(sql`
        insert into person (org_id, legal_name) values (app_current_org(), ${`Synthetic ${n} Fees`}) returning id::text`);
      made.push(p!.id);
    }
    const [s] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Stranger Parent Fees') returning id::text`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select org_id, ${s!.id}, id, 'organisation', org_id from role where org_id = app_current_org() and key = 'parent'`);
    await tx.execute(sql`
      update guardian_link set is_fee_payer = true, fee_messages = true
      where org_id = app_current_org() and guardian_person_id = ${t.guardianId}`);
    await tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address) values (app_current_org(), ${t.guardianId}, 'push', ${`token-${randomUUID()}`})`);
    return { made, stranger: s!.id };
  });
  students = [t.studentId, ...ids.made];
  stranger = as(ids.stranger);
  void syntheticPhone;
});

describe('plans and invoices', () => {
  it('a plan of heads and instalments bills each student once, adding up to the paisa', async () => {
    const tuition = await createHead(deps(), accountant, {
      institutionId: t.institutionId,
      code: 'TUI26',
      name: 'Tuition',
      taxClass: 'education_exempt',
      rteExempt: true,
      refundable: false,
    });
    const transport = await createHead(deps(), accountant, {
      institutionId: t.institutionId,
      code: 'BUS26',
      name: 'Transport',
      taxClass: 'taxable',
      rteExempt: false,
      refundable: false,
    });
    await expect(
      createHead(deps(), clerk, {
        institutionId: t.institutionId,
        code: 'X1',
        name: 'X',
        taxClass: 'education_exempt',
        rteExempt: true,
        refundable: false,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const plan = await savePlan(deps(), accountant, {
      institutionId: t.institutionId,
      name: 'Class 5 2026-27',
      groupIds: [randomUUID()],
      lines: [
        { headId: tuition.id, amountPaise: 1_000_000 },
        { headId: transport.id, amountPaise: 1 },
      ],
      instalments: [
        { label: 'Term 1', dueOn: iso(-20), shareBp: 3334 },
        { label: 'Term 2', dueOn: iso(40), shareBp: 3333 },
        { label: 'Term 3', dueOn: iso(130), shareBp: 3333 },
      ],
      lateFeePaise: 5_000,
      graceDays: 0,
    });
    planId = plan.id;
    await expect(previewIssue(deps(), accountant, planId)).rejects.toThrow(/not_published/);
    await publishPlan(deps(), accountant, planId);
    expect(await previewIssue(deps(), accountant, planId)).toMatchObject({
      students: 3,
      invoices: 9,
      totalPaise: 3 * 1_000_001,
    });
    await issueInvoices(deps(), accountant, planId);
    expect((await issueInvoices(deps(), accountant, planId)).alreadyIssued).toBe(9); // repeat bills nobody twice

    const totals = await q<{ s: string; n: number }>(sql`
      select student_person_id::text as s, sum(total_paise)::int as n from fee_invoice
      where org_id = app_current_org() and plan_id = ${planId} group by 1`);
    expect(totals.map((r) => r.n)).toEqual([1_000_001, 1_000_001, 1_000_001]);
  });

  it('a concession needs a second person to approve, then reduces unpaid invoices', async () => {
    const before = await balance(students[1]!);
    const { id } = await requestConcession(deps(), accountant, {
      studentId: students[1]!,
      headId: null,
      kind: 'percent',
      value: 1000,
      category: 'sibling',
      from: iso(-60),
      to: iso(300),
      reason: 'Second child',
    });
    await expect(
      decideConcession(deps(), accountant, { concessionId: id, approve: true }),
    ).rejects.toThrow(/maker_cannot_approve/);
    await expect(
      decideConcession(deps(), clerk, { concessionId: id, approve: true }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await decideConcession(deps(), checker, { concessionId: id, approve: true });
    // 10% of each head on each instalment, rounded down per line.
    expect(before - (await balance(students[1]!))).toBe(33_340 + 33_330 + 33_330);
  });
});

describe('the counter', () => {
  it('collects once per Idempotency-Key, pays the oldest first with its late fee, and numbers receipts without gaps', async () => {
    const key = `counter-${randomUUID()}`;
    const first = await collectPayment(deps(), clerk, {
      studentId: students[0]!,
      amountPaise: 200_000,
      method: 'cash',
      idempotencyKey: key,
    });
    const again = await collectPayment(deps(), clerk, {
      studentId: students[0]!,
      amountPaise: 200_000,
      method: 'cash',
      idempotencyKey: key,
    });
    expect(again).toEqual(first);
    const twice = `double-${randomUUID()}`;
    const [a, b] = await Promise.all([
      collectPayment(deps(), clerk, {
        studentId: students[0]!,
        amountPaise: 50_000,
        method: 'upi',
        idempotencyKey: twice,
      }),
      collectPayment(deps(), clerk, {
        studentId: students[0]!,
        amountPaise: 50_000,
        method: 'upi',
        idempotencyKey: twice,
      }),
    ]);
    expect(a.receiptId).toBe(b.receiptId);

    const account = await studentAccount(deps(), clerk, students[0]!);
    const term1 = account.invoices.find((i) => i.label === 'Term 1')!;
    expect(term1.lines.map((l) => l.kind)).toEqual(['charge', 'charge', 'late_fee']);
    expect(term1.paidPaise).toBe(Math.min(term1.totalPaise, 250_000));
    await expect(
      collectPayment(deps(), clerk, {
        studentId: students[0]!,
        amountPaise: 100,
        method: 'cheque',
        idempotencyKey: `c-${randomUUID()}`,
      }),
    ).rejects.toThrow(/cheque_number_required/);
    await expect(
      collectPayment(deps(), stranger, {
        studentId: students[0]!,
        amountPaise: 100,
        method: 'cash',
        idempotencyKey: `s-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    const numbers = await q<{ n: number }>(sql`
      select number as n from fee_receipt where org_id = app_current_org() and legal_entity_id = ${t.legalEntityId}
        and financial_year = (select max(financial_year) from fee_receipt where org_id = app_current_org())
      order by number`);
    expect(numbers.map((r) => r.n)).toEqual(numbers.map((_, i) => (numbers[0]?.n ?? 1) + i));
  });

  it('receipts can never be edited or deleted', async () => {
    // Refused by the missing grant, and by the append-only trigger behind it (42501 either way).
    const refused = { cause: { code: '42501' } };
    await expect(
      q(sql`update fee_receipt set amount_paise = 1 where org_id = app_current_org()`),
    ).rejects.toMatchObject(refused);
    await expect(
      q(sql`delete from fee_allocation where org_id = app_current_org()`),
    ).rejects.toMatchObject(refused);
  });
});

describe('online payment (exit check)', () => {
  it('repeated and duplicate webhooks for one payment create exactly one receipt', async () => {
    const studentId = students[0]!;
    await expect(startOnlinePayment(deps(), stranger, { studentId })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const started = await startOnlinePayment(deps(), parent, { studentId });
    expect(await startOnlinePayment(deps(), parent, { studentId })).toEqual(started); // tapping Pay twice reuses the link
    const [p] = await q<{ ref: string }>(
      sql`select gateway_ref as ref from fee_payment where org_id = app_current_org() and id = ${started.paymentId}`,
    );

    const hook = gateway.pay(p!.ref);
    expect(await handleWebhook(db, gateway, { ...hook, signature: 'f'.repeat(64) })).toBe(
      'bad_signature',
    );
    expect(
      await handleWebhook(db, gateway, {
        ...hook,
        signature: sign(hook.rawBody, 'someone-elses-secret'),
      }),
    ).toBe('bad_signature');
    const outcomes = await Promise.all([
      handleWebhook(db, gateway, hook),
      handleWebhook(db, gateway, hook),
      handleWebhook(db, gateway, { ...hook, eventId: `evt_other_${randomUUID()}` }),
    ]);
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(2);
    expect(await handleWebhook(db, gateway, hook)).toBe('duplicate');
    expect(await checkOnlinePayment(db, gateway, t.orgId, started.paymentId)).toBe('duplicate');

    const receipts = await q<{ n: number }>(sql`
      select count(*)::int as n from fee_receipt where org_id = app_current_org() and payment_id = ${started.paymentId}`);
    expect(one(receipts).n).toBe(1);
    expect(await balance(studentId)).toBe(0);
    const events = await q<{ n: number }>(sql`
      select count(*)::int as n from ops.outbox where org_id = app_current_org() and type = 'finance.payment.succeeded.v1'
        and payload ->> 'paymentId' = ${started.paymentId}`);
    expect(one(events).n).toBe(1);
  });

  it('a lost webhook is caught by the status check; a wrong amount goes to reconciliation', async () => {
    const lost = await startOnlinePayment(deps(), parent, {
      studentId: t.studentId === students[0] ? students[2]! : t.studentId,
    }).catch(() => null);
    // The seeded guardian is fee payer only for the seeded student: use the office for the others.
    expect(lost).toBeNull();
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship, is_fee_payer, fee_messages)
        values (app_current_org(), ${t.guardianId}, ${students[2]!}, 'mother', true, true),
               (app_current_org(), ${t.guardianId}, ${students[1]!}, 'mother', true, true)`),
    );
    const silent = await startOnlinePayment(deps(), parent, { studentId: students[2]! });
    const [p] = await q<{ ref: string }>(
      sql`select gateway_ref as ref from fee_payment where org_id = app_current_org() and id = ${silent.paymentId}`,
    );
    expect(await checkOnlinePayment(db, gateway, t.orgId, silent.paymentId)).toBe('pending');
    gateway.pay(p!.ref); // paid, but the webhook never arrives
    expect(await checkOnlinePayment(db, gateway, t.orgId, silent.paymentId)).toBe('applied');
    expect(await balance(students[2]!)).toBe(0);

    const short = await startOnlinePayment(deps(), parent, { studentId: students[1]! });
    const [s] = await q<{ ref: string }>(
      sql`select gateway_ref as ref from fee_payment where org_id = app_current_org() and id = ${short.paymentId}`,
    );
    expect(await handleWebhook(db, gateway, gateway.pay(s!.ref, short.amountPaise - 100))).toBe(
      'unmatched',
    );
    const [state] = await q<{ state: string }>(
      sql`select state from fee_payment where org_id = app_current_org() and id = ${short.paymentId}`,
    );
    expect(state?.state).toBe('unmatched');
    expect(await handleWebhook(db, gateway, gateway.pay(`plink_nobody_${randomUUID()}`))).toBe(
      'unmatched',
    );
  });
});

describe('refunds, reversals and the day', () => {
  it('a refund needs a checker and a payout reference, never exceeds what was paid, and issues a voucher', async () => {
    const pay = await collectPayment(deps(), clerk, {
      studentId: students[1]!,
      amountPaise: 10_000,
      method: 'cash',
      idempotencyKey: `r-${randomUUID()}`,
    });
    await expect(
      requestRefund(deps(), accountant, {
        paymentId: pay.paymentId,
        amountPaise: 10_001,
        reason: 'Too much',
      }),
    ).rejects.toThrow(/more_than_paid/);
    const { id } = await requestRefund(deps(), accountant, {
      paymentId: pay.paymentId,
      amountPaise: 4_000,
      reason: 'Paid twice',
    });
    await expect(
      decideRefund(deps(), accountant, { refundId: id, approve: true, payoutRef: 'UTR1' }),
    ).rejects.toThrow(/maker_cannot_approve/);
    await expect(decideRefund(deps(), checker, { refundId: id, approve: true })).rejects.toThrow(
      /payout_ref_required/,
    );
    expect((await pendingApprovals(deps(), checker, t.institutionId)).map((a) => a.kind)).toContain(
      'refund',
    );
    await decideRefund(deps(), checker, { refundId: id, approve: true, payoutRef: 'UTR123456' });
    const [voucher] = await q<{ amount: number; kind: string }>(sql`
      select amount_paise::int as amount, kind from fee_receipt where org_id = app_current_org() and refund_id = ${id}`);
    expect(voucher).toEqual({ amount: -4_000, kind: 'refund' });
  });

  it('a large refund takes the steps set for its amount; the payout reference only at the last', async () => {
    const trustee = as(await seedAdmin(db, t.orgId, ALL));
    await q(sql`
      with r as (
        insert into role (org_id, key, name) values
          (app_current_org(), 'synthetic_bursar', 'Synthetic bursar'),
          (app_current_org(), 'synthetic_trustee', 'Synthetic trustee')
        returning id, key)
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select app_current_org(), case r.key when 'synthetic_bursar' then ${checker.personId}::uuid
        else ${trustee.personId}::uuid end, r.id, 'organisation', app_current_org() from r`);
    await q(sql`
      insert into approval_step (org_id, process, position, approver_role_key, min_amount_paise) values
        (app_current_org(), 'finance.refund', 1, 'synthetic_bursar', null),
        (app_current_org(), 'finance.refund', 2, 'synthetic_trustee', 5000)`);
    const pay = await collectPayment(deps(), clerk, {
      studentId: students[1]!,
      amountPaise: 9_000,
      method: 'cash',
      idempotencyKey: `r2-${randomUUID()}`,
    });
    const { id } = await requestRefund(deps(), accountant, {
      paymentId: pay.paymentId,
      amountPaise: 6_000,
      reason: 'Left mid-term',
    });
    expect(await decideRefund(deps(), checker, { refundId: id, approve: true })).toBe('pending');
    const waiting = (await pendingApprovals(deps(), trustee, t.institutionId)).find(
      (a) => a.id === id,
    );
    expect(waiting?.approval).toMatchObject({ step: 2, steps: 2, mine: true });
    await expect(decideRefund(deps(), trustee, { refundId: id, approve: true })).rejects.toThrow(
      /payout_ref_required/,
    );
    expect(
      await decideRefund(deps(), trustee, { refundId: id, approve: true, payoutRef: 'UTR777' }),
    ).toBe('paid');
    await q(
      sql`delete from approval_step where org_id = app_current_org() and process = 'finance.refund'`,
    );
  });

  it('a bounced cheque: the receipt is reversed by a credit note, the charge added, the parent told', async () => {
    const before = await balance(students[1]!);
    const cheque = await collectPayment(deps(), clerk, {
      studentId: students[1]!,
      amountPaise: 30_000,
      method: 'cheque',
      instrumentRef: '000123',
      idempotencyKey: `q-${randomUUID()}`,
    });
    expect(await balance(students[1]!)).toBe(before - 30_000);
    const { id } = await requestReversal(deps(), clerk, {
      paymentId: cheque.paymentId,
      reason: 'Cheque returned unpaid',
      chargePaise: 50_000,
    });
    await expect(
      requestReversal(deps(), clerk, {
        paymentId: cheque.paymentId,
        reason: 'Again',
        chargePaise: 0,
      }),
    ).rejects.toThrow(/reversal_open/);
    await expect(decideReversal(deps(), clerk, { reversalId: id, approve: true })).rejects.toThrow(
      /maker_cannot_approve/,
    );
    await decideReversal(deps(), checker, { reversalId: id, approve: true });
    expect(await balance(students[1]!)).toBe(before + 50_000);
    const notes = await q<{ kind: string; amount: number }>(sql`
      select kind, amount_paise::int as amount from fee_receipt where org_id = app_current_org() and payment_id = ${cheque.paymentId} order by number`);
    expect(notes).toEqual([
      { kind: 'receipt', amount: 30_000 },
      { kind: 'reversal', amount: -30_000 },
    ]);
    // The fee-paying parent can still read the original receipt, unchanged; a stranger can't.
    expect((await receipt(deps(), parent, cheque.receiptId)).amountPaise).toBe(30_000);
    await expect(receipt(deps(), stranger, cheque.receiptId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('the cashier closes the day against counted cash; a difference needs a note; then the counter is shut', async () => {
    const view = await dayCloseView(deps(), clerk, t.institutionId);
    expect(view.cash.paise).toBeGreaterThan(0);
    await expect(
      closeDay(deps(), clerk, {
        institutionId: t.institutionId,
        countedCashPaise: view.cash.paise - 100,
      }),
    ).rejects.toThrow(/difference_needs_note/);
    const closed = await closeDay(deps(), clerk, {
      institutionId: t.institutionId,
      countedCashPaise: view.cash.paise - 100,
      note: 'One rupee short',
      depositRef: 'SLIP-9',
    });
    expect(closed.closed?.differencePaise).toBe(-100);
    await expect(
      collectPayment(deps(), clerk, {
        studentId: students[1]!,
        amountPaise: 100,
        method: 'cash',
        idempotencyKey: `late-${randomUUID()}`,
      }),
    ).rejects.toThrow(/day_closed/);
  });

  it('dues by age, and reminders to fee-paying guardians once a day', async () => {
    const d = await dues(deps(), accountant, t.institutionId);
    expect(Object.values(d.buckets).reduce((a, b) => a + b.students, 0)).toBeGreaterThan(0);
    // Overdue counts past-due instalments only, never ones still to come.
    const pastDue = await q<{ id: string; n: number }>(sql`
      select student_person_id::text as id, sum(total_paise - paid_paise)::int as n from fee_invoice
      where org_id = app_current_org() and institution_id = ${t.institutionId} and paid_paise < total_paise
        and state <> 'written_off' and due_on < ${d.onDate}::date
      group by student_person_id`);
    const expected = new Map(pastDue.map((r) => [r.id, r.n]));
    expect(d.defaulters.length).toBeGreaterThan(0);
    for (const x of d.defaulters) expect(x.overduePaise).toBe(expected.get(x.studentId));
    const sent = await sendReminders(deps(), accountant, {
      institutionId: t.institutionId,
      minDaysOverdue: 1,
    });
    const again = await sendReminders(deps(), accountant, {
      institutionId: t.institutionId,
      minDaysOverdue: 1,
    });
    expect(again.messages).toBe(0);
    expect(sent.students).toBe(again.students);
  });

  it('money adds up: every invoice equals its lines, every payment its allocations, nothing negative', async () => {
    const bad = await q<{ id: string }>(sql`
      select i.id::text from fee_invoice i
      where i.org_id = app_current_org() and (
        i.total_paise <> (select coalesce(sum(amount_paise), 0) from fee_invoice_line where org_id = i.org_id and invoice_id = i.id)
        or i.paid_paise <> (select coalesce(sum(amount_paise), 0) from fee_allocation where org_id = i.org_id and invoice_id = i.id)
        or i.paid_paise < 0 or i.paid_paise > i.total_paise)`);
    expect(bad).toEqual([]);
    const payments = await q<{ id: string }>(sql`
      select p.id::text from fee_payment p
      where p.org_id = app_current_org() and p.state in ('succeeded', 'refunded')
        and p.amount_paise <> p.credit_paise + (select coalesce(sum(amount_paise), 0) from fee_allocation where org_id = p.org_id and payment_id = p.id)`);
    expect(payments).toEqual([]);
  });
});
