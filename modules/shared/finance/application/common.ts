import { type Db, type Tx } from '@campusverse/db';
import { institutionInfo } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import type { AudiencePort } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { financialYear, invoiceState } from '../domain/money.js';
import type { Gateway } from './gateway.js';

export type Permissions = ReturnType<typeof createPermissions>;
export type FinanceDeps = {
  db: Db;
  permissions: Permissions;
  /** Which students a plan's classes and sections hold (school: schoolAudience). */
  audience: AudiencePort;
  /** Null when online payment isn't configured. */
  gateway: Gateway | null;
  returnUrl?: string | undefined;
  /** Super admin: the online_payments flag and the payments_off switch. Unset means allowed. */
  onlinePaymentsAllowed?: ((orgId: string) => Promise<boolean>) | undefined;
  /** Class and admission number beside each name, so same-name students can be told apart (school: schoolPlacement). */
  placements?: PlacementLookup[] | undefined;
};

/** The part of people-records' AcademicPlacementPort finance needs. */
export type PlacementLookup = {
  getPlacements(
    tx: Tx,
    input: { personIds: string[]; onDate: string },
  ): Promise<Map<string, { displayLabel: string; reference: string | null }>>;
  findByReference(tx: Tx, input: { institutionId: string; text: string }): Promise<string[]>;
};

export const PAYMENT_SUCCEEDED = 'finance.payment.succeeded.v1';
export const PAYMENT_REVERSED = 'finance.payment.reversed.v1';
export const INVOICE_OVERDUE = 'finance.invoice.overdue.v1';
export const REFUND_ISSUED = 'finance.refund.issued.v1';
export const ONLINE_PAYMENT_STARTED = 'finance.payment.started.v1';

export class FinanceError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Finance: ${code}`);
    this.name = 'FinanceError';
  }
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function today(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return row?.d ?? '';
}

export async function institution(tx: Tx, institutionId: string) {
  const i = await institutionInfo(tx, institutionId);
  if (!i) throw new FinanceError('institution_not_found');
  return i;
}

export const placeOf = (i: { campusId: string; institutionId: string }) => ({
  campusId: i.campusId,
  institutionId: i.institutionId,
});

/** Recomputes an invoice's total, paid amount and state from its lines and allocations. */
export async function refreshInvoice(tx: Tx, invoiceId: string): Promise<void> {
  const [row] = await tx.execute<{
    total: string;
    paid: string;
    dueOn: string;
    state: string;
    today: string;
  }>(sql`
    select
      (select coalesce(sum(amount_paise), 0) from fee_invoice_line where org_id = i.org_id and invoice_id = i.id)::text as total,
      (select coalesce(sum(amount_paise), 0) from fee_allocation where org_id = i.org_id and invoice_id = i.id)::text as paid,
      i.due_on::text as "dueOn", i.state, app_today()::text as today
    from fee_invoice i where i.org_id = app_current_org() and i.id = ${invoiceId} for update`);
  if (!row) throw new FinanceError('invoice_not_found');
  const total = Number(row.total);
  const paid = Number(row.paid);
  const state =
    row.state === 'written_off' ? 'written_off' : invoiceState(total, paid, row.dueOn, row.today);
  await tx.execute(sql`
    update fee_invoice set total_paise = ${total}, paid_paise = ${paid}, state = ${state}
    where org_id = app_current_org() and id = ${invoiceId}`);
}

export type ReceiptKind = 'receipt' | 'reversal' | 'refund';

/**
 * Issues the next receipt number for the legal entity and financial year, with no gaps: the
 * counter row is locked until the transaction ends. Receipts are never edited afterwards.
 */
export async function issueReceipt(
  tx: Tx,
  actor: Actor | null,
  input: {
    kind: ReceiptKind;
    legalEntityId: string;
    paymentId: string;
    refundId?: string | null;
    studentId: string;
    amountPaise: number;
    snapshot: Record<string, unknown>;
  },
): Promise<{ id: string; number: string }> {
  const fy = financialYear(await today(tx));
  await tx.execute(sql`
    insert into fee_receipt_counter (org_id, legal_entity_id, financial_year)
    values (app_current_org(), ${input.legalEntityId}, ${fy}) on conflict do nothing`);
  const [counter] = await tx.execute<{ n: number }>(sql`
    update fee_receipt_counter set next_number = next_number + 1
    where org_id = app_current_org() and legal_entity_id = ${input.legalEntityId} and financial_year = ${fy}
    returning next_number - 1 as n`);
  if (!counter) throw new Error('issueReceipt: no counter');
  const number = `${fy}/${String(counter.n).padStart(6, '0')}`;
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into fee_receipt (org_id, legal_entity_id, financial_year, number, kind, payment_id, refund_id,
      student_person_id, amount_paise, snapshot, issued_by_person_id)
    values (app_current_org(), ${input.legalEntityId}, ${fy}, ${counter.n}, ${input.kind}, ${input.paymentId},
      ${input.refundId ?? null}, ${input.studentId}, ${input.amountPaise},
      ${JSON.stringify({ ...input.snapshot, number })}::jsonb, ${actor?.personId ?? null})
    returning id::text`);
  if (!row) throw new Error('issueReceipt: no row');
  return { id: row.id, number };
}
