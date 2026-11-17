// Public API of the audit module. The log is append-only: the database refuses UPDATE and DELETE.
import type { Tx } from '@campusverse/db';
import type { Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

export type DataClass = 'operational' | 'personal' | 'sensitive' | 'restricted';

export type AuditEntry = {
  /** module.resource.action, matching the permission that allowed it. */
  action: string;
  entityType: string;
  entityId?: string;
  dataClass: DataClass;
  reason?: string;
  /** Ids and codes only. Never names, phone numbers, marks or message text. */
  detail?: Record<string, string | number | boolean | null>;
  requestId?: string;
};

/** Writes one audit row in the caller's tenant transaction. A null actor means the system. */
export async function writeAudit(tx: Tx, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.execute(sql`
    insert into audit_event (org_id, actor_account_id, actor_person_id, action, entity_type,
      entity_id, data_class, reason, detail, request_id)
    values (app_current_org(), ${actor?.accountId ?? null}, ${actor?.personId ?? null},
      ${entry.action}, ${entry.entityType}, ${entry.entityId ?? null}, ${entry.dataClass},
      ${entry.reason ?? null}, ${JSON.stringify(entry.detail ?? {})}::jsonb,
      ${entry.requestId ?? null})`);
}

export type TrailEntry = {
  action: string;
  entityType: string;
  at: string;
  actorPersonId: string | null;
  reason: string | null;
  /** Ids and codes only, as written (never personal data). */
  detail: Record<string, string | number | boolean | null>;
};

/** What happened to one record, newest first: for a record's timeline. Call inside the tenant. */
export async function auditTrail(tx: Tx, entityId: string, limit = 30): Promise<TrailEntry[]> {
  return [
    ...(await tx.execute<TrailEntry>(sql`
      select action, entity_type as "entityType", occurred_at::text as at,
        actor_person_id::text as "actorPersonId", reason, detail
      from audit_event where org_id = app_current_org() and entity_id = ${entityId}
      order by occurred_at desc limit ${limit}`)),
  ];
}

/** When anything last happened in this tenant (for the super admin's customer list). */
export async function lastActivity(tx: Tx): Promise<string | null> {
  const [r] = await tx.execute<{ at: string | null }>(sql`
    select max(occurred_at)::text as at from audit_event where org_id = app_current_org()`);
  return r?.at ?? null;
}

/** Audit rows that record someone looking, not changing: never a "last changed by". */
const READ_ACTIONS = sql`action ~ '[.](reveal|read|read_own|ask|viewed|download)$' or action = 'support.viewed'`;

export type RecordStamp = {
  /** The first audited action: a creation, or (for older records) the first change. */
  firstAction: string;
  createdBy: string | null;
  createdAt: string;
  changedBy: string | null;
  changedAt: string;
  changes: number;
};

/**
 * Who created and who last changed each record, from the audit trail (person ids; the caller
 * resolves names). Records with no audit rows are missing from the result. Call inside the tenant.
 */
export async function recordStamps(
  tx: Tx,
  entityIds: string[],
): Promise<Record<string, RecordStamp>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0) return {};
  const rows = await tx.execute<RecordStamp & { id: string }>(sql`
    select distinct on (entity_id) entity_id::text as id,
      first_value(action) over w as "firstAction",
      first_value(actor_person_id::text) over w as "createdBy",
      first_value(occurred_at::text) over w as "createdAt",
      actor_person_id::text as "changedBy", occurred_at::text as "changedAt",
      (count(*) over (partition by entity_id))::int as changes
    from audit_event
    where org_id = app_current_org() and entity_id = any(${`{${ids.join(',')}}`}::uuid[])
      and not (${READ_ACTIONS})
    window w as (partition by entity_id order by occurred_at rows between unbounded preceding and unbounded following)
    order by entity_id, occurred_at desc`);
  return Object.fromEntries(rows.map(({ id, ...s }) => [id, s]));
}

/**
 * A list downloaded from a screen (students, dues…): who, which list, which school, how many rows.
 * The rows themselves are never logged. Call inside the tenant.
 */
export async function recordExport(
  tx: Tx,
  actor: Actor,
  input: { list: string; scopeId: string; rows: number },
): Promise<void> {
  await writeAudit(tx, actor, {
    action: 'platform.data.exported',
    entityType: input.list === 'attendance_register' ? 'school_section' : 'institution',
    entityId: input.scopeId,
    dataClass: 'personal',
    detail: { list: input.list, rows: input.rows },
  });
}

export type LogEntry = TrailEntry & {
  id: string;
  entityId: string | null;
  dataClass: DataClass;
};

/**
 * The organisation's activity log, newest first, a page at a time (rule book §13.12): every change
 * and every Verse AI step, kept for at least 180 days. `before` is the last id of the previous
 * page. Call inside the tenant, after checking platform.activity.read.
 */
