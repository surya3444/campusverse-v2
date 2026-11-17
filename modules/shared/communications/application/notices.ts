import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit } from '@campusverse/platform-audit';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import {
  approvalStates,
  decideApproval,
  startApproval,
  withdrawApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import { sql } from 'drizzle-orm';
import { messageStates, requestMessage, type MessageState } from './messages.js';

type Permissions = ReturnType<typeof createPermissions>;

export const LANGUAGES = ['en', 'kn', 'te', 'ta', 'hi', 'ur'] as const;
export type Language = (typeof LANGUAGES)[number];
export type NoticeKind = 'notice' | 'circular' | 'urgent';
export type Audience = { type: 'school' } | { type: 'groups'; groupIds: string[] };

/** A choosable audience group (a class or a section), as the academic module names it. */
export type AudienceGroup = { id: string; label: string };

/**
 * Who is in an audience. Communications is shared and knows nothing about classes; each
 * academic module answers (school: classes and sections).
 */
export interface AudiencePort {
  groups(tx: Tx, institutionId: string, onDate: string): Promise<AudienceGroup[]>;
  /** Students in the groups on the date; null groups means the whole institution. */
  students(
    tx: Tx,
    institutionId: string,
    groupIds: string[] | null,
    onDate: string,
  ): Promise<string[]>;
}

export type NoticeDeps = { db: Db; permissions: Permissions; audience: AudiencePort };

/**
 * Notices are approved through the shared engine (rule book §12.4 decision 6). The composer isn't
 * recorded as the requester, so a principal may still approve their own notice as before; the
 * approval designer can add steps by role.
 */
const PROCESS = 'communications.notice';

export const NOTICE_SCHEDULED = 'communications.notice.scheduled.v1';
export const NOTICE_DUE = 'communications.notice-due';
/** The short window in which a sent notice can still be cancelled. Urgent messages go at once. */
export const UNDO_WINDOW_MS = 2 * 60_000;

export class NoticeError extends Error {
  constructor(readonly code: string) {
    super(`Notice: ${code}`);
    this.name = 'NoticeError';
  }
}

export type NoticeInput = {
  institutionId: string;
  kind: NoticeKind;
  audience: Audience;
  needsAck: boolean;
  versions: { language: Language; title: string; body: string }[];
};

async function place(db: Db, actor: Actor, institutionId: string) {
  return withTenant(db, actor.orgId, async (tx) => {
    const p = await placeOf(tx, institutionId);
    if (!p) throw new NoticeError('institution_not_found');
    return p;
  });
}

async function noticeRow(db: Db, actor: Actor, noticeId: string) {
  return withTenant(db, actor.orgId, async (tx) => {
    const [n] = await tx.execute<{ institutionId: string; kind: NoticeKind; state: string }>(sql`
      select institution_id::text as "institutionId", kind, state from notice
      where org_id = app_current_org() and id = ${noticeId}`);
    if (!n) throw new NoticeError('notice_not_found');
    const p = await placeOf(tx, n.institutionId);
    if (!p) throw new NoticeError('notice_not_found');
    return { ...n, place: p };
  });
}

function checkInput(input: NoticeInput) {
  if (!input.versions.some((v) => v.language === 'en')) throw new NoticeError('english_required');
  if (new Set(input.versions.map((v) => v.language)).size !== input.versions.length) {
    throw new NoticeError('language_twice');
  }
  if (input.audience.type === 'groups' && input.audience.groupIds.length === 0) {
    throw new NoticeError('no_audience');
  }
}

/** A new draft. Nothing is sent until it is approved (or, for urgent, sent by a named role). */
export async function composeNotice(
  deps: NoticeDeps,
  actor: Actor,
  input: NoticeInput,
): Promise<{ id: string }> {
  checkInput(input);
  const p = await place(deps.db, actor, input.institutionId);
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'communications.notice.compose', resource: { orgId: actor.orgId, place: p } },
    async (tx) => {
      const [n] = await tx.execute<{ id: string }>(sql`
        insert into notice (org_id, institution_id, kind, audience, needs_ack, created_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.kind}, ${JSON.stringify(input.audience)}::jsonb,
          ${input.needsAck}, ${actor.personId})
        returning id::text`);
      if (!n) throw new Error('composeNotice: no row');
      for (const v of input.versions) {
        await tx.execute(sql`
          insert into notice_version (org_id, notice_id, language, title, body)
          values (app_current_org(), ${n.id}, ${v.language}, ${v.title.trim()}, ${v.body.trim()})`);
      }
      // Urgent messages go from a named role without approval.
      if (input.kind !== 'urgent') {
        const en = input.versions.find((v) => v.language === 'en');
        await startApproval(tx, {
          process: PROCESS,
          subjectId: n.id,
          institutionId: input.institutionId,
          amountPaise: null,
          summary: (en?.title.trim() ?? '').slice(0, 200),
          requestedBy: null,
        });
      }
      return {
        result: n,
        audit: {
          action: 'communications.notice.compose',
          entityType: 'notice',
          entityId: n.id,
          dataClass: 'operational',
          detail: { kind: input.kind, languages: input.versions.map((v) => v.language).join(',') },
        },
      };
    },
  );
}

