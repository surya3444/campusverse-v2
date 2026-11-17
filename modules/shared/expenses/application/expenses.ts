// Expenses (docs/specs/EXPENSES.md): categories and vendors for the organisation, budgets per
// school and year, bills with photos, approval by someone other than the recorder (with the
// budget position), and payment with gapless vouchers per legal entity and financial year.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { filesInfo } from '@campusverse/platform-documents';
import { command } from '@campusverse/platform-events';
import { institutionInfo } from '@campusverse/platform-organisation';
import {
  approvalStates,
  decideApproval,
  startApproval,
  withdrawApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
  type Resource,
} from '@campusverse/platform-permissions';
import { financialYear } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import {
  budgetPosition,
  payProblem,
  voucherNo,
  type BudgetPosition,
  type Mode,
} from '../domain/expenses.js';

type Permissions = ReturnType<typeof createPermissions>;
export type ExpenseDeps = { db: Db; permissions: Permissions };

export const BILL_RECORDED = 'expenses.bill.recorded.v1';
export const BILL_DECIDED = 'expenses.bill.decided.v1';
export const BILL_PAID = 'expenses.bill.paid.v1';

export const DEFAULT_CATEGORIES = [
  'Electricity and water',
  'Repairs and maintenance',
  'Stationery and printing',
  'Fuel and vehicle upkeep',
  'Events and functions',
  'Cleaning and housekeeping',
  'Internet and phone',
  'Rent',
  'Teaching materials',
  'Other',
];

export class ExpenseError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'category_not_found'
      | 'category_exists'
      | 'vendor_not_found'
      | 'bill_not_found'
      | 'file_not_found'
      | 'duplicate_bill'
      | 'future_date'
      | 'not_waiting'
      | 'not_approved'
      | 'own_bill'
      | 'not_yours'
      | 'note_needed'
      | 'reference_needed'
      | 'paid_before_bill',
    readonly details?: Record<string, unknown>,
  ) {
    super(`expenses: ${code}`);
    this.name = 'ExpenseError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function info(tx: Tx, institutionId: string) {
  const i = await institutionInfo(tx, institutionId);
  if (!i) throw new ExpenseError('institution_not_found');
  return i;
}
const res = (actor: Actor, i: { campusId: string; institutionId: string }): Resource => ({
  orgId: actor.orgId,
  place: { campusId: i.campusId, institutionId: i.institutionId },
});
const where = (deps: ExpenseDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, async (tx) => res(actor, await info(tx, institutionId)));

/** Passes when the actor holds any of the permissions at the institution. */
async function assertAny(
  deps: ExpenseDeps,
  tx: Tx,
  actor: Actor,
  permissions: string[],
  institutionId: string,
) {
  const r = res(actor, await info(tx, institutionId));
  let reason: Exclude<Awaited<ReturnType<Permissions['can']>>, { allowed: true }>['reason'] =
    'no_grant';
  for (const p of permissions) {
    const d = await deps.permissions.can(tx, actor, p, r);
    if (d.allowed) return;
    reason = d.reason;
  }
  throw new PermissionDenied(permissions[0] ?? '', reason);
}

function reading<T>(
  deps: ExpenseDeps,
  actor: Actor,
  institutionId: string,
  work: (tx: Tx) => Promise<T>,
  permissions = ['expenses.bill.read'],
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await assertAny(deps, tx, actor, permissions, institutionId);
    return work(tx);
  });
}

/** The default categories for a new organisation. Safe to repeat. */
export async function installExpenseCategories(tx: Tx): Promise<void> {
  for (const name of DEFAULT_CATEGORIES)
    await tx.execute(sql`
      insert into expense_category (org_id, name) values (app_current_org(), ${name}) on conflict do nothing`);
}

// ---------------------------------------------------------------------------------------------
// Categories and vendors
// ---------------------------------------------------------------------------------------------

export type Category = { id: string; name: string; active: boolean };

