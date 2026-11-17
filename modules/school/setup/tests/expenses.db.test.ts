// Expenses across modules (docs/specs/EXPENSES.md): categories and vendors, bills with duplicate
// and date checks, approval by someone other than the recorder (in code and in the database),
// payment with gapless vouchers, append-only payments, and budgets against what's committed.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  bill,
  bills,
  budgets,
  cancelBill,
  categories,
  decideBill,
  expenseFigures,
  installExpenseCategories,
  payBill,
  recordBill,
  saveCategory,
  saveVendor,
  setBudget,
  type BillInput,
  type ExpenseDeps,
} from '@campusverse/shared-expenses';
import { financialYear } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: ExpenseDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let clerk: Actor;
let clerk2: Actor;
let principal: Actor;
let viewer: Actor;
let today: string;
let categoryId: string;
let vendorId: string;
const actorFor = async (perms: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, perms),
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
const aBill = (more: Partial<BillInput> = {}): BillInput => ({
  institutionId: t.institutionId,
  categoryId,
  vendorId: null,
  payee: 'Synthetic Electrician',
  billNo: '',
  billDate: today,
  description: 'Fan repairs',
  amountPaise: 250_000,
  taxPaise: 0,
  fileId: null,
  ...more,
});

beforeAll(async () => {
  t = await seedTenant(db, 'Expenses');
  clerk = await actorFor(['expenses.bill.read', 'expenses.bill.record', 'expenses.bill.pay']);
  clerk2 = await actorFor(['expenses.bill.read', 'expenses.bill.record']);
  principal = await actorFor([
    'expenses.bill.read',
    'expenses.bill.record',
    'expenses.bill.approve',
    'expenses.setup.manage',
  ]);
  viewer = await actorFor(['expenses.bill.read']);
  today = await withTenant(db, t.orgId, async (tx) => {
    await installExpenseCategories(tx);
    await installExpenseCategories(tx);
    const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    return r?.d ?? '';
  });
});
afterAll(() => close());

describe('categories and vendors', () => {
  it('installs the defaults once, refuses a duplicate name, and only setup may change them', async () => {
    const list = await categories(deps, viewer, t.institutionId);
    // The seed's Repairs and maintenance is the same as the default: ten in all.
    expect(list).toHaveLength(10);
    categoryId = list.find((c) => c.name === 'Repairs and maintenance')?.id ?? '';
    expect(
      await code(
        saveCategory(deps, principal, {
          institutionId: t.institutionId,
          id: null,
          name: ' rent ',
          active: true,
        }),
      ),
    ).toBe('category_exists');
    expect(
      await code(
        saveCategory(deps, clerk, {
          institutionId: t.institutionId,
          id: null,
          name: 'Sports',
          active: true,
        }),
      ),
    ).toBe('denied');
    vendorId = (
      await saveVendor(deps, clerk, {
        institutionId: t.institutionId,
        id: null,
        name: 'Synthetic Hardware Stores',
        phone: null,
        email: null,
        gstin: '29ABCDE1234F1Z5',
        address: '',
        active: true,
      })
    ).id;
    expect(
      await code(
        saveVendor(deps, viewer, {
          institutionId: t.institutionId,
          id: null,
          name: 'Nope',
          phone: null,
          email: null,
          gstin: null,
          address: '',
          active: true,
        }),
      ),
    ).toBe('denied');
  });
});

describe('bills', () => {
  it('records a bill, never the same vendor bill twice, never a future date', async () => {
    await recordBill(deps, clerk, aBill({ vendorId, payee: '', billNo: 'shs/101' }));
    expect(await code(recordBill(deps, clerk, aBill({ vendorId, billNo: 'SHS/101 ' })))).toBe(
      'duplicate_bill',
    );
    expect(await code(recordBill(deps, clerk, aBill({ billDate: '2099-01-01' })))).toBe(
      'future_date',
    );
    expect(await code(recordBill(deps, viewer, aBill()))).toBe('denied');
    const waiting = await bills(deps, viewer, {
      institutionId: t.institutionId,
      view: 'waiting',
      search: 'synthetic hardware',
    });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ payTo: 'Synthetic Hardware Stores', state: 'submitted' });
  });

  it('is approved by someone else, never the recorder, and a rejection says why', async () => {
    const own = await recordBill(deps, principal, aBill({ description: 'Principal’s own' }));
    expect(
      await code(
        decideBill(deps, principal, {
          institutionId: t.institutionId,
          billId: own.billId,
          approve: true,
          note: '',
        }),
      ),
    ).toBe('own_bill');
    // The database holds the line too.
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`
          update expense_bill set state = 'approved', decided_by_person_id = recorded_by_person_id, decided_at = now()
          where org_id = app_current_org() and id = ${own.billId}`),
      ),
    ).rejects.toThrow();
    const b = await recordBill(deps, clerk, aBill({ description: 'Gate lock' }));
    // Another recorder, without approval rights, is refused by the approval engine.
    expect(
      await code(
        decideBill(deps, clerk2, {
          institutionId: t.institutionId,
          billId: b.billId,
          approve: true,
          note: '',
        }),
      ),
    ).toBe('not_your_step');
    expect(
      await code(
        decideBill(deps, principal, {
          institutionId: t.institutionId,
          billId: b.billId,
          approve: false,
          note: '',
        }),
      ),
    ).toBe('note_needed');
    await decideBill(deps, principal, {
      institutionId: t.institutionId,
      billId: b.billId,
      approve: false,
      note: 'Get a second quote',
    });
    expect(
      await bill(deps, clerk, { institutionId: t.institutionId, billId: b.billId }),
    ).toMatchObject({ state: 'rejected', decisionNote: 'Get a second quote' });
    // Another recorder can't withdraw someone else's bill; the recorder can.
    const c = await recordBill(deps, clerk, aBill({ description: 'Withdrawn' }));
    expect(
      await code(cancelBill(deps, clerk2, { institutionId: t.institutionId, billId: c.billId })),
    ).toBe('not_yours');
    await cancelBill(deps, clerk, { institutionId: t.institutionId, billId: c.billId });
  });
});

