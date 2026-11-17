import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { command, relayOutbox, runConsumer, type Consumer, type OutboxEvent } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let principal: Actor;
let student: Actor;

beforeAll(async () => {
  t = await seedTenant(db, 'Events');
  await grantPermission(db, t.orgId, 'principal', 'platform.organisation.rename');
  principal = { accountId: randomUUID(), orgId: t.orgId, personId: t.principalId };
  student = { accountId: randomUUID(), orgId: t.orgId, personId: t.studentId };
});

afterAll(() => close());

const rename = (actor: Actor, name: string, fail = false) =>
  command(
    db,
    permissions,
    actor,
    {
      permission: 'platform.organisation.rename',
      // The principal's role is scoped to their school, so the check is made there.
      resource: { orgId: t.orgId, place: { campusId: t.campusId, institutionId: t.institutionId } },
    },
    async (tx) => {
      await tx.execute(sql`update organisation set name = ${name} where id = ${t.orgId}`);
      if (fail) throw new Error('validation failed after the write');
      return {
        result: name,
        audit: {
          action: 'platform.organisation.rename',
          entityType: 'organisation',
          entityId: t.orgId,
          dataClass: 'operational',
        },
        events: [{ type: 'platform.organisation.renamed.v1', payload: { orgId: t.orgId } }],
      };
    },
  );

const counts = () =>
  withTenant(db, t.orgId, async (tx) => {
    const [row] = await tx.execute<{ name: string; audits: number; events: number }>(sql`
      select (select name from organisation where id = ${t.orgId}) as name,
        (select count(*)::int from audit_event where action = 'platform.organisation.rename') as audits,
        (select count(*)::int from ops.outbox
          where org_id = ${t.orgId} and type = 'platform.organisation.renamed.v1') as events`);
    return row!;
  });

describe('command', () => {
  it('writes the change, the audit row and the outbox event together', async () => {
    const before = await counts();
    await rename(principal, 'Events Renamed');
    expect(await counts()).toEqual({
      name: 'Events Renamed',
      audits: before.audits + 1,
      events: before.events + 1,
    });
  });

  it('writes nothing when permission is denied', async () => {
    const before = await counts();
    await expect(rename(student, 'Hijacked')).rejects.toMatchObject({ name: 'PermissionDenied' });
    expect(await counts()).toEqual(before);
  });

  it('writes nothing when the work fails after a write', async () => {
    const before = await counts();
    await expect(rename(principal, 'Half Done', true)).rejects.toThrow(/validation/);
    expect(await counts()).toEqual(before);
  });
});

describe('consumers', () => {
  it('handle runs once per event however often it is delivered; afterCommit runs every time', async () => {
    let handled = 0;
    let after = 0;
    const consumer: Consumer = {
      name: `test.counter.${randomUUID().slice(0, 8)}`,
      queue: 'rollups',
      events: ['platform.organisation.renamed.v1'],
      handle: async () => void handled++,
      afterCommit: async () => void after++,
    };
    const event: OutboxEvent = {
      id: randomUUID(),
      orgId: t.orgId,
      type: 'platform.organisation.renamed.v1',
      payload: {},
      occurredAt: new Date().toISOString(),
    };
    const outcomes = await Promise.all([1, 2, 3, 4, 5].map(() => runConsumer(db, consumer, event)));
    expect(outcomes.filter((o) => o === 'processed')).toHaveLength(1);
    expect(handled).toBe(1);
    expect(after).toBe(5);
  });

  it('a failing handler leaves no processed marker, so the retry runs it', async () => {
    let attempts = 0;
    const consumer: Consumer = {
      name: `test.flaky.${randomUUID().slice(0, 8)}`,
      queue: 'rollups',
      events: [],
      handle: async () => {
        attempts++;
        if (attempts === 1) throw new Error('transient');
      },
    };
    const event: OutboxEvent = {
      id: randomUUID(),
      orgId: t.orgId,
      type: 'x.y.z.v1',
      payload: {},
      occurredAt: '',
    };
    await expect(runConsumer(db, consumer, event)).rejects.toThrow('transient');
    expect(await runConsumer(db, consumer, event)).toBe('processed');
    expect(await runConsumer(db, consumer, event)).toBe('duplicate');
  });
});

describe('outbox relay', () => {
  it('concurrent relays publish each event exactly once', async () => {
    const emitted = new Set<string>();
    await withTenant(db, t.orgId, async (tx) => {
      for (let i = 0; i < 30; i++) {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into ops.outbox (org_id, type, payload)
          values (app_current_org(), 'test.relay.checked.v1', '{}') returning id::text`);
        emitted.add(row!.id);
      }
    });

    const published: string[] = [];
    const publish = async (events: OutboxEvent[]) => {
      await new Promise((r) => setTimeout(r, 20));
      published.push(...events.map((e) => e.id));
    };
    // Drain with three relays at once; earlier tests' events may be in the queue too.
    for (let round = 0; round < 20; round++) {
      const n = await Promise.all([1, 2, 3].map(() => relayOutbox(db, publish, 10)));
      if (n.every((x) => x === 0)) break;
    }
    const mine = published.filter((id) => emitted.has(id));
    expect(mine).toHaveLength(30);
    expect(new Set(mine).size).toBe(30);
  });

  it('if publishing fails, the events stay unpublished for the next pass', async () => {
    const id = await withTenant(db, t.orgId, async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into ops.outbox (org_id, type, payload)
        values (app_current_org(), 'test.relay.failed.v1', '{}') returning id::text`);
      return row!.id;
    });
    await expect(
      relayOutbox(db, async () => {
        throw new Error('redis down');
      }),
    ).rejects.toThrow('redis down');
    const [row] = await db.execute<{ published: boolean }>(
      sql`select published_at is not null as published from ops.outbox where id = ${id}`,
    );
    expect(row?.published).toBe(false);
    await relayOutbox(db, async () => {});
  });
});