export async function categories(
  deps: ExpenseDeps,
  actor: Actor,
  institutionId: string,
): Promise<Category[]> {
  return reading(
    deps,
    actor,
    institutionId,
    async (tx) => [
      ...(await tx.execute<Category>(sql`
        select id::text, name, active from expense_category where org_id = app_current_org()
        order by active desc, name`)),
    ],
    ['expenses.bill.read', 'expenses.setup.manage'],
  );
}

export async function saveCategory(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; id: string | null; name: string; active: boolean },
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.setup.manage',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const name = input.name.trim();
      const [same] = await tx.execute<{ id: string }>(sql`
        select id::text from expense_category
        where org_id = app_current_org() and lower(btrim(name)) = lower(${name})`);
      if (same && same.id !== input.id) throw new ExpenseError('category_exists');
      let id = input.id;
      if (id) {
        const done = await tx.execute(sql`
          update expense_category set name = ${name}, active = ${input.active}
          where org_id = app_current_org() and id = ${id} returning id`);
        if (done.length === 0) throw new ExpenseError('category_not_found');
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into expense_category (org_id, name, active) values (app_current_org(), ${name}, ${input.active})
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'expenses.category.save',
          entityType: 'expense_category',
          entityId: id,
          dataClass: 'operational',
          detail: { name, active: input.active },
        },
      };
    },
  );
}

export type VendorInput = {
  institutionId: string;
  id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string;
  active: boolean;
};
export type Vendor = Omit<VendorInput, 'institutionId' | 'id'> & { id: string; bills: number };

