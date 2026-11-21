// Fees collected for others and voluntary donations on real Postgres (owner's brief, 21 Nov 2026):
// an engineering college's fee holds VTU's ₹20,000; every payment fills VTU's share first, the
// receipt shows it, the college pays it on with a reference, and a reversal takes it back down.
// Donations have their own receipts and are refused from a family with an admission in progress.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelDonation,
  collectPayment,
  createHead,
  decideReversal,
  donationReceipt,
  donations,
  financialYear,
  issueInvoices,
  listHeads,
  payees,
  payeeStatement,
  publishPlan,
  receipt,
  recordDonation,
  recordRemittance,
  requestReversal,
  savePayee,
  savePlan,
  setHeadPayee,
  type DonationInput,
  type FinanceDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
afterAll(() => close());

let t: SeededTenant;
let students: string[];
let inProgress = new Set<string>();
const deps = (): FinanceDeps => ({
  db,
  permissions,
  gateway: null,
  audience: { groups: async () => [], students: async () => students },
  admissionInProgress: async (_tx, i) => !!i.phone && inProgress.has(i.phone),
});
const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const as = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; cause?: unknown }) => e.code ?? `${String(e)} ${String(e.cause)}`,
  );
const ALL = [
  'finance.plan.manage',
  'finance.invoice.read',
  'finance.invoice.issue',
  'finance.payment.collect',
  'finance.reversal.request',
  'finance.reversal.approve',
  'finance.remittance.record',
  'finance.donation.read',
  'finance.donation.record',
  'finance.donation.cancel',
];
let accountant: Actor;
let checker: Actor;
let vtu: string;
let vtuHead: string;
let tuitionHead: string;

const pay = (studentId: string, amountPaise: number) =>
  collectPayment(deps(), accountant, {
    studentId,
    amountPaise,
    method: 'cash',
    idempotencyKey: `split-${randomUUID()}`,
  });
const vtuOf = async () =>
  (await payees(deps(), accountant, t.institutionId, null)).payees.find(
    (x) => x.shortName === 'VTU',
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Fee Payees');
  accountant = as(await seedAdmin(db, t.orgId, ALL));
  checker = as(await seedAdmin(db, t.orgId, ALL));
  const second = await withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Second Engineer') returning id::text`);
    return p!.id;
  });
  students = [t.studentId, second];
});

