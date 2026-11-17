import type { Db, Tx } from '@campusverse/db';
import { sql } from 'drizzle-orm';

export type EventInput = { type: string; payload: Record<string, unknown> };

export type OutboxEvent = {
  id: string;
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

const EVENT_TYPE = /^[a-z_]+\.[a-z_]+\.[a-z_]+\.v\d+$/;

/** Records an event in the caller's tenant transaction. It is relayed only if the transaction commits. */
export async function emit(tx: Tx, event: EventInput): Promise<string> {
  if (!EVENT_TYPE.test(event.type)) throw new Error(`emit: bad event type ${event.type}`);
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into ops.outbox (org_id, type, payload)
    values (app_current_org(), ${event.type}, ${JSON.stringify(event.payload)}::jsonb)
    returning id::text`);
  if (!row) throw new Error('emit: insert returned no row');
  return row.id;
}

/**
 * Hands up to `limit` unpublished events to `publish` and marks them published, all in one
 * transaction. Rows are locked with SKIP LOCKED, so several relays can run at once. If publish
 * succeeds but the commit fails, events are published again; consumers dedupe by event id.
 */
export async function relayOutbox(
  db: Db,
  publish: (events: OutboxEvent[]) => Promise<void>,
  limit = 100,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<OutboxEvent>(sql`
      select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
      from ops.outbox where published_at is null
      order by id limit ${limit}
      for update skip locked`);
    if (rows.length === 0) return 0;
    const events = [...rows];
    await publish(events);
    await tx.execute(sql`
      update ops.outbox set published_at = now()
      where id in (${sql.join(
        events.map((e) => sql`${e.id}::uuid`),
        sql`, `,
      )})`);
    return events.length;
  });
}
