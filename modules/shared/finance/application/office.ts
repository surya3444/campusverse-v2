// The accounts office: counter search, day close, dues and reminders, reconciliation.
import { withTenant } from '@campusverse/db';
import { command, emit } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { ageBucket, rupees, type AgeBucket } from '../domain/money.js';
import {
  FinanceError,
  INVOICE_OVERDUE,
  institution,
  placeOf,
  today,
  type FinanceDeps,
} from './common.js';
import { checkOnlinePayment } from './payments.js';

export type CounterStudent = {
  studentId: string;
  name: string;
  balancePaise: number;
  nextDue: string | null;
  placement: string | null;
  /** Admission number in schools. */
  reference: string | null;
};

/** Students billed by this institution, by name or admission number: the counter's first step. */
export async function searchStudents(
  deps: FinanceDeps,
  actor: Actor,
  input: { institutionId: string; search: string },
): Promise<CounterStudent[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, input.institutionId)),
    });
    const q = `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // Admission numbers come from the academic module; finance never reads its tables.
    const byNumber = (
      await Promise.all(
        (deps.placements ?? []).map((p) =>
          p.findByReference(tx, { institutionId: input.institutionId, text: input.search }),
        ),
      )
    ).flat();
    const rows = await tx.execute<Omit<CounterStudent, 'placement' | 'reference'>>(sql`
        select i.student_person_id::text as "studentId", p.legal_name as name,
          sum(i.total_paise - i.paid_paise) filter (where i.state <> 'written_off')::int as "balancePaise",
          min(i.due_on) filter (where i.paid_paise < i.total_paise)::text as "nextDue"
        from fee_invoice i join person p on p.org_id = i.org_id and p.id = i.student_person_id
        where i.org_id = app_current_org() and i.institution_id = ${input.institutionId} and (p.legal_name ilike ${q} or i.student_person_id = any(${`{${byNumber.join(',')}}`}::uuid[]))
        group by i.student_person_id, p.legal_name order by p.legal_name limit 20`);
    const lookup = { personIds: rows.map((r) => r.studentId), onDate: await today(tx) };
    const found = await Promise.all(
      (deps.placements ?? []).map((p) => p.getPlacements(tx, lookup)),
    );
    return rows.map((r) => {
      const p = found.map((m) => m.get(r.studentId)).find((x) => x !== undefined);
      return { ...r, placement: p?.displayLabel ?? null, reference: p?.reference ?? null };
    });
  });
}

export type DayCloseView = {
  onDate: string;
  closed: {
    countedCashPaise: number;
    differencePaise: number;
    depositRef: string | null;
    closedAt: string;
  } | null;
  cash: { count: number; paise: number };
  cheques: { count: number; paise: number };
  digital: { count: number; paise: number };
  reversedPaise: number;
};

async function cashierTotals(deps: FinanceDeps, actor: Actor, onDate: string) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [t] = await tx.execute<{
      cashN: number;
      cashP: number;
      chqN: number;
      chqP: number;
      digN: number;
      digP: number;
      rev: number;
    }>(sql`
      select
        count(*) filter (where method = 'cash' and state <> 'reversed')::int as "cashN",
        coalesce(sum(amount_paise) filter (where method = 'cash' and state <> 'reversed'), 0)::int as "cashP",
        count(*) filter (where method = 'cheque' and state <> 'reversed')::int as "chqN",
        coalesce(sum(amount_paise) filter (where method = 'cheque' and state <> 'reversed'), 0)::int as "chqP",
        count(*) filter (where method in ('upi', 'card') and state <> 'reversed')::int as "digN",
        coalesce(sum(amount_paise) filter (where method in ('upi', 'card') and state <> 'reversed'), 0)::int as "digP",
        coalesce(sum(amount_paise) filter (where state = 'reversed'), 0)::int as rev
      from fee_payment
      where org_id = app_current_org() and collected_by_person_id = ${actor.personId} and collected_on = ${onDate}::date
        and state in ('succeeded', 'reversed', 'refunded')`);
    const [closed] = await tx.execute<DayCloseView['closed'] & object>(sql`
      select counted_cash_paise::int as "countedCashPaise", (counted_cash_paise - expected_cash_paise)::int as "differencePaise",
        deposit_ref as "depositRef", closed_at::text as "closedAt"
      from fee_day_close where org_id = app_current_org() and cashier_person_id = ${actor.personId} and on_date = ${onDate}::date`);
    return {
      onDate,
      closed: closed ?? null,
      cash: { count: t?.cashN ?? 0, paise: t?.cashP ?? 0 },
      cheques: { count: t?.chqN ?? 0, paise: t?.chqP ?? 0 },
      digital: { count: t?.digN ?? 0, paise: t?.digP ?? 0 },
      reversedPaise: t?.rev ?? 0,
    } satisfies DayCloseView;
  });
}

/** The cashier's day: what the system says was collected, by method. */
export async function dayCloseView(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<DayCloseView> {
  const d = await withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.day.close', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    return today(tx);
  });
  return cashierTotals(deps, actor, d);
}

/**
 * Closes the cashier's day: counted cash against expected, cheques and the deposit reference. A
 * difference needs a note. After closing, that cashier can't collect again the same day.
 */
export async function closeDay(
  deps: FinanceDeps,
  actor: Actor,
  input: {
    institutionId: string;
    countedCashPaise: number;
    depositRef?: string | null | undefined;
    note?: string | null | undefined;
  },
): Promise<DayCloseView> {
  if (!Number.isSafeInteger(input.countedCashPaise) || input.countedCashPaise < 0)
    throw new FinanceError('bad_amount');
  const view = await dayCloseView(deps, actor, input.institutionId);
  if (view.closed) throw new FinanceError('day_closed');
  if (input.countedCashPaise !== view.cash.paise && (input.note ?? '').trim().length < 3) {
    throw new FinanceError('difference_needs_note', { expectedPaise: view.cash.paise });
  }
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, input.institutionId)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.day.close', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      await tx.execute(sql`
        insert into fee_day_close (org_id, institution_id, cashier_person_id, on_date, expected_cash_paise, counted_cash_paise,
          cheques, cheque_paise, deposit_ref, note)
        values (app_current_org(), ${input.institutionId}, ${actor.personId}, ${view.onDate}::date, ${view.cash.paise},
          ${input.countedCashPaise}, ${view.cheques.count}, ${view.cheques.paise}, ${input.depositRef?.trim() || null},
          ${input.note?.trim() || null})`);
      return {
        result: undefined,
        audit: {
          action: 'finance.day.close',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'operational',
          ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
          detail: {
            onDate: view.onDate,
            expectedPaise: view.cash.paise,
            countedPaise: input.countedCashPaise,
          },
        },
      };
    },
  );
  return cashierTotals(deps, actor, view.onDate);
}

export type Dues = {
  onDate: string;
  buckets: Record<AgeBucket, { students: number; paise: number }>;
  defaulters: {
    studentId: string;
    name: string;
    /** Past due only; instalments not yet due are not counted. */
    overduePaise: number;
    oldestDue: string;
    daysOverdue: number;
    bucket: AgeBucket;
    placement: string | null;
    /** Admission number in schools. */
    reference: string | null;
  }[];
};

/** Outstanding money by age, and who owes what. Read-only: dues never cut off app access or safety notices. */
export async function dues(deps: FinanceDeps, actor: Actor, institutionId: string): Promise<Dues> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.invoice.read', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    const d = await today(tx);
    const rows = await tx.execute<{
      studentId: string;
      name: string;
      due: number;
      overdue: number;
      oldest: string;
      days: number;
    }>(sql`
      select i.student_person_id::text as "studentId", p.legal_name as name, sum(i.total_paise - i.paid_paise)::int as due,
        coalesce(sum(i.total_paise - i.paid_paise) filter (where i.due_on < ${d}::date), 0)::int as overdue,
        min(i.due_on)::text as oldest, (${d}::date - min(i.due_on))::int as days
      from fee_invoice i join person p on p.org_id = i.org_id and p.id = i.student_person_id
      where i.org_id = app_current_org() and i.institution_id = ${institutionId} and i.paid_paise < i.total_paise
        and i.state <> 'written_off'
      group by i.student_person_id, p.legal_name
      order by days desc, due desc`);
    const buckets = Object.fromEntries(
      (['current', '1_30', '31_60', '61_90', '90_plus'] as const).map((b) => [
        b,
        { students: 0, paise: 0 },
      ]),
    ) as Dues['buckets'];
    for (const r of rows) {
      const b = buckets[ageBucket(r.days)];
      b.students += 1;
      b.paise += r.due;
    }
    const late = rows.filter((r) => r.days > 0);
    const lookup = { personIds: late.map((r) => r.studentId), onDate: d };
    const found = await Promise.all(
      (deps.placements ?? []).map((p) => p.getPlacements(tx, lookup)),
    );
    return {
      onDate: d,
      buckets,
      defaulters: late.map((r) => {
        const p = found.map((m) => m.get(r.studentId)).find((x) => x !== undefined);
        return {
          studentId: r.studentId,
          name: r.name,
          overduePaise: r.overdue,
          oldestDue: r.oldest,
          daysOverdue: r.days,
          bucket: ageBucket(r.days),
          placement: p?.displayLabel ?? null,
          reference: p?.reference ?? null,
        };
      }),
    };
  });
}

export type ReminderPreview = { students: number; overduePaise: number; minDaysOverdue: number };

async function overdueStudents(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
  minDays: number,
) {
  return (await dues(deps, actor, institutionId)).defaulters.filter(
    (d) => d.daysOverdue >= minDays,
  );
}

export async function previewReminders(
  deps: FinanceDeps,
  actor: Actor,
  input: { institutionId: string; minDaysOverdue: number },
): Promise<ReminderPreview> {
  const list = await overdueStudents(deps, actor, input.institutionId, input.minDaysOverdue);
  return {
    students: list.length,
    overduePaise: list.reduce((a, d) => a + d.overduePaise, 0),
    minDaysOverdue: input.minDaysOverdue,
  };
}

/**
 * Sends a fee reminder to the fee-paying guardians of each student overdue by at least so many
 * days, once per student per day, and records the overdue event.
 */
export async function sendReminders(
  deps: FinanceDeps,
  actor: Actor,
  input: { institutionId: string; minDaysOverdue: number },
): Promise<{ students: number; messages: number }> {
  const list = await overdueStudents(deps, actor, input.institutionId, input.minDaysOverdue);
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(await institution(tx, input.institutionId)),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'finance.invoice.issue', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const d = await today(tx);
      let messages = 0;
      for (const s of list) {
        const ids = await notifyGuardians(tx, {
          studentId: s.studentId,
          flag: 'fee_messages',
          kind: 'fee_reminder',
          language: 'en',
          title: 'Fee reminder',
          body: `${s.name.split(' ')[0]}'s fees of ${rupees(s.overduePaise)} were due on ${s.oldestDue}. You can pay in the app or at the school office.`,
          dedupeKey: `fee-reminder:${s.studentId}:${d}`,
        });
        messages += ids.length;
        await emit(tx, {
          type: INVOICE_OVERDUE,
          payload: {
            studentId: s.studentId,
            overduePaise: s.overduePaise,
            daysOverdue: s.daysOverdue,
          },
        });
      }
      return {
        result: { students: list.length, messages },
        audit: {
          action: 'finance.invoice.issue',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'personal',
          detail: { reminders: list.length, messages, minDaysOverdue: input.minDaysOverdue },
        },
      };
    },
  );
}