describe('budgets and payment', () => {
  it('shows the budget position, flags going over, and pays with gapless vouchers', async () => {
    const fy = financialYear(today);
    await setBudget(deps, principal, {
      institutionId: t.institutionId,
      categoryId,
      financialYear: fy,
      amountPaise: 400_000,
    });
    expect(
      await code(
        setBudget(deps, clerk, {
          institutionId: t.institutionId,
          categoryId,
          financialYear: fy,
          amountPaise: 1,
        }),
      ),
    ).toBe('denied');
    // What the seed already spent in this category this year, if anything.
    const base =
      (
        await budgets(deps, viewer, { institutionId: t.institutionId, financialYear: fy })
      ).rows.find((r) => r.categoryId === categoryId)?.committedPaise ?? 0;
    // The hardware bill (₹2,500) waits; approve it, then another ₹2,500 goes over ₹4,000.
    const [hardware] = await bills(deps, viewer, {
      institutionId: t.institutionId,
      view: 'waiting',
      search: 'SHS/101',
    });
    const hardwareId = hardware?.billId ?? '';
    expect(
      await code(
        payBill(deps, clerk, {
          institutionId: t.institutionId,
          billId: hardwareId,
          mode: 'cash',
          reference: '',
          paidOn: today,
        }),
      ),
    ).toBe('not_approved');
    await decideBill(deps, principal, {
      institutionId: t.institutionId,
      billId: hardwareId,
      approve: true,
      note: '',
    });
    const next = await recordBill(deps, clerk, aBill({ description: 'Pump motor' }));
    expect(
      (await bill(deps, principal, { institutionId: t.institutionId, billId: next.billId }))
        .position,
    ).toEqual({
      budgetPaise: 400_000,
      committedPaise: base + 250_000,
      afterPaise: base + 500_000,
      leftPaise: 400_000 - base - 500_000,
      over: true,
    });
    // Over budget is allowed: a broken pump can't wait.
    await decideBill(deps, principal, {
      institutionId: t.institutionId,
      billId: next.billId,
      approve: true,
      note: 'Urgent',
    });

    const pay = (billId: string, more: Partial<Parameters<typeof payBill>[2]> = {}) =>
      payBill(deps, clerk, {
        institutionId: t.institutionId,
        billId,
        mode: 'cash',
        reference: '',
        paidOn: today,
        ...more,
      });
    expect(await code(pay(hardwareId, { mode: 'cheque' }))).toBe('reference_needed');
    expect(await code(pay(hardwareId, { paidOn: '2020-01-01' }))).toBe('paid_before_bill');
    expect(
      await code(
        payBill(deps, viewer, {
          institutionId: t.institutionId,
          billId: hardwareId,
          mode: 'cash',
          reference: '',
          paidOn: today,
        }),
      ),
    ).toBe('denied');
    // A new legal entity's year starts at 1 (the seed's year already used 000001 if it's this year).
    const first = await pay(hardwareId, { mode: 'cheque', reference: '004512' });
    const second = await pay(next.billId);
    const n = Number(first.voucherNo.slice(-6));
    expect(first.voucherNo).toMatch(new RegExp(`^PV/${fy}/\\d{6}$`));
    expect(second.voucherNo).toBe(`PV/${fy}/${String(n + 1).padStart(6, '0')}`);
    expect(await code(pay(hardwareId))).toBe('not_approved');

    // Payments are never edited.
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(
          sql`update expense_payment set amount_paise = 1 where org_id = app_current_org()`,
        ),
      ),
    ).rejects.toThrow();

    const year = await budgets(deps, viewer, { institutionId: t.institutionId, financialYear: fy });
    expect(year.rows.find((r) => r.categoryId === categoryId)).toMatchObject({
      budgetPaise: 400_000,
      committedPaise: base + 500_000,
      paidPaise: base + 500_000,
      leftPaise: 400_000 - base - 500_000,
      over: true,
    });
    expect(await expenseFigures(deps, viewer, t.institutionId)).toMatchObject({
      toPay: 0,
      overBudget: 1,
    });
  });
});