describe('fees collected for the university', () => {
  it('splits every payment, VTU first; shows it on the receipt; tracks what is held and paid on', async () => {
    vtu = (
      await savePayee(deps(), accountant, {
        institutionId: t.institutionId,
        kind: 'university',
        name: 'Visvesvaraya Technological University',
        shortName: 'VTU',
      })
    ).id;
    expect(
      await code(
        savePayee(deps(), accountant, {
          institutionId: t.institutionId,
          kind: 'university',
          name: 'Again',
          shortName: 'VTU',
        }),
      ),
    ).toBe('payee_exists');
    vtuHead = (
      await createHead(deps(), accountant, {
        institutionId: t.institutionId,
        code: 'VTU_FEE',
        name: 'University fee',
        taxClass: 'education_exempt',
        rteExempt: false,
        refundable: false,
        payeeId: vtu,
      })
    ).id;
    tuitionHead = (
      await createHead(deps(), accountant, {
        institutionId: t.institutionId,
        code: 'BE_TUITION',
        name: 'Tuition fee',
        taxClass: 'education_exempt',
        rteExempt: false,
        refundable: false,
      })
    ).id;
    const heads = await listHeads(deps(), accountant, t.institutionId);
    expect(heads.find((h) => h.code === 'VTU_FEE')).toMatchObject({ payee: 'VTU', used: false });
    expect(heads.find((h) => h.code === 'BE_TUITION')?.payee).toBeNull();

    const plan = await savePlan(deps(), accountant, {
      institutionId: t.institutionId,
      name: 'B.E. first year',
      groupIds: [randomUUID()],
      lines: [
        { headId: tuitionHead, amountPaise: 10_000_000 },
        { headId: vtuHead, amountPaise: 2_000_000 },
      ],
      instalments: [{ label: 'Year', dueOn: iso(10), shareBp: 10_000 }],
      lateFeePaise: 0,
      graceDays: 0,
    });
    await publishPlan(deps(), accountant, plan.id);
    await issueInvoices(deps(), accountant, plan.id);

    // ₹50,000 now: ₹20,000 for VTU, ₹30,000 for the college. The receipt says so.
    const first = await pay(students[0]!, 5_000_000);
    expect((await receipt(deps(), accountant, first.receiptId)).snapshot.forOthers).toEqual([
      {
        payee: 'VTU',
        payeeName: 'Visvesvaraya Technological University',
        amountPaise: 2_000_000,
      },
    ]);
    // The rest is all the college's: VTU is already settled for this student.
    const rest = await pay(students[0]!, 7_000_000);
    expect((await receipt(deps(), accountant, rest.receiptId)).snapshot.forOthers).toEqual([]);
    // The second student pays ₹10,000: all of it is VTU's.
    const small = await pay(students[1]!, 1_000_000);

    const view = await payees(deps(), accountant, t.institutionId, null);
    expect(view.payees.find((x) => x.shortName === 'VTU')).toMatchObject({
      heads: ['University fee'],
      billedPaise: 4_000_000,
      collectedPaise: 3_000_000,
      remittedPaise: 0,
      toRemitPaise: 3_000_000,
      toCollectPaise: 1_000_000,
    });
    expect(view.heldPaise).toBe(view.payees.reduce((a, x) => a + x.toRemitPaise, 0));

    // Paying on: never more than held, never dated ahead; then held goes down.
    const remit = (amountPaise: number, paidOn = iso(0)) =>
      recordRemittance(deps(), accountant, {
        payeeId: vtu,
        periodLabel: null,
        amountPaise,
        paidOn,
        reference: 'UTR-SYNTH-77',
      });
    expect(await code(remit(3_000_001))).toBe('more_than_held');
    expect(await code(remit(100, iso(1)))).toBe('future_date');
    await remit(2_000_000);
    const statement = await payeeStatement(deps(), accountant, vtu, null);
    expect(statement.payee).toMatchObject({ remittedPaise: 2_000_000, toRemitPaise: 1_000_000 });
    expect(statement.students.map((s) => [s.billedPaise, s.collectedPaise]).sort()).toEqual([
      [2_000_000, 1_000_000],
      [2_000_000, 2_000_000],
    ]);
    expect(statement.remittances).toMatchObject([
      { amountPaise: 2_000_000, reference: 'UTR-SYNTH-77' },
    ]);
    // Remittances are never edited.
    await expect(
      withTenant(db, t.orgId, (tx) => tx.execute(sql`update fee_remittance set amount_paise = 1`)),
    ).rejects.toThrow();

    // A reversal takes VTU's share back down with it.
    const { id } = await requestReversal(deps(), accountant, {
      paymentId: small.paymentId,
      reason: 'Entered against the wrong student',
      chargePaise: 0,
    });
    await decideReversal(deps(), checker, { reversalId: id, approve: true });
    expect(await vtuOf()).toMatchObject({
      collectedPaise: 2_000_000,
      toRemitPaise: 0,
      toCollectPaise: 2_000_000,
    });
  });

  it('a head’s payee changes only until it is billed', async () => {
    expect(await code(setHeadPayee(deps(), accountant, { headId: vtuHead, payeeId: null }))).toBe(
      'head_in_use',
    );
    const lab = await createHead(deps(), accountant, {
      institutionId: t.institutionId,
      code: 'LAB',
      name: 'Lab fee',
      taxClass: 'education_exempt',
      rteExempt: false,
      refundable: false,
    });
    await setHeadPayee(deps(), accountant, { headId: lab.id, payeeId: vtu });
    expect(
      (await listHeads(deps(), accountant, t.institutionId)).find((h) => h.code === 'LAB'),
    ).toMatchObject({ payee: 'VTU', used: false });
  });
});

