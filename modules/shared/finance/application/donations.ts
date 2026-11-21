// Voluntary donations to the institution's trust or society (owner's brief, 21 Nov 2026; rule
// book §13 Finance › Fund Accounting, Career Connect › Alumni Giving "donations with receipts
// through Accounts"). Never a fee and never tied to a seat: a capitation fee is unlawful (RTE Act
// 2009 s.13; state capitation fee acts), so a family with an admission in progress (or a child
// admitted in the last 90 days) can't donate, and every receipt says the gift is voluntary.
// Their own gapless receipt series per legal entity and financial year; cancelled, never edited.
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { financialYear } from '../domain/money.js';
import { DATE, FinanceError, institution, placeOf, today, type FinanceDeps } from './common.js';

export const DONATION_RECORDED = 'finance.donation.recorded.v1';
export const DONATION_CANCELLED = 'finance.donation.cancelled.v1';

export type DonationMethod = 'cash' | 'cheque' | 'upi' | 'card' | 'netbanking' | 'bank_transfer';
const METHODS: readonly DonationMethod[] = [
  'cash',
  'cheque',
  'upi',
  'card',
  'netbanking',
  'bank_transfer',
];
const PHONE = /^\+91[6-9][0-9]{9}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type DonationInput = {
  institutionId: string;
  donorKind: 'person' | 'organisation';
  donorName: string;
  donorPhone?: string | null | undefined;
  donorEmail?: string | null | undefined;
  donorAddress?: string | null | undefined;
  fund: string;
  amountPaise: number;
  method: DonationMethod;
  instrumentRef?: string | null | undefined;
  receivedOn: string;
  note?: string | null | undefined;
  /** The person recording confirms the donor gives freely, for nothing in return. */
  voluntary: boolean;
};

export type DonationRow = {
  id: string;
  number: string;
  donorKind: 'person' | 'organisation';
  donorName: string;
  fund: string;
  amountPaise: number;
  method: DonationMethod;
  receivedOn: string;
  cancelled: boolean;
};

export type Donations = {
  financialYear: string;
  /** Financial years with donations, newest first (always includes this one). */
  years: string[];
  totalPaise: number;
  count: number;
  donors: number;
  byFund: { fund: string; amountPaise: number; count: number }[];
  /** Funds used before, for the form's suggestions. */
  funds: string[];
  donations: DonationRow[];
};

export type DonationReceipt = DonationRow & {
  entity: string;
  institution: string;
  donorPhone: string | null;
  donorEmail: string | null;
  donorAddress: string | null;
  instrumentRef: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  canCancel: boolean;
};

const number = (fy: string, n: number) => `DON/${fy}/${String(n).padStart(6, '0')}`;

async function placeFor(deps: FinanceDeps, actor: Actor, institutionId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, institutionId)),
  );
}

/**
 * Records a donation and issues its receipt number. Refused from a family with an admission in
 * progress, without the voluntary confirmation, or dated ahead or in an earlier financial year.
 */
