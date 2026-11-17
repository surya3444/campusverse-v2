// Delivery engine on real Postgres with fake providers: states, fallback, webhooks, allowlist.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedTenant, syntheticPhone, type SeededTenant } from '@campusverse/db/seed';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dispatch,
  fallback,
  recordDeliveryStatus,
  Unreachable,
  type CommsDeps,
  type OutgoingMessage,
} from '../application/delivery.js';
import { notifyGuardians, requestMessage } from '../application/messages.js';
import type { Channel, Kind } from '../domain/plan.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
let t: SeededTenant;

beforeAll(async () => {
  t = await seedTenant(db, 'Delivery');
});
afterAll(() => close());

type Behaviour = 'ok' | 'fail' | 'unreachable';

function provider(name: string, behaviour: Behaviour = 'ok') {
  const sent: OutgoingMessage[] = [];
  return {
    sent,
    name,
    send: async (m: OutgoingMessage) => {
      if (behaviour === 'fail') throw new Error('provider down');
      if (behaviour === 'unreachable') throw new Unreachable();
      sent.push(m);
      return { providerRef: `${name}-${randomUUID()}` };
    },
  };
}

function deps(b: Partial<Record<Channel, Behaviour>> = {}, allowlist: string[] | null = null) {
  const providers = {
    push: provider('fcm', b.push),
    whatsapp: provider('msg91-wa', b.whatsapp),
    sms: provider('msg91-sms', b.sms),
  };
  const scheduled: { task: string; data: unknown; delayMs: number }[] = [];
  const d: CommsDeps = {
    providers,
    allowlist: allowlist && new Set(allowlist),
    schedule: async (task, data, delayMs) => void scheduled.push({ task, data, delayMs }),
  };
  return { d, providers, scheduled };
}

