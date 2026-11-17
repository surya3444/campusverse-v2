import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activityLog, sealAuditLog, verifyAuditLog, writeAudit } from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
let t: SeededTenant;

beforeAll(async () => {
  t = await seedTenant(db, 'Seal');
});
afterAll(() => close());

const inTenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, t.orgId, fn);

/** Writes events dated two minutes ago, so the next seal takes them. */
async function oldEvents(n: number, dataClass: 'operational' | 'personal' = 'operational') {
  await inTenant(async (tx) => {
    for (let i = 0; i < n; i++)
      await tx.execute(sql`
        insert into audit_event (org_id, occurred_at, actor_person_id, action, entity_type, entity_id, data_class)
        values (app_current_org(), now() - interval '2 minutes', ${t.principalId},
          'school.setup.manage', 'section', ${randomUUID()}, ${dataClass})`);
  });
}

describe('activity log', () => {
  it('lists the organisation’s events newest first, filtered and paged', async () => {
    await oldEvents(3);
    await oldEvents(1, 'personal');
    const all = await inTenant((tx) =>
      activityLog(tx, { before: null, dataClass: null, actorPersonId: null, onOrBefore: null }),
    );
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort().reverse());
    const personal = await inTenant((tx) =>
      activityLog(tx, {
        before: null,
        dataClass: 'personal',
        actorPersonId: null,
        onOrBefore: null,
      }),
    );
    expect(personal.every((e) => e.dataClass === 'personal')).toBe(true);
    const page2 = await inTenant((tx) =>
      activityLog(tx, {
        before: all[1]!.id,
        dataClass: null,
        actorPersonId: null,
        onOrBefore: null,
      }),
    );
    expect(page2[0]!.id).toBe(all[2]!.id);
    const byPrincipal = await inTenant((tx) =>
      activityLog(tx, {
        before: null,
        dataClass: null,
        actorPersonId: t.principalId,
        onOrBefore: null,
      }),
    );
    expect(byPrincipal).toHaveLength(4);
  });
});

describe('seals', () => {
  it('seals new events, verifies the chain, and writes nothing when nothing is new', async () => {
    const first = await inTenant((tx) => sealAuditLog(tx));
    expect(first.sealed).toBeGreaterThanOrEqual(4);
    expect((await inTenant((tx) => sealAuditLog(tx))).sealed).toBe(0);
    // A fresh event waits a minute before it is sealed.
    await inTenant((tx) =>
      writeAudit(tx, null, {
        action: 'school.setup.manage',
        entityType: 'section',
        dataClass: 'operational',
      }),
    );
    expect((await inTenant((tx) => sealAuditLog(tx))).sealed).toBe(0);
    // Later events wait behind it: a seal only covers an unbroken run of the log.
    await oldEvents(2);
    expect((await inTenant((tx) => sealAuditLog(tx))).sealed).toBe(0);
    expect(await inTenant((tx) => verifyAuditLog(tx))).toMatchObject({ ok: true, brokenAt: null });
  });

  it('the app cannot change events or seals', async () => {
    for (const table of ['audit_event', 'audit_seal']) {
      const code = await inTenant((tx) =>
        tx.execute(sql`delete from ${sql.raw(table)} where org_id = app_current_org()`),
      ).then(
        () => 'deleted',
        (e: { cause?: { code?: string } }) => e.cause?.code,
      );
      expect(code).not.toBe('deleted');
    }
  });

  it('an event slipped in behind a seal breaks verification', async () => {
    // An id older than every seal, as a back-dated insert would carry.
    const oldId = '00000000-0000-7000-8000-000000000001';
    await inTenant((tx) =>
      tx.execute(sql`
        insert into audit_event (org_id, id, action, entity_type, data_class)
        values (app_current_org(), ${oldId}, 'school.setup.manage', 'section', 'operational')`),
    );
    const check = await inTenant((tx) => verifyAuditLog(tx));
    expect(check.ok).toBe(false);
    expect(check.brokenAt).not.toBeNull();
  });
});