export async function vendors(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; search: string },
): Promise<Vendor[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const q = `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return [
      ...(await tx.execute<Vendor>(sql`
        select v.id::text, v.name, v.phone, v.email, v.gstin, v.address, v.active,
          (select count(*)::int from expense_bill b where b.org_id = v.org_id and b.vendor_id = v.id
            and b.state <> 'cancelled') as bills
        from expense_vendor v
        where v.org_id = app_current_org() and (v.name ilike ${q} or coalesce(v.gstin, '') ilike ${q})
        order by v.active desc, v.name limit 200`)),
    ];
  });
}

/** Adds or edits a vendor; the office does this while recording a bill. */
export async function saveVendor(
  deps: ExpenseDeps,
  actor: Actor,
  input: VendorInput,
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.bill.record',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      let id = input.id;
      const v = {
        name: input.name.trim(),
        phone: input.phone,
        email: input.email?.trim() || null,
        gstin: input.gstin,
        address: input.address.trim(),
      };
      if (id) {
        const done = await tx.execute(sql`
          update expense_vendor set name = ${v.name}, phone = ${v.phone}, email = ${v.email}, gstin = ${v.gstin},
            address = ${v.address}, active = ${input.active}
          where org_id = app_current_org() and id = ${id} returning id`);
        if (done.length === 0) throw new ExpenseError('vendor_not_found');
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into expense_vendor (org_id, name, phone, email, gstin, address, active)
          values (app_current_org(), ${v.name}, ${v.phone}, ${v.email}, ${v.gstin}, ${v.address}, ${input.active})
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'expenses.vendor.save',
          entityType: 'expense_vendor',
          entityId: id,
          dataClass: 'operational',
          detail: { name: v.name, gstin: v.gstin, active: input.active },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------------------------

/** The upload check for a bill's photo or PDF: the person recording bills here. */
export async function billUploadCheck(
  deps: ExpenseDeps,
  actor: Actor,
  institutionId: string,
): Promise<{ permission: string; resource: Resource }> {
  return { permission: 'expenses.bill.record', resource: await where(deps, actor, institutionId) };
}

export type BillInput = {
  institutionId: string;
  categoryId: string;
  vendorId: string | null;
  payee: string;
  billNo: string;
  billDate: string;
  description: string;
  amountPaise: number;
  taxPaise: number;
  fileId: string | null;
};

/** The bill's approval in the shared engine: steps by amount from the approval designer. */
async function startBillApproval(tx: Tx, billId: string, requestedBy: string | null) {
  const [b] = await tx.execute<{
    institutionId: string;
    amountPaise: string;
    payTo: string;
    billNo: string;
  }>(sql`
    select b.institution_id::text as "institutionId", b.amount_paise::text as "amountPaise",
      coalesce(v.name, b.payee) as "payTo", coalesce(nullif(b.bill_no, ''), b.description) as "billNo"
    from expense_bill b left join expense_vendor v on v.org_id = b.org_id and v.id = b.vendor_id
    where b.org_id = app_current_org() and b.id = ${billId}`);
  if (!b) throw new ExpenseError('bill_not_found');
  await startApproval(tx, {
    process: 'expenses.bill',
    subjectId: billId,
    institutionId: b.institutionId,
    amountPaise: Number(b.amountPaise),
    summary: `${b.payTo} · ${b.billNo}`,
    requestedBy,
  });
}

export async function recordBill(
  deps: ExpenseDeps,
  actor: Actor,
  input: BillInput,
): Promise<{ billId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.bill.record',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const i = await info(tx, input.institutionId);
      if (input.billDate > (await today(tx))) throw new ExpenseError('future_date');
      const [c] = await tx.execute(sql`
        select 1 from expense_category where org_id = app_current_org() and id = ${input.categoryId} and active`);
      if (!c) throw new ExpenseError('category_not_found');
      if (input.vendorId) {
        const [v] = await tx.execute(sql`
          select 1 from expense_vendor where org_id = app_current_org() and id = ${input.vendorId} and active`);
        if (!v) throw new ExpenseError('vendor_not_found');
        if (input.billNo.trim()) {
          const [dup] = await tx.execute<{ id: string }>(sql`
            select id::text from expense_bill where org_id = app_current_org() and vendor_id = ${input.vendorId}
              and upper(btrim(bill_no)) = upper(${input.billNo.trim()}) and state <> 'cancelled'`);
          if (dup) throw new ExpenseError('duplicate_bill', { billId: dup.id });
        }
      }
      if (input.fileId) {
        const [f] = await filesInfo(tx, [input.fileId]);
        if (!f || f.state === 'infected' || f.state === 'rejected')
          throw new ExpenseError('file_not_found');
      }
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into expense_bill (org_id, institution_id, legal_entity_id, financial_year, category_id, vendor_id,
          payee, bill_no, bill_date, description, amount_paise, tax_paise, file_id, recorded_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${i.legalEntityId}, ${financialYear(input.billDate)},
          ${input.categoryId}, ${input.vendorId}, ${input.vendorId ? '' : input.payee.trim()}, ${input.billNo.trim()},
          ${input.billDate}::date, ${input.description.trim()}, ${input.amountPaise}, ${input.taxPaise},
          ${input.fileId}, ${actor.personId})
        returning id::text`);
      const billId = row?.id ?? '';
      await startBillApproval(tx, billId, actor.personId);
      return {
        result: { billId },
        audit: {
          action: 'expenses.bill.record',
          entityType: 'expense_bill',
          entityId: billId,
          dataClass: 'operational',
          detail: {
            amountPaise: input.amountPaise,
            categoryId: input.categoryId,
            billNo: input.billNo.trim(),
          },
        },
        events: [{ type: BILL_RECORDED, payload: { billId, institutionId: input.institutionId } }],
      };
    },
  );
}

export type BillState = 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled';
export type BillRow = {
  billId: string;
  categoryId: string;
  category: string;
  vendorId: string | null;
  payTo: string;
  billNo: string;
  billDate: string;
  financialYear: string;
  description: string;
  amountPaise: number;
  taxPaise: number;
  fileId: string | null;
  state: BillState;
  recordedById: string;
  recordedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  voucherNo: string | null;
  paidOn: string | null;
  mode: Mode | null;
  reference: string | null;
  createdAt: string;
  /** The approval in the shared engine: step, who decides, and whether the viewer may. */
  approval?: ApprovalState | null;
};