/** A synthetic recipient with contacts on the given channels. */
async function recipient(channels: Channel[]) {
  const phone = syntheticPhone();
  const personId = await withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Parent')
      returning id::text`);
    for (const c of channels) {
      await tx.execute(sql`
        insert into person_contact (org_id, person_id, channel, address)
        values (app_current_org(), ${p!.id}, ${c}, ${c === 'push' ? `fcm-token-${randomUUID()}` : phone})`);
    }
    return p!.id;
  });
  return { personId, phone };
}

const queue = (personId: string, kind: Kind) =>
  withTenant(db, t.orgId, (tx) =>
    requestMessage(tx, {
      recipientPersonId: personId,
      kind,
      language: 'en',
      title: 'Synthetic',
      body: 'Synthetic message body',
      dedupeKey: randomUUID(),
    }),
  ) as Promise<string>;

const state = (messageId: string) =>
  withTenant(db, t.orgId, async (tx) => {
    const [m] = await tx.execute<{ state: string }>(sql`
      select state from notification_message where id = ${messageId}`);
    const ds = await tx.execute<{
      channel: Channel;
      state: string;
      error: string | null;
      ref: string | null;
    }>(sql`
      select channel, state, error, provider_ref as ref from notification_delivery
      where message_id = ${messageId} order by attempt_order, channel`);
    return {
      message: m?.state,
      deliveries: ds.map((d) => `${d.channel}:${d.state}${d.error ? `(${d.error})` : ''}`),
      refs: ds,
    };
  });

describe('sending and fallback', () => {
  it('absence goes by push first and schedules a fallback check', async () => {
    const r = await recipient(['push', 'whatsapp', 'sms']);
    const { d, providers, scheduled } = deps();
    const id = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, id);
    expect(await state(id)).toMatchObject({ message: 'sent', deliveries: ['push:sent'] });
    expect(providers.push.sent).toHaveLength(1);
    expect(scheduled).toEqual([
      {
        task: 'communications.check-delivery',
        data: { orgId: t.orgId, messageId: id },
        delayMs: 15 * 60_000,
      },
    ]);
  });

  it('dispatching again sends nothing new', async () => {
    const r = await recipient(['push']);
    const { d, providers } = deps();
    const id = await queue(r.personId, 'absence');
    await Promise.all([
      dispatch(db, d, t.orgId, id),
      dispatch(db, d, t.orgId, id),
      dispatch(db, d, t.orgId, id),
    ]);
    expect(providers.push.sent).toHaveLength(1);
  });

  it('falls back to WhatsApp when push fails', async () => {
    const r = await recipient(['push', 'whatsapp']);
    const { d, providers } = deps({ push: 'fail' });
    const id = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, id);
    expect(await state(id)).toMatchObject({
      message: 'fallback_sent',
      deliveries: ['push:failed(provider_error)', 'whatsapp:sent'],
    });
    expect(providers.whatsapp.sent).toHaveLength(1);
  });

  it('falls back when push is sent but not delivered in time, and not once it is', async () => {
    const r = await recipient(['push', 'whatsapp']);
    const { d, providers } = deps();
    const late = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, late);
    await fallback(db, d, t.orgId, late); // the timer fires
    expect((await state(late)).deliveries).toEqual(['push:sent', 'whatsapp:sent']);

    const onTime = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, onTime);
    const ref = (await state(onTime)).refs[0]!.ref!;
    await recordDeliveryStatus(db, d, { provider: 'fcm', providerRef: ref, status: 'delivered' });
    await fallback(db, d, t.orgId, onTime);
    expect(await state(onTime)).toMatchObject({
      message: 'delivered',
      deliveries: ['push:delivered'],
    });
    expect(providers.whatsapp.sent).toHaveLength(1); // only the late one
  });

  it('a circular falls back if delivered but unread', async () => {
    const r = await recipient(['push', 'whatsapp']);
    const { d } = deps();
    const id = await queue(r.personId, 'circular');
    await dispatch(db, d, t.orgId, id);
    const ref = (await state(id)).refs[0]!.ref!;
    await recordDeliveryStatus(db, d, { provider: 'fcm', providerRef: ref, status: 'delivered' });
    await fallback(db, d, t.orgId, id);
    expect((await state(id)).deliveries).toEqual(['push:delivered', 'whatsapp:sent']);
  });

  it('urgent goes out on every channel together', async () => {
    const r = await recipient(['push', 'whatsapp', 'sms']);
    const { d, scheduled } = deps();
    const id = await queue(r.personId, 'urgent');
    await dispatch(db, d, t.orgId, id);
    expect((await state(id)).deliveries).toEqual(['push:sent', 'sms:sent', 'whatsapp:sent']);
    expect(scheduled).toHaveLength(0);
  });

  it('a parent with only SMS still gets a notice', async () => {
    const r = await recipient(['sms']);
    const { d } = deps();
    const id = await queue(r.personId, 'notice');
    await dispatch(db, d, t.orgId, id);
    expect((await state(id)).deliveries).toEqual(['sms:sent']);
  });

  it('an uninstalled app disables the push contact and moves on', async () => {
    const r = await recipient(['push', 'whatsapp']);
    const { d } = deps({ push: 'unreachable' });
    const id = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, id);
    expect((await state(id)).deliveries).toEqual(['push:failed(unreachable)', 'whatsapp:sent']);
    const [c] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ reason: string }>(sql`
        select disabled_reason as reason from person_contact
        where person_id = ${r.personId} and channel = 'push'`),
    );
    expect(c?.reason).toBe('unreachable');
  });

  it('fails the message once every channel is exhausted', async () => {
    const r = await recipient(['push', 'whatsapp', 'sms']);
    const { d } = deps({ push: 'fail', whatsapp: 'fail', sms: 'fail' });
    const id = await queue(r.personId, 'absence');
    await dispatch(db, d, t.orgId, id);
    expect(await state(id)).toMatchObject({
      message: 'failed',
      deliveries: [
        'push:failed(provider_error)',
        'whatsapp:failed(provider_error)',
        'sms:failed(provider_error)',
      ],
    });
  });

  it('homework never leaves the app', async () => {
    const r = await recipient(['push', 'sms']);
    const { d, providers } = deps({ push: 'fail' });
    const id = await queue(r.personId, 'homework');
    await dispatch(db, d, t.orgId, id);
    expect(await state(id)).toMatchObject({
      message: 'failed',
      deliveries: ['push:failed(provider_error)'],
    });
    expect(providers.sms.sent).toHaveLength(0);
  });

  it('no contact at all fails the message', async () => {
    const r = await recipient([]);
    const { d } = deps();
    const id = await queue(r.personId, 'notice');
    await dispatch(db, d, t.orgId, id);
    expect(await state(id)).toEqual({ message: 'failed', deliveries: [], refs: [] });
  });
});

describe('non-production allowlist', () => {
  it('refuses numbers that are not allowlisted, and sends to those that are', async () => {
    const blocked = await recipient(['whatsapp', 'sms']);
    const allowed = await recipient(['whatsapp']);
    const { d, providers } = deps({}, [allowed.phone]);

    const b = await queue(blocked.personId, 'notice');
    await dispatch(db, d, t.orgId, b);
    expect(await state(b)).toMatchObject({
      message: 'failed',
      deliveries: ['whatsapp:failed(not_allowlisted)', 'sms:failed(not_allowlisted)'],
    });

    const a = await queue(allowed.personId, 'notice');
    await dispatch(db, d, t.orgId, a);
    expect((await state(a)).deliveries).toEqual(['whatsapp:sent']);
    expect(providers.whatsapp.sent.map((m) => m.to)).toEqual([allowed.phone]);
  });
});

describe('provider webhooks', () => {
  it('only move forward, and repeats are harmless', async () => {
    const r = await recipient(['push']);
    const { d } = deps();
    const id = await queue(r.personId, 'notice');
    await dispatch(db, d, t.orgId, id);
    const ref = (await state(id)).refs[0]!.ref!;
    const hook = (status: 'delivered' | 'read' | 'failed') =>
      recordDeliveryStatus(db, d, { provider: 'fcm', providerRef: ref, status });

    await hook('read');
    await hook('delivered'); // late, out of order
    await hook('read'); // repeat
    await hook('failed'); // after reading: ignored
    expect(await state(id)).toMatchObject({ message: 'read', deliveries: ['push:read'] });
  });

  it('ignores unknown references', async () => {
    const { d } = deps();
    expect(
      await recordDeliveryStatus(db, d, {
        provider: 'fcm',
        providerRef: 'nope',
        status: 'delivered',
      }),
    ).toBe(false);
  });
});

describe('requests', () => {
  it('the same dedupe key queues one message', async () => {
    const r = await recipient(['push']);
    const ids = await withTenant(db, t.orgId, async (tx) => {
      const input = {
        recipientPersonId: r.personId,
        kind: 'notice' as const,
        language: 'en',
        title: 'x',
        body: 'y',
        dedupeKey: 'same-cause',
      };
      return [await requestMessage(tx, input), await requestMessage(tx, input)];
    });
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeNull();
  });

  it('guardians are messaged by their flags, and a restricted guardian gets nothing', async () => {
    const restricted = await recipient(['push']);
    const noFees = await recipient(['push']);
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship,
          restricted_at, restriction_reason, fee_messages)
        values (app_current_org(), ${restricted.personId}, ${t.studentId}, 'father', now(), 'Court order', true),
               (app_current_org(), ${noFees.personId}, ${t.studentId}, 'guardian', null, null, false)`),
    );
    const notify = (flag: 'academic_messages' | 'fee_messages') =>
      withTenant(db, t.orgId, (tx) =>
        notifyGuardians(tx, {
          studentId: t.studentId,
          flag,
          kind: 'notice',
          language: 'en',
          title: 'x',
          body: 'y',
          dedupeKey: randomUUID(),
        }),
      );
    const recipients = async (ids: string[]) =>
      withTenant(db, t.orgId, async (tx) =>
        (
          await tx.execute<{ p: string }>(sql`
          select recipient_person_id::text as p from notification_message
          where id in (${sql.join(
            ids.map((i) => sql`${i}::uuid`),
            sql`, `,
          )})`)
        )
          .map((r) => r.p)
          .sort(),
      );

    // The seeded mother has academic messages on (default) and fee messages off.
    expect(await recipients(await notify('academic_messages'))).toEqual(
      [t.guardianId, noFees.personId].sort(),
    );
    expect(await notify('fee_messages')).toEqual([]);
  });
});
