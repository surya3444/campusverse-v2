import type { Consumer, Schedule, Task } from '@campusverse/platform-events';
import { notifyGuardians } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import {
  ONLINE_PAYMENT_STARTED,
  PAYMENT_REVERSED,
  PAYMENT_SUCCEEDED,
} from '../application/common.js';
import type { PlacementLookup } from '../application/common.js';
import type { Gateway } from '../application/gateway.js';
import { checkOnlinePayment } from '../application/payments.js';
import { rupees } from '../domain/money.js';

export const CHECK_PAYMENT = 'finance.check-payment';
/** When to ask the gateway again if no webhook has come: 15 minutes, 1 hour, 6 hours. */
const CHECKS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export function financeJobs(deps: {
  gateway: Gateway | null;
  schedule: Schedule;
  placements?: PlacementLookup[];
}): {
  consumers: Consumer[];
  tasks: Task[];
} {
  return {
    consumers: [
      {
        // Every parent who pays gets a complete receipt, on the fee channels.
        name: 'finance.receipt-message',
        queue: 'notifications',
        events: [PAYMENT_SUCCEEDED],
        handle: async (tx, e) => {
          const p = e.payload as { studentId: string; receiptId: string; amountPaise: number };
          const [r] = await tx.execute<{ number: string; student: string }>(sql`
            select snapshot ->> 'number' as number, snapshot ->> 'student' as student from fee_receipt
            where org_id = app_current_org() and id = ${p.receiptId}`);
          await notifyGuardians(tx, {
            studentId: p.studentId,
            flag: 'fee_messages',
            kind: 'fee_receipt',
            language: 'en',
            title: 'Fee received',
            body: `Received ${rupees(p.amountPaise)} for ${r?.student ?? 'your child'}. Receipt ${r?.number ?? ''}. The full receipt is in the app.`,
            dedupeKey: `receipt:${p.receiptId}`,
          });
        },
      },
      {
        name: 'finance.reversal-message',
        queue: 'notifications',
        events: [PAYMENT_REVERSED],
        handle: async (tx, e) => {
          const p = e.payload as {
            studentId: string;
            creditNoteId: string;
            amountPaise: number;
            chargePaise: number;
          };
          await notifyGuardians(tx, {
            studentId: p.studentId,
            flag: 'fee_messages',
            kind: 'fee_receipt',
            language: 'en',
            title: 'Payment reversed',
            body: `A payment of ${rupees(p.amountPaise)} was reversed${p.chargePaise ? `, and a charge of ${rupees(p.chargePaise)} added` : ''}. Please contact the school office.`,
            dedupeKey: `reversal:${p.creditNoteId}`,
          });
        },
      },
      {
        name: 'finance.schedule-check',
        queue: 'payments',
        events: [ONLINE_PAYMENT_STARTED],
        afterCommit: async (_db, e) => {
          await deps.schedule(
            CHECK_PAYMENT,
            {
              orgId: e.orgId,
              paymentId: (e.payload as { paymentId: string }).paymentId,
              attempt: 0,
            },
            CHECKS_MS[0] ?? 0,
          );
        },
      },
    ],
    tasks: [
      {
        name: CHECK_PAYMENT,
        queue: 'payments',
        run: async (db, data) => {
          const d = data as { orgId: string; paymentId: string; attempt: number };
          if (!deps.gateway) return;
          const outcome = await checkOnlinePayment(
            db,
            deps.gateway,
            d.orgId,
            d.paymentId,
            deps.placements,
          );
          const next = CHECKS_MS[d.attempt + 1];
          if (outcome === 'pending' && next !== undefined) {
            await deps.schedule(CHECK_PAYMENT, { ...d, attempt: d.attempt + 1 }, next);
          }
        },
      },
    ],
  };
}