async function billRows(tx: Tx, filter: ReturnType<typeof sql>): Promise<BillRow[]> {
  const rows = await tx.execute<
    Omit<BillRow, 'recordedBy' | 'decidedBy' | 'amountPaise' | 'taxPaise'> & {
      decidedById: string | null;
      amountPaise: string;
      taxPaise: string;
    }
  >(sql`
    select b.id::text as "billId", b.category_id::text as "categoryId", c.name as category,
      b.vendor_id::text as "vendorId", coalesce(v.name, b.payee) as "payTo", b.bill_no as "billNo",
      b.bill_date::text as "billDate", b.financial_year as "financialYear", b.description,
      b.amount_paise::text as "amountPaise", b.tax_paise::text as "taxPaise", b.file_id::text as "fileId", b.state,
      b.recorded_by_person_id::text as "recordedById", b.decided_by_person_id::text as "decidedById",
      b.decided_at as "decidedAt", b.decision_note as "decisionNote", p.voucher_no as "voucherNo",
      p.paid_on::text as "paidOn", p.mode, p.reference, b.created_at as "createdAt"
    from expense_bill b
    join expense_category c on c.org_id = b.org_id and c.id = b.category_id
    left join expense_vendor v on v.org_id = b.org_id and v.id = b.vendor_id
    left join expense_payment p on p.org_id = b.org_id and p.bill_id = b.id
    where b.org_id = app_current_org() and ${filter}
    order by b.created_at desc
    limit 500`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.recordedById, r.decidedById].filter((x): x is string => !!x)),
  );
  return rows.map(({ decidedById, ...r }) => ({
    ...r,
    amountPaise: Number(r.amountPaise),
    taxPaise: Number(r.taxPaise),
    recordedBy: names[r.recordedById] ?? null,
    decidedBy: decidedById ? (names[decidedById] ?? null) : null,
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

const VIEWS = {
  waiting: sql`b.state = 'submitted'`,
  to_pay: sql`b.state = 'approved'`,
  paid: sql`b.state = 'paid'`,
  closed: sql`b.state in ('rejected', 'cancelled')`,
  all: sql`true`,
} as const;
export type BillView = keyof typeof VIEWS;

export async function bills(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; view: BillView; search: string },
): Promise<BillRow[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const q = `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await billRows(
      tx,
      sql`b.institution_id = ${input.institutionId} and ${VIEWS[input.view]}
        and (b.description ilike ${q} or b.bill_no ilike ${q} or coalesce(v.name, b.payee) ilike ${q}
          or coalesce(p.voucher_no, '') ilike ${q})`,
    );
    const states = await approvalStates(
      tx,
      deps.permissions,
      actor,
      'expenses.bill',
      rows.filter((r) => r.state === 'submitted').map((r) => r.billId),
    );
    return rows.map((r) => ({ ...r, approval: states[r.billId] ?? null }));
  });
}

async function positionOf(tx: Tx, b: BillRow, institutionId: string): Promise<BudgetPosition> {
  const [r] = await tx.execute<{ budget: string | null; committed: string }>(sql`
    select (select amount_paise::text from expense_budget where org_id = app_current_org()
        and institution_id = ${institutionId} and category_id = ${b.categoryId}
        and financial_year = ${b.financialYear}) as budget,
      (select coalesce(sum(amount_paise), 0)::text from expense_bill where org_id = app_current_org()
        and institution_id = ${institutionId} and category_id = ${b.categoryId}
        and financial_year = ${b.financialYear} and state in ('approved', 'paid') and id <> ${b.billId}) as committed`);
  // A bill that's rejected or cancelled adds nothing.
  const counts = b.state === 'submitted' || b.state === 'approved' || b.state === 'paid';
  return budgetPosition(
    r?.budget == null ? null : Number(r.budget),
    Number(r?.committed ?? 0),
    counts ? b.amountPaise : 0,
  );
}

/** One bill with its budget position: what an approver looks at. */
export async function bill(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; billId: string },
): Promise<BillRow & { position: BudgetPosition }> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const [b] = await billRows(
      tx,
      sql`b.institution_id = ${input.institutionId} and b.id = ${input.billId}`,
    );
    if (!b) throw new ExpenseError('bill_not_found');
    const states = await approvalStates(tx, deps.permissions, actor, 'expenses.bill', [b.billId]);
    return {
      ...b,
      approval: states[b.billId] ?? null,
      position: await positionOf(tx, b, input.institutionId),
    };
  });
}

/** The bill's photo or PDF, for someone who may see bills here. */
export async function billFile(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; billId: string },
): Promise<string> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const [b] = await tx.execute<{ fileId: string | null }>(sql`
      select file_id::text as "fileId" from expense_bill
      where org_id = app_current_org() and id = ${input.billId} and institution_id = ${input.institutionId}`);
    if (!b?.fileId) throw new ExpenseError('file_not_found');
    return b.fileId;
  });
}

async function lockBill(tx: Tx, institutionId: string, billId: string) {
  const [b] = await tx.execute<{
    state: BillState;
    recordedBy: string;
    amountPaise: string;
    billDate: string;
    legalEntityId: string;
  }>(sql`
    select state, recorded_by_person_id::text as "recordedBy", amount_paise::text as "amountPaise",
      bill_date::text as "billDate", legal_entity_id::text as "legalEntityId"
    from expense_bill where org_id = app_current_org() and id = ${billId} and institution_id = ${institutionId}
    for update`);
  if (!b) throw new ExpenseError('bill_not_found');
  return { ...b, amountPaise: Number(b.amountPaise) };
}

/**
 * Decides the bill's current approval step through the shared engine: who may decide, and how
 * many steps a bill of this amount needs, come from the approval designer. Never one you
 * recorded; a rejection says why. The bill is approved after the last step.
 */
export async function decideBill(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; billId: string; approve: boolean; note: string },
): Promise<'approved' | 'rejected' | 'pending'> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.bill.read',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const b = await lockBill(tx, input.institutionId, input.billId);
      if (b.state !== 'submitted') throw new ExpenseError('not_waiting', { state: b.state });
      if (b.recordedBy === actor.personId) throw new ExpenseError('own_bill');
      const note = input.note.trim();
      if (!input.approve && note.length < 3) throw new ExpenseError('note_needed');
      const outcome = await decideApproval(tx, deps.permissions, actor, {
        process: 'expenses.bill',
        subjectId: input.billId,
        approve: input.approve,
        note: note || null,
      });
      if (outcome === 'pending')
        return {
          result: outcome,
          audit: {
            action: 'expenses.bill.step_approve',
            entityType: 'expense_bill',
            entityId: input.billId,
            dataClass: 'operational',
            detail: { amountPaise: b.amountPaise },
          },
        };
      await tx.execute(sql`
        update expense_bill set state = ${outcome},
          decided_by_person_id = ${actor.personId}, decided_at = now(), decision_note = ${note || null}
        where org_id = app_current_org() and id = ${input.billId}`);
      return {
        result: outcome,
        audit: {
          action: input.approve ? 'expenses.bill.approve' : 'expenses.bill.reject',
          entityType: 'expense_bill',
          entityId: input.billId,
          dataClass: 'operational',
          detail: { amountPaise: b.amountPaise, note: note || null },
        },
        events: [
          {
            type: BILL_DECIDED,
            payload: {
              billId: input.billId,
              approved: outcome === 'approved',
              institutionId: input.institutionId,
            },
          },
        ],
      };
    },
  );
}

/** Withdraws a waiting bill: the person who recorded it, or an approver. */
export async function cancelBill(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; billId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.bill.record',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const b = await lockBill(tx, input.institutionId, input.billId);
      if (b.state !== 'submitted') throw new ExpenseError('not_waiting', { state: b.state });
      if (b.recordedBy !== actor.personId) {
        const d = await deps.permissions.can(
          tx,
          actor,
          'expenses.bill.approve',
          res(actor, await info(tx, input.institutionId)),
        );
        if (!d.allowed) throw new ExpenseError('not_yours');
      }
      await tx.execute(sql`
        update expense_bill set state = 'cancelled' where org_id = app_current_org() and id = ${input.billId}`);
      await withdrawApproval(tx, 'expenses.bill', input.billId);
      return {
        result: undefined,
        audit: {
          action: 'expenses.bill.cancel',
          entityType: 'expense_bill',
          entityId: input.billId,
          dataClass: 'operational',
          detail: {},
        },
      };
    },
  );
}

/**
 * Pays an approved bill in full and issues the next voucher number for the legal entity and the
 * payment's financial year, with no gaps: the counter row stays locked until the payment commits.
 */
export async function payBill(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; billId: string; mode: Mode; reference: string; paidOn: string },
): Promise<{ voucherNo: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.bill.pay',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const b = await lockBill(tx, input.institutionId, input.billId);
      if (b.state !== 'approved') throw new ExpenseError('not_approved', { state: b.state });
      const problem = payProblem({ ...input, billDate: b.billDate, today: await today(tx) });
      if (problem) throw new ExpenseError(problem);
      const fy = financialYear(input.paidOn);
      await tx.execute(sql`
        insert into expense_voucher_counter (org_id, legal_entity_id, financial_year)
        values (app_current_org(), ${b.legalEntityId}, ${fy}) on conflict do nothing`);
      const [counter] = await tx.execute<{ n: number }>(sql`
        update expense_voucher_counter set next_number = next_number + 1
        where org_id = app_current_org() and legal_entity_id = ${b.legalEntityId} and financial_year = ${fy}
        returning next_number - 1 as n`);
      if (!counter) throw new Error('payBill: no counter');
      const number = voucherNo(fy, counter.n);
      await tx.execute(sql`
        insert into expense_payment (org_id, bill_id, legal_entity_id, financial_year, voucher_no, mode, reference,
          paid_on, amount_paise, paid_by_person_id)
        values (app_current_org(), ${input.billId}, ${b.legalEntityId}, ${fy}, ${number}, ${input.mode},
          ${input.reference.trim()}, ${input.paidOn}::date, ${b.amountPaise}, ${actor.personId})`);
      await tx.execute(sql`
        update expense_bill set state = 'paid' where org_id = app_current_org() and id = ${input.billId}`);
      return {
        result: { voucherNo: number },
        audit: {
          action: 'expenses.bill.pay',
          entityType: 'expense_bill',
          entityId: input.billId,
          dataClass: 'operational',
          detail: { voucherNo: number, mode: input.mode, amountPaise: b.amountPaise },
        },
        events: [
          {
            type: BILL_PAID,
            payload: {
              billId: input.billId,
              voucherNo: number,
              institutionId: input.institutionId,
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Budgets and figures
// ---------------------------------------------------------------------------------------------

export type BudgetRow = {
  categoryId: string;
  category: string;
  active: boolean;
  budgetPaise: number | null;
  committedPaise: number;
  paidPaise: number;
  waitingPaise: number;
  leftPaise: number | null;
  over: boolean;
};

async function budgetRows(tx: Tx, institutionId: string, fy: string): Promise<BudgetRow[]> {
  const rows = await tx.execute<{
    categoryId: string;
    category: string;
    active: boolean;
    // Bigint sums come back as text.
    budgetPaise: string | null;
    committedPaise: string;
    paidPaise: string;
    waitingPaise: string;
  }>(sql`
    select c.id::text as "categoryId", c.name as category, c.active, bu.amount_paise::text as "budgetPaise",
      coalesce(sum(b.amount_paise) filter (where b.state in ('approved', 'paid')), 0)::text as "committedPaise",
      coalesce(sum(b.amount_paise) filter (where b.state = 'paid'), 0)::text as "paidPaise",
      coalesce(sum(b.amount_paise) filter (where b.state = 'submitted'), 0)::text as "waitingPaise"
    from expense_category c
    left join expense_budget bu on bu.org_id = c.org_id and bu.category_id = c.id
      and bu.institution_id = ${institutionId} and bu.financial_year = ${fy}
    left join expense_bill b on b.org_id = c.org_id and b.category_id = c.id
      and b.institution_id = ${institutionId} and b.financial_year = ${fy}
    where c.org_id = app_current_org()
    group by c.org_id, c.id, c.name, c.active, bu.amount_paise
    order by c.name`);
  return rows
    .map((raw) => {
      const r = {
        ...raw,
        budgetPaise: raw.budgetPaise == null ? null : Number(raw.budgetPaise),
        committedPaise: Number(raw.committedPaise),
        paidPaise: Number(raw.paidPaise),
        waitingPaise: Number(raw.waitingPaise),
      };
      const p = budgetPosition(r.budgetPaise, r.committedPaise, 0);
      return { ...r, leftPaise: p.leftPaise, over: p.over };
    })
    .filter(
      (r) => r.active || r.committedPaise > 0 || r.waitingPaise > 0 || r.budgetPaise !== null,
    );
}

export async function budgets(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; financialYear: string | null },
): Promise<{ financialYear: string; rows: BudgetRow[] }> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    const fy = input.financialYear ?? financialYear(await today(tx));
    return { financialYear: fy, rows: await budgetRows(tx, input.institutionId, fy) };
  });
}

export async function setBudget(
  deps: ExpenseDeps,
  actor: Actor,
  input: { institutionId: string; categoryId: string; financialYear: string; amountPaise: number },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'expenses.setup.manage',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const [c] = await tx.execute(sql`
        select 1 from expense_category where org_id = app_current_org() and id = ${input.categoryId}`);
      if (!c) throw new ExpenseError('category_not_found');
      await tx.execute(sql`
        insert into expense_budget (org_id, institution_id, category_id, financial_year, amount_paise)
        values (app_current_org(), ${input.institutionId}, ${input.categoryId}, ${input.financialYear}, ${input.amountPaise})
        on conflict (org_id, institution_id, category_id, financial_year)
        do update set amount_paise = excluded.amount_paise, updated_at = now()`);
      return {
        result: undefined,
        audit: {
          action: 'expenses.budget.set',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'operational',
          detail: { ...input },
        },
      };
    },
  );
}

export type ExpenseFigures = {
  financialYear: string;
  committedPaise: number;
  paidPaise: number;
  waiting: number;
  waitingPaise: number;
  toPay: number;
  toPayPaise: number;
  overBudget: number;
};

async function figures(tx: Tx, institutionId: string): Promise<ExpenseFigures> {
  const fy = financialYear(await today(tx));
  const [f] = await tx.execute<{
    committedPaise: string;
    paidPaise: string;
    waiting: number;
    waitingPaise: string;
    toPay: number;
    toPayPaise: string;
  }>(sql`
    select coalesce(sum(amount_paise) filter (where financial_year = ${fy} and state in ('approved', 'paid')), 0)::text
        as "committedPaise",
      coalesce(sum(amount_paise) filter (where financial_year = ${fy} and state = 'paid'), 0)::text as "paidPaise",
      count(*) filter (where state = 'submitted')::int as waiting,
      coalesce(sum(amount_paise) filter (where state = 'submitted'), 0)::text as "waitingPaise",
      count(*) filter (where state = 'approved')::int as "toPay",
      coalesce(sum(amount_paise) filter (where state = 'approved'), 0)::text as "toPayPaise"
    from expense_bill where org_id = app_current_org() and institution_id = ${institutionId}`);
  const rows = await budgetRows(tx, institutionId, fy);
  return {
    financialYear: fy,
    committedPaise: Number(f?.committedPaise ?? 0),
    paidPaise: Number(f?.paidPaise ?? 0),
    waiting: f?.waiting ?? 0,
    waitingPaise: Number(f?.waitingPaise ?? 0),
    toPay: f?.toPay ?? 0,
    toPayPaise: Number(f?.toPayPaise ?? 0),
    overBudget: rows.filter((r) => r.over).length,
  };
}

export async function expenseFigures(deps: ExpenseDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, (tx) => figures(tx, institutionId));
}

/** This year by category against budget, for Verse AI: amounts only, no names. */
export async function expenseSummary(deps: ExpenseDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, async (tx) => {
    const f = await figures(tx, institutionId);
    const rows = await budgetRows(tx, institutionId, f.financialYear);
    return {
      ...f,
      byCategory: rows
        .filter((r) => r.committedPaise > 0 || r.budgetPaise !== null || r.waitingPaise > 0)
        .map((r) => ({
          category: r.category,
          budgetPaise: r.budgetPaise,
          committedPaise: r.committedPaise,
          paidPaise: r.paidPaise,
          waitingPaise: r.waitingPaise,
          over: r.over,
        })),
    };
  });
}