/**
 * Approves the current step of a draft through the shared engine. After the last step the notice
 * is approved, which fixes the text: from here on the versions can't change.
 */
export async function approveNotice(
  deps: NoticeDeps,
  actor: Actor,
  noticeId: string,
): Promise<'approved' | 'pending'> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [n] = await tx.execute<{ state: string }>(sql`
      select state from notice where org_id = app_current_org() and id = ${noticeId} for update`);
    if (!n) throw new NoticeError('notice_not_found');
    if (n.state !== 'draft') throw new NoticeError('not_a_draft');
    const outcome = await decideApproval(tx, deps.permissions, actor, {
      process: PROCESS,
      subjectId: noticeId,
      approve: true,
      note: null,
    });
    if (outcome === 'approved')
      await tx.execute(sql`
        update notice set state = 'approved', approved_by_person_id = ${actor.personId}, approved_at = now()
        where org_id = app_current_org() and id = ${noticeId}`);
    await writeAudit(tx, actor, {
      action:
        outcome === 'approved'
          ? 'communications.notice.approve'
          : 'communications.notice.step_approve',
      entityType: 'notice',
      entityId: noticeId,
      dataClass: 'operational',
    });
    return outcome === 'approved' ? 'approved' : 'pending';
  });
}

type Recipient = { guardianId: string; language: Language; aboutPersonId: string | null };

/**
 * Each guardian once (a parent of two children gets one notice), in their language if the notice
 * has it, else English. Restricted guardians and guardians who switched academic messages off get
 * nothing. A guardian with one child in the audience gets the message filed under that child.
 */
async function recipients(
  tx: Tx,
  audience: AudiencePort,
  n: { institutionId: string; audience: Audience },
) {
  const [d] = await tx.execute<{ today: string }>(sql`select app_today()::text as today`);
  const students = await audience.students(
    tx,
    n.institutionId,
    n.audience.type === 'school' ? null : n.audience.groupIds,
    d?.today ?? '',
  );
  if (students.length === 0) return [];
  const rows = await tx.execute<{
    guardianId: string;
    children: string[];
    language: Language | null;
  }>(sql`
    select g.guardian_person_id::text as "guardianId", array_agg(g.student_person_id::text) as children,
      p.language
    from guardian_link g
    left join communication_preference p on p.org_id = g.org_id and p.person_id = g.guardian_person_id
    where g.org_id = app_current_org() and g.valid_during @> app_today() and g.restricted_at is null
      and g.academic_messages and g.student_person_id = any(${`{${students.join(',')}}`}::uuid[])
    group by g.guardian_person_id, p.language`);
  return rows.map((r): Recipient => ({
    guardianId: r.guardianId,
    language: r.language ?? 'en',
    aboutPersonId: r.children.length === 1 ? (r.children[0] ?? null) : null,
  }));
}

export type NoticePreview = {
  recipients: number;
  byLanguage: { language: Language; guardians: number; hasVersion: boolean }[];
  /** Guardians with no working contact on any channel: they get nothing. */
  unreachable: number;
  /** First channel each guardian will be tried on, for a cost estimate. */
  firstChannel: { push: number; whatsapp: number; sms: number };
};