export async function activityLog(
  tx: Tx,
  filter: {
    before: string | null;
    dataClass: DataClass | null;
    actorPersonId: string | null;
    /** Calendar day in India (YYYY-MM-DD); entries on or before it. */
    onOrBefore: string | null;
  },
  limit = 50,
): Promise<LogEntry[]> {
  return [
    ...(await tx.execute<LogEntry>(sql`
      select id::text, action, entity_type as "entityType", entity_id::text as "entityId",
        occurred_at::text as at, actor_person_id::text as "actorPersonId", reason, detail,
        data_class as "dataClass"
      from audit_event
      where org_id = app_current_org()
        ${filter.before ? sql`and id < ${filter.before}` : sql``}
        ${filter.dataClass ? sql`and data_class = ${filter.dataClass}` : sql``}
        ${filter.actorPersonId ? sql`and actor_person_id = ${filter.actorPersonId}` : sql``}
        ${
          filter.onOrBefore
            ? sql`and occurred_at < ((${filter.onOrBefore}::date + 1)::timestamp at time zone 'Asia/Kolkata')`
            : sql``
        }
      order by id desc limit ${limit}`)),
  ];
}

// ---------------------------------------------------------------------------------------------
// Seals: a SHA-256 hash chain over the log, so changes made behind the app's back show up.
// ---------------------------------------------------------------------------------------------

type SealRow = {
  id: string;
  at: string;
  account: string | null;
  person: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  dataClass: string;
  reason: string | null;
  detail: string;
};

const GENESIS = '0'.repeat(64);
// The event time in UTC, so the hash doesn't depend on a connection's TimeZone setting.
const SEAL_COLUMNS = sql`id::text,
  to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
  actor_account_id::text as account, actor_person_id::text as person, action,
  entity_type as "entityType", entity_id::text as "entityId", data_class as "dataClass", reason,
  detail::text as detail`;

/** One link of the chain: the previous hash and every column of the event, in a fixed order. */
export function chainLink(prev: string, r: SealRow): string {
  return createHash('sha256')
    .update(
      [
        prev,
        r.id,
        r.at,
        r.account ?? '',
        r.person ?? '',
        r.action,
        r.entityType,
        r.entityId ?? '',
        r.dataClass,
        r.reason ?? '',
        r.detail,
      ].join('\u001f'),
    )
    .digest('hex');
}

const eventsAfter = (tx: Tx, after: string | null, upto: string | null, limit: number) =>
  tx.execute<SealRow>(sql`
    select ${SEAL_COLUMNS}
    from audit_event where org_id = app_current_org()
      ${after ? sql`and id > ${after}` : sql``}
      ${upto ? sql`and id <= ${upto}` : sql``}
    order by id limit ${limit}`);

/**
 * Seals the events written since the last seal (up to 5,000 at a time). Safe to repeat: with
 * nothing new it writes nothing. Call inside the tenant. Events younger than a minute wait for
 * the next seal, so a transaction still committing can't slip in behind a seal.
 * ponytail: sealed when the log is opened; a scheduled seal across tenants once the worker has a
 * tenant list (control plane).
 */
export async function sealAuditLog(tx: Tx): Promise<{ sealed: number }> {
  const [last] = await tx.execute<{ upto: string; hash: string }>(sql`
    select upto_event_id::text as upto, chain_sha256 as hash from audit_seal
    where org_id = app_current_org() order by upto_event_id desc limit 1`);
  const candidates = await tx.execute<SealRow & { young: boolean }>(sql`
    select ${SEAL_COLUMNS}, occurred_at >= now() - interval '1 minute' as young
    from audit_event where org_id = app_current_org()
      ${last ? sql`and id > ${last.upto}` : sql``}
    order by id limit 5000`);
  // A seal covers an unbroken run of the log in id order: stop at the first event too young.
  const rows: SealRow[] = [];
  for (const { young, ...r } of candidates) {
    if (young) break;
    rows.push(r);
  }
  const upto = rows.at(-1);
  if (!upto) return { sealed: 0 };
  let hash = last?.hash ?? GENESIS;
  for (const r of rows) hash = chainLink(hash, r);
  await tx.execute(sql`
    insert into audit_seal (org_id, upto_event_id, event_count, chain_sha256)
    values (app_current_org(), ${upto.id}, ${rows.length}, ${hash})
    on conflict (org_id, upto_event_id) do nothing`);
  return { sealed: rows.length };
}

export type SealCheck = {
  ok: boolean;
  seals: number;
  events: number;
  lastSealedAt: string | null;
  /** The first seal whose chain no longer matches the events, if any. */
  brokenAt: string | null;
};

/**
 * Recomputes the chain from the first event and compares every seal. Call inside the tenant.
 * ponytail: rereads the whole log; start from a trusted checkpoint if logs grow past millions.
 */
export async function verifyAuditLog(tx: Tx): Promise<SealCheck> {
  const seals = [
    ...(await tx.execute<{ upto: string; count: number; hash: string; at: string }>(sql`
      select upto_event_id::text as upto, event_count as count, chain_sha256 as hash,
        sealed_at::text as at
      from audit_seal where org_id = app_current_org() order by upto_event_id`)),
  ];
  let hash = GENESIS;
  let after: string | null = null;
  let events = 0;
  for (const s of seals) {
    const rows = [...(await eventsAfter(tx, after, s.upto, 1_000_000))];
    for (const r of rows) hash = chainLink(hash, r);
    events += rows.length;
    if (rows.length !== s.count || hash !== s.hash)
      return { ok: false, seals: seals.length, events, lastSealedAt: s.at, brokenAt: s.at };
    after = s.upto;
  }
  return {
    ok: true,
    seals: seals.length,
    events,
    lastSealedAt: seals.at(-1)?.at ?? null,
    brokenAt: null,
  };
}