describe('voluntary donations', () => {
  const gift = (over: Partial<DonationInput> = {}): DonationInput => ({
    institutionId: t.institutionId,
    donorKind: 'person',
    donorName: 'Synthetic Donor',
    donorPhone: '+919876500001',
    fund: 'Library fund',
    amountPaise: 2_500_000,
    method: 'upi',
    instrumentRef: 'UPI-SYNTH-1',
    receivedOn: iso(0),
    voluntary: true,
    ...over,
  });

  it('numbers receipts per year, refuses seat-linked gifts, and cancels only by someone else', async () => {
    expect(await code(recordDonation(deps(), accountant, gift({ voluntary: false })))).toBe(
      'not_voluntary',
    );
    expect(
      await code(recordDonation(deps(), accountant, gift({ donorPhone: null, donorEmail: null }))),
    ).toBe('contact_required');
    expect(await code(recordDonation(deps(), accountant, gift({ instrumentRef: null })))).toBe(
      'instrument_ref_required',
    );
    expect(await code(recordDonation(deps(), accountant, gift({ receivedOn: iso(1) })))).toBe(
      'future_date',
    );
    // A family with an admission in progress can't donate: a seat is never bought.
    inProgress = new Set(['+919876500009']);
    expect(
      await code(recordDonation(deps(), accountant, gift({ donorPhone: '+919876500009' }))),
    ).toBe('admission_in_progress');

    const fy = financialYear(iso(0));
    const before = await donations(deps(), accountant, t.institutionId, null);
    const a = await recordDonation(deps(), accountant, gift());
    const b = await recordDonation(
      deps(),
      accountant,
      gift({
        donorKind: 'organisation',
        donorName: 'Synthetic Alumni Trust',
        donorPhone: null,
        fund: 'Scholarships',
        amountPaise: 10_000_000,
        method: 'cash',
        instrumentRef: null,
      }),
    );
    const n = Number(a.number.slice(-6));
    expect(a.number).toMatch(new RegExp(`^DON/${fy}/\\d{6}$`));
    expect(b.number).toBe(`DON/${fy}/${String(n + 1).padStart(6, '0')}`);
    expect(await donationReceipt(deps(), checker, a.id)).toMatchObject({
      amountPaise: 2_500_000,
      fund: 'Library fund',
      canCancel: true,
    });
    expect((await donationReceipt(deps(), accountant, a.id)).canCancel).toBe(false);

    expect(
      await code(cancelDonation(deps(), accountant, { donationId: a.id, reason: 'Typed twice' })),
    ).toBe('maker_checker');
    await cancelDonation(deps(), checker, { donationId: a.id, reason: 'Typed twice' });
    expect(await code(cancelDonation(deps(), checker, { donationId: a.id, reason: 'Again' }))).toBe(
      'already_cancelled',
    );
    const list = await donations(deps(), accountant, t.institutionId, null);
    expect(list.financialYear).toBe(fy);
    expect(list.totalPaise - before.totalPaise).toBe(10_000_000);
    expect(list.count - before.count).toBe(1);
    expect(list.byFund.find((f) => f.fund === 'Scholarships')).toEqual({
      fund: 'Scholarships',
      amountPaise: 10_000_000,
      count: 1,
    });
    expect(
      list.donations.filter((d) => [a.id, b.id].includes(d.id)).map((d) => [d.id, d.cancelled]),
    ).toEqual([
      [b.id, false],
      [a.id, true],
    ]);
    // Only cancellation changes a donation, and nothing deletes one.
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update donation set amount_paise = 1 where id = ${b.id}`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, t.orgId, (tx) => tx.execute(sql`delete from donation where id = ${b.id}`)),
    ).rejects.toThrow();
  });
});
