import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { Schedule } from '@campusverse/platform-events';
import { sql } from 'drizzle-orm';
import {
  firstWave,
  goalMet,
  messageState,
  nextChannel,
  PLANS,
  type Channel,
  type DeliveryState,
  type Kind,
} from '../domain/plan.js';

export type OutgoingMessage = {
  to: string;
  title: string;
  body: string;
  language: string;
  /** Our delivery id, for providers that echo a client reference. */
  reference: string;
};

/** One channel provider (FCM, MSG91 WhatsApp, MSG91 SMS). Adapters only; no provider logic here. */
export type Provider = {
  name: string;
  send(message: OutgoingMessage): Promise<{ providerRef: string }>;
};

/** Thrown by a provider when the address is dead (app uninstalled, number disconnected). */
export class Unreachable extends Error {
  constructor(message = 'unreachable') {
    super(message);
    this.name = 'Unreachable';
  }
}

export type CommsDeps = {
  providers: Partial<Record<Channel, Provider>>;
  /** Outside production, WhatsApp and SMS go only to these numbers. null means production. */
  allowlist: ReadonlySet<string> | null;
  schedule: Schedule;
  /** Emergency switch (super admin): while true, nothing is sent and dispatch tries again later. */
  paused?: ((orgId: string) => Promise<boolean>) | undefined;
};

export const CHECK_DELIVERY = 'communications.check-delivery';
export const DISPATCH_LATER = 'communications.dispatch-later';
const PAUSE_RETRY_MS = 60_000;

type Delivery = { id: string; channel: Channel; state: DeliveryState; attemptOrder: number };

async function deliveriesOf(tx: Tx, messageId: string): Promise<Delivery[]> {
  return [
    ...(await tx.execute<Delivery>(sql`
      select id::text, channel, state, attempt_order as "attemptOrder"
      from notification_delivery where org_id = app_current_org() and message_id = ${messageId}
      order by attempt_order`)),
  ];
}

/** Working contacts of the recipient, newest per channel. */
async function contactsOf(tx: Tx, personId: string) {
  const rows = await tx.execute<{ id: string; channel: Channel }>(sql`
    select distinct on (channel) id::text, channel from person_contact
    where org_id = app_current_org() and person_id = ${personId} and disabled_at is null
    order by channel, created_at desc`);
  return new Map(rows.map((r) => [r.channel, r.id]));
}

/** Locks the message row, so dispatch, fallback and webhooks for one message run one at a time. */
async function lockMessage(tx: Tx, messageId: string) {
  const [m] = await tx.execute<{ kind: Kind; state: string; recipient: string }>(sql`
    select kind, state, recipient_person_id::text as recipient from notification_message
    where org_id = app_current_org() and id = ${messageId} for update`);
  return m ?? null;
}

async function recompute(tx: Tx, messageId: string) {
  const next = messageState(await deliveriesOf(tx, messageId));
  if (next) {
    await tx.execute(sql`
      update notification_message set state = ${next}
      where org_id = app_current_org() and id = ${messageId}
        and state not in ('cancelled', 'acknowledged') and state <> ${next}`);
  }
}