export type ReconItem = {
  paymentId: string;
  student: string;
  amountPaise: number;
  state: 'pending' | 'unmatched';
  gatewayRef: string | null;
  createdAt: string;
};

/** Online payments still pending after 15 minutes, and paid amounts that didn't match. */
export async function reconciliation(
  deps: FinanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<ReconItem[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'finance.payment.reconcile', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, institutionId)),
    });
    return [
      ...(await tx.execute<ReconItem>(sql`
        select p.id::text as "paymentId", s.legal_name as student, p.amount_paise::int as "amountPaise", p.state,
          p.gateway_ref as "gatewayRef", p.created_at::text as "createdAt"
        from fee_payment p join person s on s.org_id = p.org_id and s.id = p.student_person_id
        where p.org_id = app_current_org() and p.institution_id = ${institutionId}
          and (p.state = 'unmatched' or (p.state = 'pending' and p.created_at < now() - interval '15 minutes'))
        order by p.created_at`)),
    ];
  });
}

/** Reconciliation's "check now": asks the gateway about one pending payment, as the office. */
export async function recheckPayment(deps: FinanceDeps, actor: Actor, paymentId: string) {
  const gateway = deps.gateway;
  if (!gateway) throw new FinanceError('online_payments_off');
  await withTenant(deps.db, actor.orgId, async (tx) => {
    const [p] = await tx.execute<{ institutionId: string }>(sql`
      select institution_id::text as "institutionId" from fee_payment where org_id = app_current_org() and id = ${paymentId}`);
    if (!p) throw new FinanceError('payment_not_found');
    await deps.permissions.assertCan(tx, actor, 'finance.payment.reconcile', {
      orgId: actor.orgId,
      place: placeOf(await institution(tx, p.institutionId)),
    });
  });
  return checkOnlinePayment(deps.db, gateway, actor.orgId, paymentId, deps.placements);
}
