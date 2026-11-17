import type { Tx } from '@campusverse/db';
import { emit } from '@campusverse/platform-events';
import { sql } from 'drizzle-orm';
import type { Kind } from '../domain/plan.js';

export const MESSAGE_QUEUED = 'communications.message.queued.v1';

export type MessageInput = {
  recipientPersonId: string;
  kind: Kind;
  language: string;
  title: string;
  body: string;
  /** Same key, same message. Build it from the cause, such as the event id. */
  dedupeKey: string;
  /** The notice this message carries, if any. */
  noticeId?: string | null;
  /** The child the message is about, so the parent app can file it under that child. */
  aboutPersonId?: string | null;
  /** Shows an Acknowledge button; acknowledging is recorded once. */
  needsAck?: boolean;
};

/** Queues one message in the caller's tenant transaction. Null if the key was already used. */
export async function requestMessage(tx: Tx, input: MessageInput): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into notification_message
      (org_id, recipient_person_id, kind, language, title, body, dedupe_key, notice_id, about_person_id, needs_ack)
    values (app_current_org(), ${input.recipientPersonId}, ${input.kind}, ${input.language},
      ${input.title}, ${input.body}, ${input.dedupeKey}, ${input.noticeId ?? null},
      ${input.aboutPersonId ?? null}, ${input.needsAck ?? false})
    on conflict (org_id, dedupe_key) do nothing
    returning id::text`);
  if (!row) return null;
  await emit(tx, { type: MESSAGE_QUEUED, payload: { messageId: row.id } });
  return row.id;
}

/**
 * Queues a message to each current guardian of a student who has this kind of message switched
 * on. Restricted guardians get nothing on any channel. Each guardian has their own delivery status.
 */
export async function notifyGuardians(
  tx: Tx,
  input: Omit<MessageInput, 'recipientPersonId'> & {
    studentId: string;
    /** The guardian's opt-in this message honours; null for safety messages that always go. */
    flag: 'academic_messages' | 'fee_messages' | null;
  },
): Promise<string[]> {
  const flag = input.flag ? sql.identifier(input.flag) : sql`true`;
  const guardians = await tx.execute<{ id: string }>(sql`
    select guardian_person_id::text as id from guardian_link
    where org_id = app_current_org() and student_person_id = ${input.studentId}
      and valid_during @> app_today() and restricted_at is null and ${flag}`);
  const ids: string[] = [];
  for (const g of guardians) {
    const id = await requestMessage(tx, {
      ...input,
      aboutPersonId: input.studentId,
      recipientPersonId: g.id,
      dedupeKey: `${input.dedupeKey}:${g.id}`,
    });
    if (id) ids.push(id);
  }
  return ids;
}

export type MessageState = {
  messageId: string;
  recipientPersonId: string;
  state: string;
  channels: { channel: string; state: string; at: string | null }[];
};

/** Where each message got to, per channel: the proof a notice reached (or didn't reach) a guardian. */
export async function messageStates(tx: Tx, messageIds: string[]): Promise<MessageState[]> {
  if (messageIds.length === 0) return [];
  return [
    ...(await tx.execute<MessageState>(sql`
      select m.id::text as "messageId", m.recipient_person_id::text as "recipientPersonId", m.state,
        coalesce(jsonb_agg(jsonb_build_object('channel', d.channel, 'state', d.state,
          'at', coalesce(d.read_at, d.delivered_at, d.failed_at, d.sent_at))
          order by d.attempt_order) filter (where d.id is not null), '[]') as channels
      from notification_message m
      left join notification_delivery d on d.org_id = m.org_id and d.message_id = m.id
      where m.org_id = app_current_org() and m.id = any(${`{${messageIds.join(',')}}`}::uuid[])
      group by m.org_id, m.id order by m.created_at`)),
  ];
}