/** Who would get the notice, in which language, and on which channel. Writes nothing. */
export async function previewNotice(
  deps: NoticeDeps,
  actor: Actor,
  noticeId: string,
): Promise<NoticePreview> {
  const n = await noticeRow(deps.db, actor, noticeId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'communications.notice.compose', {
      orgId: actor.orgId,
      place: n.place,
    });
    const notice = await loadNotice(tx, noticeId);
    const list = await recipients(tx, deps.audience, notice);
    const ids = `{${list.map((r) => r.guardianId).join(',')}}`;
    const contacts = await tx.execute<{ id: string; channels: string[] }>(sql`
      select person_id::text as id, array_agg(distinct channel) as channels from person_contact
      where org_id = app_current_org() and disabled_at is null and person_id = any(${ids}::uuid[])
      group by person_id`);
    const byGuardian = new Map(contacts.map((c) => [c.id, c.channels]));
    const first = { push: 0, whatsapp: 0, sms: 0 };
    let unreachable = 0;
    for (const r of list) {
      const ch = byGuardian.get(r.guardianId) ?? [];
      const pick = (['push', 'whatsapp', 'sms'] as const).find((c) => ch.includes(c));
      if (pick) first[pick] += 1;
      else unreachable += 1;
    }
    const languages = new Set(notice.versions.map((v) => v.language));
    return {
      recipients: list.length,
      byLanguage: LANGUAGES.map((language) => ({
        language,
        guardians: list.filter((r) => r.language === language).length,
        hasVersion: languages.has(language),
      })).filter((l) => l.guardians > 0 || l.hasVersion),
      unreachable,
      firstChannel: first,
    };
  });
}

async function loadNotice(tx: Tx, noticeId: string) {
  const [n] = await tx.execute<{
    institutionId: string;
    kind: NoticeKind;
    audience: Audience;
    needsAck: boolean;
    state: string;
  }>(sql`
    select institution_id::text as "institutionId", kind, audience, needs_ack as "needsAck", state
    from notice where org_id = app_current_org() and id = ${noticeId}`);
  if (!n) throw new NoticeError('notice_not_found');
  const versions = await tx.execute<{ language: Language; title: string; body: string }>(sql`
    select language, title, body from notice_version where org_id = app_current_org() and notice_id = ${noticeId}`);
  return { ...n, versions: [...versions] };
}

/**
 * Sends an approved notice after the undo window. An urgent notice from a named role needs no
 * approval and goes at once.
 */
export async function sendNotice(
  deps: NoticeDeps,
  actor: Actor,
  noticeId: string,
): Promise<{ sendAt: string }> {
  const n = await noticeRow(deps.db, actor, noticeId);
  const urgent = n.kind === 'urgent';
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: urgent ? 'communications.notice.send_urgent' : 'communications.notice.compose',
      resource: { orgId: actor.orgId, place: n.place },
    },
    async (tx) => {
      const delay = urgent ? 0 : UNDO_WINDOW_MS;
      const [row] = await tx.execute<{ sendAt: string }>(sql`
        update notice set state = 'scheduled', send_at = now() + ${`${delay} milliseconds`}::interval
        where org_id = app_current_org() and id = ${noticeId}
          and (state = 'approved' or (${urgent} and state = 'draft'))
        returning send_at::text as "sendAt"`);
      if (!row) throw new NoticeError(urgent ? 'already_sent' : 'not_approved');
      await withdrawApproval(tx, PROCESS, noticeId);
      return {
        result: row,
        audit: {
          action: urgent ? 'communications.notice.send_urgent' : 'communications.notice.compose',
          entityType: 'notice',
          entityId: noticeId,
          dataClass: 'operational',
          detail: { sendAt: row.sendAt },
        },
        events: [{ type: NOTICE_SCHEDULED, payload: { noticeId, delayMs: delay } }],
      };
    },
  );
}

