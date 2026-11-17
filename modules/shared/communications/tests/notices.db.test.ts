// Notices end to end on real Postgres with fake providers: compose, approve, undo window,
// languages, who gets one, and each guardian's state on every channel through read and
// acknowledgement (the Milestone 10 exit check: delivery status is correct for every channel).
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  grantPermission,
  seedAdmin,
  seedTenant,
  syntheticPhone,
  type SeededTenant,
} from '@campusverse/db/seed';
import { createPermissions, PermissionDenied, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dispatch,
  fallback,
  recordDeliveryStatus,
  Unreachable,
  type CommsDeps,
} from '../application/delivery.js';
import { acknowledge, markRead, myMessages, setMyLanguage } from '../application/inbox.js';
import {
  approveNotice,
  cancelNotice,
  composeNotice,
  noticeDetail,
  previewNotice,
  releaseNotice,
  sendNotice,
  type AudiencePort,
  type NoticeDeps,
  type NoticeInput,
} from '../application/notices.js';
import type { Channel } from '../domain/plan.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
afterAll(() => close());

let t: SeededTenant;
let students: string[];
// The academic module's answer, stubbed: every student of the institution.
const audience: AudiencePort = {
  groups: async () => [],
  students: async () => students,
};
const deps: NoticeDeps = { db, permissions, audience };
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });

let principal: Actor;
let clerk: Actor;
let g1: Actor; // Kannada, push and WhatsApp, two children
let g2: Actor; // English, SMS only
let g3: string; // restricted
let g4: string; // academic messages switched off

type Refs = Record<Channel, string[]>;
function providers(behaviour: Partial<Record<Channel, 'ok' | 'unreachable'>> = {}) {
  const refs: Refs = { push: [], whatsapp: [], sms: [] };
  const make = (channel: Channel) => ({
    name: `fake-${channel}`,
    send: async () => {
      if (behaviour[channel] === 'unreachable') throw new Unreachable();
      const ref = `${channel}-${randomUUID()}`;
      refs[channel].push(ref);
      return { providerRef: ref };
    },
  });
  const comms: CommsDeps = {
    providers: { push: make('push'), whatsapp: make('whatsapp'), sms: make('sms') },
    allowlist: null,
    schedule: async () => undefined,
  };
  return { comms, refs };
}

async function person(name: string, channels: Channel[]) {
  return withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), ${name}) returning id::text`);
    for (const c of channels) {
      await tx.execute(sql`
        insert into person_contact (org_id, person_id, channel, address)
        values (app_current_org(), ${p!.id}, ${c}, ${c === 'push' ? `expo-token-${randomUUID()}` : syntheticPhone()})`);
    }
    return p!.id;
  });
}

async function link(
  guardian: string,
  student: string,
  extra: { restricted?: boolean; academic?: boolean } = {},
) {
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship, academic_messages,
        restricted_at, restriction_reason)
      values (app_current_org(), ${guardian}, ${student}, 'mother', ${extra.academic ?? true},
        ${extra.restricted ? sql`now()` : null}, ${extra.restricted ? 'Court order' : null})`),
  );
}

const english = { language: 'en' as const, title: 'Sports day', body: 'Sports day is on Friday.' };
const kannada = { language: 'kn' as const, title: 'ಕ್ರೀಡಾ ದಿನ', body: 'ಶುಕ್ರವಾರ ಕ್ರೀಡಾ ದಿನ.' };
const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  institutionId: t.institutionId,
  kind: 'notice',
  audience: { type: 'school' },
  needsAck: true,
  versions: [english, kannada],
  ...over,
});

/** Pretends the undo window has passed, then runs the worker's release. */
async function release(noticeId: string) {
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(
      sql`update notice set send_at = now() - interval '1 second' where org_id = app_current_org() and id = ${noticeId}`,
    ),
  );
  return releaseNotice(db, audience, t.orgId, noticeId);
}

const messagesOf = (noticeId: string) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute<{
      id: string;
      recipient: string;
      language: string;
      about: string | null;
      state: string;
    }>(sql`
      select id::text, recipient_person_id::text as recipient, language, about_person_id::text as about, state
      from notification_message where org_id = app_current_org() and notice_id = ${noticeId}`),
  );
