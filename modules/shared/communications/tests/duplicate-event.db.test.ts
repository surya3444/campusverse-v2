// Milestone 5 exit check: a duplicate event produces one outcome. Runs the real pipeline:
// consent recorded → outbox → relay → BullMQ → consent-receipt consumer → message → dispatch.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { CONSENT_CHANGED, recordConsent } from '@campusverse/platform-consent';
import {
  createRuntime,
  redisConnection,
  runConsumer,
  type OutboxEvent,
  type Runtime,
} from '@campusverse/platform-events';
import { createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { OutgoingMessage } from '../application/delivery.js';
import { communicationsJobs, type CommsDeps } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);

const sent: OutgoingMessage[] = [];
let runtime: Runtime;
let workers: ReturnType<Runtime['startWorkers']>;
let relaying: NodeJS.Timeout;
let t: SeededTenant;
const token = `fcm-token-${randomUUID()}`;
// The relay is global, so other tenants' messages may pass through; count only ours.
const ours = () => sent.filter((m) => m.to === token);

const deps: CommsDeps = {
  providers: {
    push: {
      name: 'fake-fcm',
      send: async (m) => {
        sent.push(m);
        return { providerRef: randomUUID() };
      },
    },
  },
  allowlist: null,
  schedule: (...args) => runtime.schedule(...args),
};
// No notices here: an audience with nobody in it.
const jobs = communicationsJobs({
  ...deps,
  audience: { groups: async () => [], students: async () => [] },
});

beforeAll(async () => {
  t = await seedTenant(db, 'Duplicate Event');
  await grantPermission(db, t.orgId, 'parent', 'platform.consent.record', 'guardian');
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address)
      values (app_current_org(), ${t.guardianId}, 'push', ${token})`),
  );
  runtime = createRuntime({
    db,
    connection: redisConnection(env.REDIS_URL),
    consumers: jobs.consumers,
    tasks: jobs.tasks,
    prefix: `cv-test-${randomUUID().slice(0, 8)}`, // isolated from a running dev worker
  });
  workers = runtime.startWorkers();
  relaying = setInterval(() => void runtime.relay().catch(() => {}), 50);
});

afterAll(async () => {
  clearInterval(relaying);
  await Promise.all(workers.map((w) => w.close()));
  await runtime.close();
  await close();
});

async function until(check: () => Promise<boolean>, ms = 10_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const settled = async () => {
  const counts = await runtime
    .queue('notifications')
    .getJobCounts('waiting', 'active', 'prioritized');
  return Object.values(counts).every((n) => n === 0);
};

const outcome = () =>
  withTenant(db, t.orgId, async (tx) => {
    const [row] = await tx.execute<{ messages: number; deliveries: number }>(sql`
      select
        (select count(*)::int from notification_message
          where recipient_person_id = ${t.guardianId} and dedupe_key like 'consent-receipt:%') as messages,
        (select count(*)::int from notification_delivery d join notification_message m
          on m.org_id = d.org_id and m.id = d.message_id
          where m.recipient_person_id = ${t.guardianId} and m.dedupe_key like 'consent-receipt:%') as deliveries`);
    return row;
  });

it('one consent decision, delivered three extra times, sends one message', async () => {
  const [notice] = await withTenant(db, t.orgId, (tx) =>
    tx.execute<{ id: string }>(sql`select id::text from consent_notice where org_id = ${t.orgId}`),
  );
  const guardian = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  await recordConsent(db, permissions, guardian, {
    studentId: t.studentId,
    guardianId: t.guardianId,
    noticeId: notice!.id,
    decision: 'withdrawn',
    source: 'app',
  });

  await until(async () => ours().length >= 1);
  await until(settled);

  // The original event, as the relay saw it.
  const [row] = await db.execute<OutboxEvent>(sql`
    select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
    from ops.outbox where org_id = ${t.orgId} and type = ${CONSENT_CHANGED}`);
  const event = row!;

  // 1. The relay publishes it again (commit lost after publishing).
  await db.execute(sql`update ops.outbox set published_at = null where id = ${event.id}`);
  // 2. The same event is queued under a different job id (BullMQ's own dedupe bypassed).
  await runtime
    .queue('notifications')
    .add('communications.consent-receipt', event, { jobId: `dup-${randomUUID()}` });
  // 3. A worker runs it directly, as a retry after a crash would.
  const consumer = jobs.consumers.find((c) => c.name === 'communications.consent-receipt')!;
  expect(await runConsumer(db, consumer, event)).toBe('duplicate');

  await until(async () => {
    const [r] = await db.execute<{ published: boolean }>(
      sql`select published_at is not null as published from ops.outbox where id = ${event.id}`,
    );
    return r!.published;
  });
  await until(settled);
  await new Promise((r) => setTimeout(r, 300));

  expect(await outcome()).toEqual({ messages: 1, deliveries: 1 });
  expect(ours()).toHaveLength(1);
  expect(ours()[0]!.body).toContain('withdrawn');
});
