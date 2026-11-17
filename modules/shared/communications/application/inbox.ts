import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { LANGUAGES, NoticeError, type Language, type NoticeDeps } from './notices.js';

type InboxDeps = Pick<NoticeDeps, 'db' | 'permissions'>;

/** Every inbox call is about the actor's own messages: the self relation. */
const own = (actor: Actor) => ({
  permission: 'communications.message.read_own',
  resource: { orgId: actor.orgId, subjectPersonId: actor.personId },
});

export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  language: string;
  state: string;
  aboutPersonId: string | null;
  needsAck: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

/** The signed-in person's messages, newest first; for one child, that child's plus school-wide ones. */
export async function myMessages(
  deps: InboxDeps,
  actor: Actor,
  input: { aboutPersonId?: string | null | undefined; limit?: number | undefined } = {},
): Promise<{ items: InboxItem[]; unread: number }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const p = own(actor);
    await deps.permissions.assertCan(tx, actor, p.permission, p.resource);
    const about = input.aboutPersonId ?? null;
    const items = await tx.execute<InboxItem>(sql`
      select id::text, kind, title, body, language, state, about_person_id::text as "aboutPersonId",
        needs_ack as "needsAck", read_at::text as "readAt", acknowledged_at::text as "acknowledgedAt",
        created_at::text as "createdAt"
      from notification_message
      where org_id = app_current_org() and recipient_person_id = ${actor.personId} and state <> 'cancelled'
        and kind <> 'account'
        and (${about}::uuid is null or about_person_id is null or about_person_id = ${about}::uuid)
      order by created_at desc limit ${Math.min(input.limit ?? 50, 100)}`);
    const [unread] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from notification_message
      where org_id = app_current_org() and recipient_person_id = ${actor.personId} and read_at is null
        and state <> 'cancelled' and kind <> 'account'`);
    return { items: [...items], unread: unread?.n ?? 0 };
  });
}

async function mine(tx: Tx, actor: Actor, messageId: string) {
  const [m] = await tx.execute<{
    needsAck: boolean;
    readAt: string | null;
    acknowledgedAt: string | null;
  }>(sql`
    select needs_ack as "needsAck", read_at::text as "readAt", acknowledged_at::text as "acknowledgedAt"
    from notification_message
    where org_id = app_current_org() and id = ${messageId} and recipient_person_id = ${actor.personId}
    for update`);
  if (!m) throw new NoticeError('message_not_found');
  return m;
}

const STATE_RANK = `array['queued','sent','fallback_sent','delivered','read']`;

/**
 * Opening a message in the app is a read on the app (push) channel. States only move forward,
 * so a late provider callback can't undo it. Repeat opens change nothing.
 */
export async function markRead(deps: InboxDeps, actor: Actor, messageId: string): Promise<void> {
  const p = own(actor);
  const first = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => !(await mine(tx, actor, messageId)).readAt,
  );
  if (!first) return;
  await command(deps.db, deps.permissions, actor, p, async (tx) => {
    await mine(tx, actor, messageId);
    await tx.execute(sql`
      update notification_message set read_at = coalesce(read_at, now())
      where org_id = app_current_org() and id = ${messageId}`);
    await tx.execute(sql`
      update notification_delivery set state = 'read', read_at = coalesce(read_at, now()),
        delivered_at = coalesce(delivered_at, now())
      where org_id = app_current_org() and message_id = ${messageId} and channel = 'push'
        and state in ('queued', 'sending', 'sent', 'delivered')`);
    // Read beats every earlier state, but never undoes acknowledged or cancelled.
    await tx.execute(sql`
      update notification_message set state = 'read'
      where org_id = app_current_org() and id = ${messageId}
        and coalesce(array_position(${sql.raw(STATE_RANK)}, state), 0) < 5 and state not in ('acknowledged', 'cancelled')`);
    return {
      result: undefined,
      audit: {
        action: 'communications.message.read_own',
        entityType: 'notification_message',
        entityId: messageId,
        dataClass: 'operational',
        detail: { event: 'read' },
      },
    };
  });
}

/** Acknowledges a notice that asks for it. Recorded once; reading is implied. */
export async function acknowledge(deps: InboxDeps, actor: Actor, messageId: string): Promise<void> {
  await command(deps.db, deps.permissions, actor, own(actor), async (tx) => {
    const m = await mine(tx, actor, messageId);
    if (!m.needsAck) throw new NoticeError('no_ack_needed');
    if (m.acknowledgedAt) throw new NoticeError('already_acknowledged');
    await tx.execute(sql`
      update notification_message set acknowledged_at = now(), read_at = coalesce(read_at, now()),
        state = 'acknowledged'
      where org_id = app_current_org() and id = ${messageId}`);
    return {
      result: undefined,
      audit: {
        action: 'communications.message.read_own',
        entityType: 'notification_message',
        entityId: messageId,
        dataClass: 'operational',
        detail: { event: 'acknowledged' },
      },
    };
  });
}

export async function myLanguage(deps: InboxDeps, actor: Actor): Promise<Language> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ language: Language }>(sql`
      select language from communication_preference where org_id = app_current_org() and person_id = ${actor.personId}`);
    return row?.language ?? 'en';
  });
}

export async function setMyLanguage(
  deps: InboxDeps,
  actor: Actor,
  language: Language,
): Promise<void> {
  if (!LANGUAGES.includes(language)) throw new NoticeError('bad_language');
  await command(deps.db, deps.permissions, actor, own(actor), async (tx) => {
    await tx.execute(sql`
      insert into communication_preference (org_id, person_id, language)
      values (app_current_org(), ${actor.personId}, ${language})
      on conflict (org_id, person_id) do update set language = excluded.language, updated_at = now()`);
    return {
      result: undefined,
      audit: {
        action: 'communications.message.read_own',
        entityType: 'person',
        entityId: actor.personId,
        dataClass: 'operational',
        detail: { language },
      },
    };
  });
}

/**
 * Registers this device's push token. A newer token replaces older ones, which stop being
 * used; a token the push service rejects later is marked unreachable by the delivery engine.
 */
export async function registerPushToken(
  deps: InboxDeps,
  actor: Actor,
  token: string,
): Promise<void> {
  if (!/^[\w:[\]-]{10,300}$/.test(token)) throw new NoticeError('bad_token');
  await command(deps.db, deps.permissions, actor, own(actor), async (tx) => {
    await tx.execute(sql`
      update person_contact set disabled_at = now(), disabled_reason = 'replaced'
      where org_id = app_current_org() and person_id = ${actor.personId} and channel = 'push'
        and address <> ${token} and disabled_at is null`);
    await tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address)
      values (app_current_org(), ${actor.personId}, 'push', ${token})
      on conflict (org_id, person_id, channel, address) do update set disabled_at = null, disabled_reason = null`);
    return {
      result: undefined,
      audit: {
        action: 'communications.message.read_own',
        entityType: 'person',
        entityId: actor.personId,
        dataClass: 'operational',
        detail: { push: 'registered' },
      },
    };
  });
}