export async function recordDonation(
  deps: FinanceDeps,
  actor: Actor,
  input: DonationInput,
): Promise<{ id: string; number: string }> {
  if (!input.voluntary) throw new FinanceError('not_voluntary');
  const donorName = input.donorName.trim();
  const fund = input.fund.trim() || 'General fund';
  const phone = input.donorPhone?.trim() || null;
  const email = input.donorEmail?.trim().toLowerCase() || null;
  const ref = input.instrumentRef?.trim() || null;
  if (!donorName || donorName.length > 120) throw new FinanceError('donor_required');
  if (phone && !PHONE.test(phone)) throw new FinanceError('bad_phone');
  if (email && !EMAIL.test(email)) throw new FinanceError('bad_email');
  if (input.donorKind === 'person' && !phone && !email) throw new FinanceError('contact_required');
  if (fund.length > 60) throw new FinanceError('bad_fund');
  if (!METHODS.includes(input.method)) throw new FinanceError('bad_method');
  if (input.method !== 'cash' && !ref) throw new FinanceError('instrument_ref_required');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0)
    throw new FinanceError('bad_amount');
  if (!DATE.test(input.receivedOn)) throw new FinanceError('bad_date');
  const place = await placeFor(deps, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.donation.record', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const day = await today(tx);
      if (input.receivedOn > day) throw new FinanceError('future_date');
      const fy = financialYear(day);
      if (financialYear(input.receivedOn) !== fy) throw new FinanceError('earlier_year');
      if (
        deps.admissionInProgress &&
        (await deps.admissionInProgress(tx, {
          institutionId: input.institutionId,
          phone,
          email,
        }))
      )
        throw new FinanceError('admission_in_progress');
      const inst = await institution(tx, input.institutionId);
      await tx.execute(sql`
        insert into donation_counter (org_id, legal_entity_id, financial_year)
        values (app_current_org(), ${inst.legalEntityId}, ${fy}) on conflict do nothing`);
      const [counter] = await tx.execute<{ n: number }>(sql`
        update donation_counter set next_number = next_number + 1
        where org_id = app_current_org() and legal_entity_id = ${inst.legalEntityId} and financial_year = ${fy}
        returning next_number - 1 as n`);
      if (!counter) throw new Error('recordDonation: no counter');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into donation (org_id, legal_entity_id, institution_id, financial_year, number, donor_kind, donor_name,
          donor_phone, donor_email, donor_address, fund, amount_paise, method, instrument_ref, received_on, note,
          recorded_by_person_id)
        values (app_current_org(), ${inst.legalEntityId}, ${input.institutionId}, ${fy}, ${counter.n},
          ${input.donorKind}, ${donorName}, ${phone}, ${email}, ${input.donorAddress?.trim() || null}, ${fund},
          ${input.amountPaise}, ${input.method}, ${ref}, ${input.receivedOn}, ${input.note?.trim() || null},
          ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('recordDonation: no row');
      const no = number(fy, counter.n);
      return {
        result: { id: row.id, number: no },
        audit: {
          action: 'finance.donation.record',
          entityType: 'donation',
          entityId: row.id,
          dataClass: 'personal',
          detail: { number: no, amountPaise: input.amountPaise, fund },
        },
        events: [
          {
            type: DONATION_RECORDED,
            payload: {
              donationId: row.id,
              institutionId: input.institutionId,
              amountPaise: input.amountPaise,
              fund,
            },
          },
        ],
      };
    },
  );
}

const rowSelect = sql`
  select d.id::text, d.financial_year as fy, d.number as n, d.donor_kind as "donorKind", d.donor_name as "donorName",
    d.fund, d.amount_paise::bigint::float8 as "amountPaise", d.method, d.received_on::text as "receivedOn",
    d.cancelled_at is not null as cancelled`;

type RawRow = Omit<DonationRow, 'number'> & { fy: string; n: number };
const toRow = ({ fy, n, ...r }: RawRow): DonationRow => ({ ...r, number: number(fy, n) });

/** An institution's donations in a financial year, with totals by fund. */
export async function donations(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
  fy: string | null,
): Promise<Donations> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.donation.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    const current = financialYear(await today(tx));
    const year = fy && /^\d{4}-\d{2}$/.test(fy) ? fy : current;
    const rows = (
      await tx.execute<RawRow>(sql`
        ${rowSelect} from donation d
        where d.org_id = app_current_org() and d.institution_id = ${institutionId} and d.financial_year = ${year}
        order by d.received_on desc, d.number desc`)
    ).map(toRow);
    const live = rows.filter((r) => !r.cancelled);
    const byFund = new Map<string, { amountPaise: number; count: number }>();
    for (const r of live) {
      const f = byFund.get(r.fund) ?? { amountPaise: 0, count: 0 };
      byFund.set(r.fund, { amountPaise: f.amountPaise + r.amountPaise, count: f.count + 1 });
    }
    const years = (
      await tx.execute<{ y: string }>(sql`
        select distinct financial_year as y from donation
        where org_id = app_current_org() and institution_id = ${institutionId}`)
    ).map((r) => r.y);
    const funds = (
      await tx.execute<{ f: string }>(sql`
        select fund as f from donation where org_id = app_current_org() and institution_id = ${institutionId}
        group by fund order by count(*) desc, fund limit 12`)
    ).map((r) => r.f);
    return {
      financialYear: year,
      years: [...new Set([current, ...years])].sort().reverse(),
      totalPaise: live.reduce((a, r) => a + r.amountPaise, 0),
      count: live.length,
      donors: new Set(live.map((r) => r.donorName.toLowerCase())).size,
      byFund: [...byFund]
        .map(([fund, v]) => ({ fund, ...v }))
        .sort((a, b) => b.amountPaise - a.amountPaise),
      funds: funds.length ? funds : ['General fund'],
      donations: rows,
    };
  });
}