/** Cancels a notice that hasn't gone out: a draft, an approved one, or one inside its undo window. */
export async function cancelNotice(
  deps: NoticeDeps,
  actor: Actor,
  noticeId: string,
): Promise<void> {
  const n = await noticeRow(deps.db, actor, noticeId);
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'communications.notice.compose',
      resource: { orgId: actor.orgId, place: n.place },
    },
    async (tx) => {
      const [row] = await tx.execute(sql`
        update notice set state = 'cancelled', cancelled_at = now()
        where org_id = app_current_org() and id = ${noticeId} and state in ('draft', 'approved', 'scheduled')
        returning 1`);
      if (!row) throw new NoticeError('already_sent');
      await withdrawApproval(tx, PROCESS, noticeId);
      return {
        result: undefined,
        audit: {
          action: 'communications.notice.compose',
          entityType: 'notice',
          entityId: noticeId,
          dataClass: 'operational',
          detail: { cancelled: true },
        },
      };
    },
  );
}

/**
 * The worker's job once the undo window has passed: one message per guardian, in one
 * transaction. Safe to repeat: only a scheduled notice that is due is released, and each
 * guardian's message is keyed by notice and guardian.
 */
export async function releaseNotice(
  db: Db,
  audience: AudiencePort,
  orgId: string,
  noticeId: string,
): Promise<'released' | 'not_due' | 'skipped'> {
  return withTenant(db, orgId, async (tx) => {
    const [n] = await tx.execute<{ due: boolean; state: string }>(sql`
      select state, send_at <= now() as due from notice
      where org_id = app_current_org() and id = ${noticeId} for update`);
    if (!n || n.state !== 'scheduled') return 'skipped';
    if (!n.due) return 'not_due';
    const notice = await loadNotice(tx, noticeId);
    const versions = new Map(notice.versions.map((v) => [v.language, v]));
    const list = await recipients(tx, audience, notice);
    for (const r of list) {
      const v = versions.get(r.language) ?? versions.get('en');
      if (!v) continue;
      await requestMessage(tx, {
        recipientPersonId: r.guardianId,
        kind: notice.kind,
        language: v.language,
        title: v.title,
        body: v.body,
        dedupeKey: `notice:${noticeId}:${r.guardianId}`,
        noticeId,
        aboutPersonId: r.aboutPersonId,
        needsAck: notice.needsAck,
      });
    }
    await tx.execute(sql`
      update notice set state = 'sent', sent_at = now(), recipients = ${list.length}
      where org_id = app_current_org() and id = ${noticeId}`);
    return 'released';
  });
}

export type NoticeSummary = {
  id: string;
  kind: NoticeKind;
  state: string;
  title: string;
  needsAck: boolean;
  audience: Audience;
  createdBy: string;
  createdAt: string;
  sendAt: string | null;
  recipients: number | null;
  /** Message states once sent: queued, sent, delivered, read, acknowledged, failed… */
  counts: Record<string, number>;
};

export async function listNotices(
  deps: NoticeDeps,
  actor: Actor,
  institutionId: string,
): Promise<NoticeSummary[]> {
  const p = await place(deps.db, actor, institutionId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'communications.notice.track', {
      orgId: actor.orgId,
      place: p,
    });
    return [
      ...(await tx.execute<NoticeSummary>(sql`
        select n.id::text, n.kind, n.state, v.title, n.needs_ack as "needsAck", n.audience,
          p.legal_name as "createdBy", n.created_at::text as "createdAt", n.send_at::text as "sendAt",
          n.recipients,
          coalesce((select jsonb_object_agg(s.state, s.n) from (
            select m.state, count(*)::int as n from notification_message m
            where m.org_id = n.org_id and m.notice_id = n.id group by m.state) s), '{}') as counts
        from notice n
        join notice_version v on v.org_id = n.org_id and v.notice_id = n.id and v.language = 'en'
        join person p on p.org_id = n.org_id and p.id = n.created_by_person_id
        where n.org_id = app_current_org() and n.institution_id = ${institutionId}
        order by n.created_at desc limit 100`)),
    ];
  });
}

export type NoticeDetail = Omit<NoticeSummary, 'title'> & {
  versions: { language: Language; title: string; body: string }[];
  approvedBy: string | null;
  /** A draft's approval in the shared engine: step, who decides, and whether the viewer may. */
  approval: ApprovalState | null;
  /** One row per guardian: their message and each channel's state. */
  guardians: (MessageState & { name: string; acknowledgedAt: string | null })[];
};

