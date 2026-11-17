# platform/events

Durable work starts here: a write and its events commit together, then a worker relays them to BullMQ.

- `command(db, permissions, actor, check, work)`: tenant context, `assertCan`, the work, audit rows and outbox events in one transaction. If any step fails, nothing is written.
- `emit(tx, event)`: adds a row to `ops.outbox` for the current tenant only (RLS refuses others).
- `relayOutbox` / `createRuntime().relay()`: locks unpublished rows with SKIP LOCKED, queues one job per subscribed consumer (job id = consumer + event id), and marks the rows published.
- `runConsumer`: records `(consumer, event id)` in `ops.processed_event` in the same transaction as `handle`, so a repeated event changes nothing. `afterCommit` runs on every delivery and must be repeat-safe.
- Queues: `notifications`, `documents`, `imports`, `payments`, `rollups`, `compliance`. Jobs carry ids; handlers reload from Postgres.

**Owned tables:** `ops.outbox`, `ops.processed_event` (migration 0003).

**Tests:** `tests/events.db.test.ts`. The end-to-end duplicate-event check lives in `modules/shared/communications/tests`.