async function donationPlace(tx: Tx, donationId: string) {
  const [d] = await tx.execute<{ institutionId: string; recordedBy: string }>(sql`
    select institution_id::text as "institutionId", recorded_by_person_id::text as "recordedBy"
    from donation where org_id = app_current_org() and id = ${donationId}`);
  if (!d) throw new FinanceError('donation_not_found');
  return { ...d, place: placeOf(await institution(tx, d.institutionId)) };
}

/** One donation receipt, for printing. */
export async function donationReceipt(
  deps: FinanceDeps,
  actor: Actor,
  donationId: string,
): Promise<DonationReceipt> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await donationPlace(tx, donationId);
    await deps.permissions.assertCan(tx, actor, 'finance.donation.read', {
      orgId: actor.orgId,
      place: d.place,
    });
    const [r] = await tx.execute<
      RawRow & Omit<DonationReceipt, keyof DonationRow | 'entity' | 'institution' | 'canCancel'>
    >(sql`
      ${rowSelect}, d.donor_phone as "donorPhone", d.donor_email as "donorEmail", d.donor_address as "donorAddress",
        d.instrument_ref as "instrumentRef", d.note, pr.legal_name as "recordedBy", d.created_at::text as "recordedAt",
        d.cancelled_at::text as "cancelledAt", pc.legal_name as "cancelledBy", d.cancel_reason as "cancelReason"
      from donation d
      join person pr on pr.org_id = d.org_id and pr.id = d.recorded_by_person_id
      left join person pc on pc.org_id = d.org_id and pc.id = d.cancelled_by_person_id
      where d.org_id = app_current_org() and d.id = ${donationId}`);
    if (!r) throw new FinanceError('donation_not_found');
    const inst = await institution(tx, d.institutionId);
    const canCancel =
      !r.cancelled &&
      d.recordedBy !== actor.personId &&
      (
        await deps.permissions.can(tx, actor, 'finance.donation.cancel', {
          orgId: actor.orgId,
          place: d.place,
        })
      ).allowed;
    return {
      ...toRow(r),
      entity: inst.legalEntityName,
      institution: inst.name,
      donorPhone: r.donorPhone,
      donorEmail: r.donorEmail,
      donorAddress: r.donorAddress,
      instrumentRef: r.instrumentRef,
      note: r.note,
      recordedBy: r.recordedBy,
      recordedAt: r.recordedAt,
      cancelledAt: r.cancelledAt,
      cancelledBy: r.cancelledBy,
      cancelReason: r.cancelReason,
      canCancel,
    };
  });
}

/** Cancels a donation recorded by mistake: someone other than the recorder, with a reason. */
export async function cancelDonation(
  deps: FinanceDeps,
  actor: Actor,
  input: { donationId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new FinanceError('reason_required');
  const d = await withTenant(deps.db, actor.orgId, (tx) => donationPlace(tx, input.donationId));
  if (d.recordedBy === actor.personId) throw new FinanceError('maker_checker');
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.donation.cancel', resource: { orgId: actor.orgId, place: d.place } },
    async (tx) => {
      const [row] = await tx.execute<{ amount: number }>(sql`
        update donation set cancelled_at = now(), cancelled_by_person_id = ${actor.personId}, cancel_reason = ${reason}
        where org_id = app_current_org() and id = ${input.donationId} and cancelled_at is null
        returning amount_paise::bigint::float8 as amount`);
      if (!row) throw new FinanceError('already_cancelled');
      return {
        result: undefined,
        audit: {
          action: 'finance.donation.cancel',
          entityType: 'donation',
          entityId: input.donationId,
          dataClass: 'personal',
          reason,
          detail: { amountPaise: row.amount },
        },
        events: [
          {
            type: DONATION_CANCELLED,
            payload: { donationId: input.donationId, amountPaise: row.amount },
          },
        ],
      };
    },
  );
}
