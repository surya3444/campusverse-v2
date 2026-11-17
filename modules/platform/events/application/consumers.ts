import { withTenant, type Db, type Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import type { OutboxEvent } from './outbox.js';

export const QUEUES = [
  'notifications',
  'documents',
  'imports',
  'payments',
  'rollups',
  'compliance',
] as const;
export type QueueName = (typeof QUEUES)[number];

/**
 * A subscriber to events. `handle` runs at most once per event, inside the event's tenant
 * transaction, together with the processed-event marker. `afterCommit` does external work
 * (send, scan) and runs on every delivery of the event, so it must decide from database state
 * and be safe to repeat: a retry after a crash finishes the job instead of skipping it.
 */
export type Consumer = {
  name: string;
  queue: QueueName;
  events: string[];
  handle?: (tx: Tx, event: OutboxEvent) => Promise<void>;
  afterCommit?: (db: Db, event: OutboxEvent) => Promise<void>;
};

export async function runConsumer(
  db: Db,
  consumer: Consumer,
  event: OutboxEvent,
): Promise<'processed' | 'duplicate'> {
  const outcome = await withTenant(db, event.orgId, async (tx) => {
    const [fresh] = await tx.execute(sql`
      insert into ops.processed_event (consumer, event_id, org_id)
      values (${consumer.name}, ${event.id}, ${event.orgId})
      on conflict do nothing
      returning 1`);
    if (!fresh) return 'duplicate' as const;
    await consumer.handle?.(tx, event);
    return 'processed' as const;
  });
  await consumer.afterCommit?.(db, event);
  return outcome;
}