const channelStates = (messageId: string) =>
  withTenant(db, t.orgId, async (tx) =>
    Object.fromEntries(
      (
        await tx.execute<{ channel: string; state: string }>(sql`
          select channel, state from notification_delivery where org_id = app_current_org() and message_id = ${messageId}`)
      ).map((r) => [r.channel, r.state]),
    ),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Notices');
  principal = actor(
    await seedAdmin(db, t.orgId, [
      'communications.notice.compose',
      'communications.notice.approve',
      'communications.notice.send_urgent',
      'communications.notice.track',
    ]),
  );
  clerk = actor(
    await seedAdmin(db, t.orgId, ['communications.notice.compose', 'communications.notice.track']),
  );
  await grantPermission(db, t.orgId, 'parent', 'communications.message.read_own', 'self');

  const [s1, s2, s3] = [
    await person('Child One', []),
    await person('Child Two', []),
    await person('Child Three', []),
  ];
  students = [s1, s2, s3];
  g1 = actor(await person('Guardian Kannada', ['push', 'whatsapp']));
  g2 = actor(await person('Guardian SMS', ['sms']));
  g3 = await person('Guardian Restricted', ['sms']);
  g4 = await person('Guardian Opted Out', ['sms']);
  await link(g1.personId, s1);
  await link(g1.personId, s2);
  await link(g2.personId, s3);
  await link(g3, s3, { restricted: true });
  await link(g4, s1, { academic: false });
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select org_id, p.id, r.id, 'organisation', org_id
      from role r cross join (values (${g1.personId}::uuid), (${g2.personId}::uuid)) as p (id)
      where r.org_id = app_current_org() and r.key = 'parent'`),
  );
  await setMyLanguage(deps, g1, 'kn');
});

describe('a notice from draft to sent', () => {
  it('needs English, approval before sending, and a role that may approve', async () => {
    await expect(composeNotice(deps, clerk, input({ versions: [kannada] }))).rejects.toThrow(
      /english_required/,
    );
    await expect(composeNotice(deps, g1, input())).rejects.toBeInstanceOf(PermissionDenied);
    const { id } = await composeNotice(deps, clerk, input());
    await expect(sendNotice(deps, clerk, id)).rejects.toThrow(/not_approved/);
    // Approved through the approval engine: by default, anyone holding the approve permission.
    await expect(approveNotice(deps, clerk, id)).rejects.toMatchObject({ code: 'not_your_step' });
    expect((await noticeDetail(deps, principal, id)).approval).toMatchObject({ mine: true });
    expect(await approveNotice(deps, principal, id)).toBe('approved');
    await expect(approveNotice(deps, principal, id)).rejects.toThrow(/not_a_draft/);
  });

  it('can be cancelled inside the undo window, and then nothing is sent', async () => {
    const { id } = await composeNotice(deps, clerk, input());
    await approveNotice(deps, principal, id);
    await sendNotice(deps, clerk, id);
    expect(await releaseNotice(db, audience, t.orgId, id)).toBe('not_due');
    await cancelNotice(deps, clerk, id);
    expect(await release(id)).toBe('skipped');
    expect(await messagesOf(id)).toHaveLength(0);
  });

  it('previews who gets it, in which language and on which channel', async () => {
    const { id } = await composeNotice(deps, clerk, input());
    expect(await previewNotice(deps, clerk, id)).toEqual({
      recipients: 2,
      byLanguage: [
        { language: 'en', guardians: 1, hasVersion: true },
        { language: 'kn', guardians: 1, hasVersion: true },
      ],
      unreachable: 0,
      firstChannel: { push: 1, whatsapp: 0, sms: 1 },
    });
  });
});

describe('delivery status on every channel (exit check)', () => {
  it('each guardian once, in their language; push and WhatsApp, read in the app, acknowledged; SMS unreachable', async () => {
    const { id } = await composeNotice(deps, clerk, input());
    await approveNotice(deps, principal, id);
    await sendNotice(deps, clerk, id);
    expect(await release(id)).toBe('released');
    expect(await release(id)).toBe('skipped'); // a repeated task changes nothing

    const messages = await messagesOf(id);
    // Restricted and opted-out guardians get nothing; the parent of two children gets one message.
    expect(messages.map((m) => m.recipient).sort()).toEqual([g1.personId, g2.personId].sort());
    const m1 = messages.find((m) => m.recipient === g1.personId)!;
    const m2 = messages.find((m) => m.recipient === g2.personId)!;
    expect([m1.language, m1.about]).toEqual(['kn', null]);
    expect([m2.language, m2.about]).toEqual(['en', students[2]]);

    // A notice goes on push and WhatsApp together; SMS-only parents get SMS, and here the number is dead.
    const ok = providers();
    await dispatch(db, ok.comms, t.orgId, m1.id);
    expect(await channelStates(m1.id)).toEqual({ push: 'sent', whatsapp: 'sent' });
    const dead = providers({ sms: 'unreachable' });
    await dispatch(db, dead.comms, t.orgId, m2.id);
    expect(await channelStates(m2.id)).toEqual({ sms: 'failed' });

    // WhatsApp reports delivered; the parent opens it in the app (push read).
    await recordDeliveryStatus(db, ok.comms, {
      provider: 'fake-whatsapp',
      providerRef: ok.refs.whatsapp[0]!,
      status: 'delivered',
    });
    await markRead(deps, g1, m1.id);
    await markRead(deps, g1, m1.id); // opening again changes nothing
    expect(await channelStates(m1.id)).toEqual({ push: 'read', whatsapp: 'delivered' });

    // Acknowledged once; late or repeated provider callbacks never move a state back.
    await acknowledge(deps, g1, m1.id);
    await expect(acknowledge(deps, g1, m1.id)).rejects.toThrow(/already_acknowledged/);
    await recordDeliveryStatus(db, ok.comms, {
      provider: 'fake-whatsapp',
      providerRef: ok.refs.whatsapp[0]!,
      status: 'delivered',
    });
    await recordDeliveryStatus(db, ok.comms, {
      provider: 'fake-push',
      providerRef: ok.refs.push[0]!,
      status: 'delivered',
    });
    expect(await channelStates(m1.id)).toEqual({ push: 'read', whatsapp: 'delivered' });

    // Another guardian can't touch it.
    await expect(markRead(deps, g2, m1.id)).rejects.toThrow(/message_not_found/);

    const detail = await noticeDetail(deps, clerk, id);
    expect(detail.counts).toEqual({ acknowledged: 1, failed: 1 });
    const row1 = detail.guardians.find((g) => g.recipientPersonId === g1.personId)!;
    expect(row1.state).toBe('acknowledged');
    expect(row1.channels.map((c) => [c.channel, c.state])).toEqual([
      ['push', 'read'],
      ['whatsapp', 'delivered'],
    ]);
    const row2 = detail.guardians.find((g) => g.recipientPersonId === g2.personId)!;
    expect([row2.state, row2.channels[0]?.state]).toEqual(['failed', 'failed']);
    await expect(noticeDetail(deps, g1, id)).rejects.toBeInstanceOf(PermissionDenied);

    // The parent's feed: their message, in their language, acknowledged; nothing of anyone else's.
    const feed = await myMessages(deps, g1);
    const mine = feed.items.find((i) => i.id === m1.id)!;
    expect([mine.title, mine.state, mine.needsAck]).toEqual([kannada.title, 'acknowledged', true]);
    expect(feed.items.every((i) => i.id !== m2.id)).toBe(true);
  });

  it('a circular unread on the app falls back to WhatsApp and shows as fallback sent', async () => {
    const { id } = await composeNotice(deps, clerk, input({ kind: 'circular', needsAck: false }));
    await approveNotice(deps, principal, id);
    await sendNotice(deps, clerk, id);
    await release(id);
    const m1 = (await messagesOf(id)).find((m) => m.recipient === g1.personId)!;
    const p = providers();
    await dispatch(db, p.comms, t.orgId, m1.id);
    expect(await channelStates(m1.id)).toEqual({ push: 'sent' });
    await fallback(db, p.comms, t.orgId, m1.id); // the 24-hour check finds it unread
    expect(await channelStates(m1.id)).toEqual({ push: 'sent', whatsapp: 'sent' });
    expect((await messagesOf(id)).find((m) => m.id === m1.id)?.state).toBe('fallback_sent');
    await expect(acknowledge(deps, g1, m1.id)).rejects.toThrow(/no_ack_needed/);
  });

  it('urgent goes at once without approval, only from a named role; an uninstalled app is marked unreachable', async () => {
    const draft = await composeNotice(deps, clerk, input({ kind: 'urgent', needsAck: false }));
    await expect(sendNotice(deps, clerk, draft.id)).rejects.toBeInstanceOf(PermissionDenied);
    await sendNotice(deps, principal, draft.id);
    expect(await releaseNotice(db, audience, t.orgId, draft.id)).toBe('released');
    const m1 = (await messagesOf(draft.id)).find((m) => m.recipient === g1.personId)!;
    const p = providers({ push: 'unreachable' });
    await dispatch(db, p.comms, t.orgId, m1.id);
    expect(await channelStates(m1.id)).toEqual({ push: 'failed', whatsapp: 'sent' });
    const [push] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ reason: string | null }>(sql`
        select disabled_reason as reason from person_contact
        where org_id = app_current_org() and person_id = ${g1.personId} and channel = 'push'`),
    );
    expect(push?.reason).toBe('unreachable');
  });
});