async function insertDelivery(
  tx: Tx,
  messageId: string,
  channel: Channel,
  contactId: string,
  attemptOrder: number,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into notification_delivery (org_id, message_id, channel, contact_id, attempt_order)
    values (app_current_org(), ${messageId}, ${channel}, ${contactId}, ${attemptOrder})
    on conflict (org_id, message_id, channel) do nothing
    returning id::text`);
  return row?.id ?? null;
}

/**
 * Sends a queued message. Safe to repeat: the first wave is created once, and only deliveries
 * still 'queued' are sent, each claimed atomically so it is sent by one caller.
 */
export async function dispatch(db: Db, deps: CommsDeps, orgId: string, messageId: string) {
  if (await deps.paused?.(orgId)) {
    await deps.schedule(DISPATCH_LATER, { orgId, messageId }, PAUSE_RETRY_MS);
    return;
  }
  const { toSend, created, kind } = await withTenant(db, orgId, async (tx) => {
    const m = await lockMessage(tx, messageId);
    if (!m || m.state === 'cancelled') return { toSend: [], created: false, kind: null };
    let deliveries = await deliveriesOf(tx, messageId);
    let created = false;
    if (deliveries.length === 0) {
      const contacts = await contactsOf(tx, m.recipient);
      const wave = firstWave(PLANS[m.kind], [...contacts.keys()]);
      if (wave.length === 0) {
        await tx.execute(sql`
          update notification_message set state = 'failed'
          where org_id = app_current_org() and id = ${messageId}`);
        return { toSend: [], created: false, kind: m.kind };
      }
      for (const channel of wave) {
        const contactId = contacts.get(channel);
        if (contactId) await insertDelivery(tx, messageId, channel, contactId, 1);
      }
      deliveries = await deliveriesOf(tx, messageId);
      created = true;
    }
    return {
      toSend: deliveries.filter((d) => d.state === 'queued').map((d) => d.id),
      created,
      kind: m.kind,
    };
  });

  for (const id of toSend) await sendDelivery(db, deps, orgId, id);
  await scheduleCheck(deps, kind, created, orgId, messageId);
}

async function scheduleCheck(
  deps: CommsDeps,
  kind: Kind | null,
  due: boolean,
  orgId: string,
  messageId: string,
) {
  const plan = kind && PLANS[kind];
  if (due && plan?.mode === 'sequential' && plan.fallbackAfterMs) {
    await deps.schedule(CHECK_DELIVERY, { orgId, messageId }, plan.fallbackAfterMs);
  }
}

async function sendDelivery(db: Db, deps: CommsDeps, orgId: string, deliveryId: string) {
  const claimed = await withTenant(db, orgId, async (tx) => {
    const [row] = await tx.execute<{
      messageId: string;
      channel: Channel;
      address: string;
      contactId: string;
      title: string;
      body: string;
      language: string;
    }>(sql`
      update notification_delivery d set state = 'sending'
      from person_contact c, notification_message m
      where d.org_id = app_current_org() and d.id = ${deliveryId} and d.state = 'queued'
        and c.org_id = d.org_id and c.id = d.contact_id
        and m.org_id = d.org_id and m.id = d.message_id
      returning d.message_id::text as "messageId", d.channel, c.address,
        c.id::text as "contactId", m.title, m.body, m.language`);
    return row ?? null;
  });
  if (!claimed) return; // someone else has it, or it is already done

  const provider = deps.providers[claimed.channel];
  if (deps.allowlist && claimed.channel !== 'push' && !deps.allowlist.has(claimed.address)) {
    return fail(db, deps, orgId, deliveryId, 'not_allowlisted');
  }
  if (!provider) return fail(db, deps, orgId, deliveryId, 'no_provider');

  let providerRef: string;
  try {
    ({ providerRef } = await provider.send({
      to: claimed.address,
      title: claimed.title,
      body: claimed.body,
      language: claimed.language,
      reference: deliveryId,
    }));
  } catch (e) {
    const unreachable = e instanceof Unreachable;
    return fail(
      db,
      deps,
      orgId,
      deliveryId,
      unreachable ? 'unreachable' : 'provider_error',
      unreachable,
    );
  }

  await withTenant(db, orgId, async (tx) => {
    await tx.execute(sql`
      update notification_delivery set state = 'sent', sent_at = now(),
        provider = ${provider.name}, provider_ref = ${providerRef}
      where org_id = app_current_org() and id = ${deliveryId} and state = 'sending'`);
    await tx.execute(sql`
      insert into ops.delivery_ref (provider, provider_ref, org_id, delivery_id)
      values (${provider.name}, ${providerRef}, ${orgId}, ${deliveryId})
      on conflict do nothing`);
    await recompute(tx, claimed.messageId);
  });
}

async function fail(
  db: Db,
  deps: CommsDeps,
  orgId: string,
  deliveryId: string,
  error: string,
  unreachable = false,
) {
  const messageId = await withTenant(db, orgId, async (tx) => {
    const [row] = await tx.execute<{ messageId: string; contactId: string }>(sql`
      update notification_delivery set state = 'failed', failed_at = now(), error = ${error}
      where org_id = app_current_org() and id = ${deliveryId} and state in ('sending', 'sent')
      returning message_id::text as "messageId", contact_id::text as "contactId"`);
    if (!row) return null;
    if (unreachable) {
      await tx.execute(sql`
        update person_contact set disabled_at = now(), disabled_reason = 'unreachable'
        where org_id = app_current_org() and id = ${row.contactId} and disabled_at is null`);
    }
    return row.messageId;
  });
  if (messageId) await fallback(db, deps, orgId, messageId);
}

/**
 * Moves to the next channel if the plan's goal isn't met. Called when a delivery fails and
 * when the fallback timer fires. Marks the message failed once every channel is exhausted.
 */
export async function fallback(db: Db, deps: CommsDeps, orgId: string, messageId: string) {
  if (await deps.paused?.(orgId)) {
    await deps.schedule(CHECK_DELIVERY, { orgId, messageId }, PAUSE_RETRY_MS);
    return;
  }
  const next = await withTenant(db, orgId, async (tx) => {
    const m = await lockMessage(tx, messageId);
    if (!m || m.state === 'cancelled') return null;
    const plan = PLANS[m.kind];
    const deliveries = await deliveriesOf(tx, messageId);
    if (
      goalMet(
        plan,
        deliveries.map((d) => d.state),
      )
    )
      return null;
    // Parallel sends that are still in flight get their chance before any fallback.
    if (deliveries.some((d) => d.state === 'queued' || d.state === 'sending')) return null;

    const contacts = await contactsOf(tx, m.recipient);
    const channel = nextChannel(
      plan,
      [...contacts.keys()],
      deliveries.map((d) => d.channel),
    );
    const contactId = channel && contacts.get(channel);
    if (!channel || !contactId) {
      if (deliveries.every((d) => d.state === 'failed')) {
        await tx.execute(sql`
          update notification_message set state = 'failed'
          where org_id = app_current_org() and id = ${messageId}`);
      }
      return null;
    }
    const order = Math.max(0, ...deliveries.map((d) => d.attemptOrder)) + 1;
    const id = await insertDelivery(tx, messageId, channel, contactId, order);
    return id ? { id, kind: m.kind } : null;
  });
  if (!next) return;
  await sendDelivery(db, deps, orgId, next.id);
  await scheduleCheck(deps, next.kind, true, orgId, messageId);
}

const RANK: Record<'sent' | 'delivered' | 'read', number> = { sent: 2, delivered: 3, read: 4 };

/**
 * Applies a provider webhook. Repeats and out-of-order updates are harmless: states only move
 * forward, and a failure after delivery is ignored. Returns false for an unknown reference.
 */
export async function recordDeliveryStatus(
  db: Db,
  deps: CommsDeps,
  input: {
    provider: string;
    providerRef: string;
    status: 'delivered' | 'read' | 'failed';
    unreachable?: boolean;
    error?: string;
  },
): Promise<boolean> {
  const [ref] = await db.execute<{ orgId: string; deliveryId: string }>(sql`
    select org_id::text as "orgId", delivery_id::text as "deliveryId" from ops.delivery_ref
    where provider = ${input.provider} and provider_ref = ${input.providerRef}`);
  if (!ref) return false;

  if (input.status === 'failed') {
    await fail(
      db,
      deps,
      ref.orgId,
      ref.deliveryId,
      input.error ?? 'provider_failed',
      input.unreachable,
    );
    return true;
  }

  const status = input.status;
  const column = sql.identifier(status === 'read' ? 'read_at' : 'delivered_at');
  await withTenant(db, ref.orgId, async (tx) => {
    const [row] = await tx.execute<{ messageId: string }>(sql`
      update notification_delivery set state = ${status}, ${column} = coalesce(${column}, now())
      where org_id = app_current_org() and id = ${ref.deliveryId}
        and array_position(array['queued','sending','sent','delivered','read'], state)
          < ${RANK[status] + 1}
      returning message_id::text as "messageId"`);
    if (row) await recompute(tx, row.messageId);
  });
  return true;
}

/** Deliveries since a time by channel and state, in the current tenant (counts for the super admin). */
export async function deliveryCounts(
  tx: Tx,
  since: string,
): Promise<{ channel: string; state: string; n: number }[]> {
  return [
    ...(await tx.execute<{ channel: string; state: string; n: number }>(sql`
      select channel, state, count(*)::int as n from notification_delivery
      where org_id = app_current_org() and created_at >= ${since}::timestamptz
      group by channel, state order by channel, state`)),
  ];
}