export async function noticeDetail(
  deps: NoticeDeps,
  actor: Actor,
  noticeId: string,
): Promise<NoticeDetail> {
  const n = await noticeRow(deps.db, actor, noticeId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'communications.notice.track', {
      orgId: actor.orgId,
      place: n.place,
    });
    const [row] = await tx.execute<Omit<NoticeDetail, 'versions' | 'guardians' | 'approval'>>(sql`
      select n.id::text, n.kind, n.state, n.needs_ack as "needsAck", n.audience, c.legal_name as "createdBy",
        n.created_at::text as "createdAt", n.send_at::text as "sendAt", n.recipients, a.legal_name as "approvedBy",
        coalesce((select jsonb_object_agg(s.state, s.n) from (
          select m.state, count(*)::int as n from notification_message m
          where m.org_id = n.org_id and m.notice_id = n.id group by m.state) s), '{}') as counts
      from notice n
      join person c on c.org_id = n.org_id and c.id = n.created_by_person_id
      left join person a on a.org_id = n.org_id and a.id = n.approved_by_person_id
      where n.org_id = app_current_org() and n.id = ${noticeId}`);
    if (!row) throw new NoticeError('notice_not_found');
    const notice = await loadNotice(tx, noticeId);
    const messages = await tx.execute<{
      id: string;
      name: string;
      acknowledgedAt: string | null;
    }>(sql`
      select m.id::text, p.legal_name as name, m.acknowledged_at::text as "acknowledgedAt"
      from notification_message m join person p on p.org_id = m.org_id and p.id = m.recipient_person_id
      where m.org_id = app_current_org() and m.notice_id = ${noticeId}
      order by p.legal_name limit 2000`);
    const states = new Map(
      (
        await messageStates(
          tx,
          messages.map((m) => m.id),
        )
      ).map((s) => [s.messageId, s]),
    );
    const approval =
      row.state === 'draft'
        ? ((await approvalStates(tx, deps.permissions, actor, PROCESS, [noticeId]))[noticeId] ??
          null)
        : null;
    return {
      ...row,
      approval,
      versions: notice.versions,
      guardians: messages.flatMap((m) => {
        const s = states.get(m.id);
        return s ? [{ ...s, name: m.name, acknowledgedAt: m.acknowledgedAt }] : [];
      }),
    };
  });
}

/** The academic module's groups (classes and sections) for the compose form. */
export async function audienceGroups(
  deps: NoticeDeps,
  actor: Actor,
  institutionId: string,
): Promise<AudienceGroup[]> {
  const p = await place(deps.db, actor, institutionId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, 'communications.notice.compose', {
      orgId: actor.orgId,
      place: p,
    });
    const [d] = await tx.execute<{ today: string }>(sql`select app_today()::text as today`);
    return deps.audience.groups(tx, institutionId, d?.today ?? '');
  });
}

/**
 * One audience from several: the academic one (classes and sections) first, then services such as
 * transport (routes, fare zones). A service's groups only ever reach students of the institution,
 * as the academic audience knows them, so a shared bus never bills or messages another school's
 * students.
 */
export function combineAudiences(
  academic: AudiencePort,
  ...services: Pick<AudiencePort, 'groups' | 'students'>[]
): AudiencePort {
  return {
    async groups(tx, institutionId, onDate) {
      const all = [await academic.groups(tx, institutionId, onDate)];
      for (const s of services) all.push(await s.groups(tx, institutionId, onDate));
      return all.flat();
    },
    async students(tx, institutionId, groupIds, onDate) {
      const mine = await academic.students(tx, institutionId, groupIds, onDate);
      if (groupIds === null || services.length === 0) return mine;
      const enrolled = new Set(await academic.students(tx, institutionId, null, onDate));
      const out = new Set(mine);
      for (const s of services)
        for (const id of await s.students(tx, institutionId, groupIds, onDate))
          if (enrolled.has(id)) out.add(id);
      return [...out];
    },
  };
}
