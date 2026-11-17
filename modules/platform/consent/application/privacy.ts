// Privacy & Consent console (rule book §13.12): consent coverage per purpose, notices by version,
// data-rights requests on a clock, and the breach register with the CERT-In 6-hour check.
// Everything here needs platform.privacy.manage at organisation scope (the Data Protection
// Officer's console); guardians still decide through recordConsent.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  PURPOSES,
  certInStatus,
  coveragePercent,
  isClosed,
  requestDueAt,
  requestOverdue,
  type CertInStatus,
  type RequestKind,
  type RequestState,
} from '../domain/privacy.js';

type Permissions = ReturnType<typeof createPermissions>;
export type PrivacyDeps = { db: Db; permissions: Permissions };

const MANAGE = 'platform.privacy.manage';
export const RIGHTS_REQUEST_RECORDED = 'platform.privacy.request_recorded.v1';
export const RIGHTS_REQUEST_CLOSED = 'platform.privacy.request_closed.v1';
export const BREACH_RECORDED = 'platform.privacy.breach_recorded.v1';
export const NOTICE_PUBLISHED = 'platform.consent.notice_published.v1';

export class PrivacyError extends Error {
  constructor(
    readonly code:
      | 'request_not_found'
      | 'already_closed'
      | 'outcome_required'
      | 'breach_not_found'
      | 'breach_closed'
      | 'not_a_guardian'
      | 'method_unavailable'
      | 'document_required'
      | 'note_required',
  ) {
    super(`privacy: ${code}`);
    this.name = 'PrivacyError';
  }
}

const read = <T>(deps: PrivacyDeps, actor: Actor, work: (tx: Tx) => Promise<T>) =>
  withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, MANAGE, { orgId: actor.orgId });
    return work(tx);
  });

// ---------------------------------------------------------------------------------------------
// Coverage and notices
// ---------------------------------------------------------------------------------------------

export type PurposeCoverage = {
  purpose: string;
  latestVersion: number | null;
  languages: string[];
  students: number;
  granted: number;
  withdrawn: number;
  undecided: number;
  /** Granted by a guardian not yet verified: recorded, but not counted until they are. */
  awaitingVerification: number;
  percent: number;
};

export type PrivacyOverview = {
  purposes: PurposeCoverage[];
  /** Current guardians, and how many are verified as identifiable adults (DPDP Rule 10). */
  guardians: { total: number; verified: number };
  openRequests: number;
  overdueRequests: number;
  openBreaches: number;
  lateBreaches: number;
};

/**
 * Coverage counts students with a current guardian. A student's status for a purpose is their
 * latest guardian decision: a later withdrawal by either guardian wins over an earlier grant.
 */
export async function privacyOverview(deps: PrivacyDeps, actor: Actor): Promise<PrivacyOverview> {
  return read(deps, actor, async (tx) => {
    const rows = await tx.execute<{
      purpose: string;
      latestVersion: number | null;
      languages: string[] | null;
      students: number;
      granted: number;
      withdrawn: number;
      awaiting: number;
    }>(sql`
      with students as (
        select distinct student_person_id as id from guardian_link
        where org_id = app_current_org() and valid_during @> app_today()
      ),
      purposes as (
        select unnest(${`{${PURPOSES.join(',')}}`}::text[]) as purpose
        union select distinct purpose from consent_notice where org_id = app_current_org()
      ),
      latest as (
        select distinct on (student_person_id, purpose) student_person_id, purpose, decision, guardian_person_id
        from consent_record where org_id = app_current_org()
        order by student_person_id, purpose, id desc
      ),
      verified as (
        select guardian_person_id from (
          select distinct on (guardian_person_id) guardian_person_id, outcome from consent_guardian_check
          where org_id = app_current_org() order by guardian_person_id, id desc
        ) c where outcome = 'verified'
      )
      select p.purpose,
        (select max(version) from consent_notice n where n.org_id = app_current_org() and n.purpose = p.purpose)
          as "latestVersion",
        (select array_agg(distinct language order by language) from consent_notice n
          where n.org_id = app_current_org() and n.purpose = p.purpose) as languages,
        (select count(*)::int from students) as students,
        (select count(*)::int from students s join latest l on l.student_person_id = s.id
          where l.purpose = p.purpose and l.decision = 'granted'
            and l.guardian_person_id in (select guardian_person_id from verified)) as granted,
        (select count(*)::int from students s join latest l on l.student_person_id = s.id
          where l.purpose = p.purpose and l.decision = 'granted'
            and l.guardian_person_id not in (select guardian_person_id from verified)) as awaiting,
        (select count(*)::int from students s join latest l on l.student_person_id = s.id
          where l.purpose = p.purpose and l.decision = 'withdrawn') as withdrawn
      from purposes p order by p.purpose`);
    const order = (p: string) => {
      const i = (PURPOSES as readonly string[]).indexOf(p);
      return i < 0 ? PURPOSES.length : i;
    };
    const purposes = [...rows]
      .map((r) => ({
        purpose: r.purpose,
        latestVersion: r.latestVersion,
        languages: r.languages ?? [],
        students: r.students,
        granted: r.granted,
        withdrawn: r.withdrawn,
        awaitingVerification: r.awaiting,
        undecided: Math.max(0, r.students - r.granted - r.withdrawn - r.awaiting),
        percent: coveragePercent(r.granted, r.students),
      }))
      .sort((a, b) => order(a.purpose) - order(b.purpose));

    const [g] = await tx.execute<{ total: number; verified: number }>(sql`
      with current as (
        select distinct guardian_person_id from guardian_link
        where org_id = app_current_org() and valid_during @> app_today()
      )
      select (select count(*)::int from current) as total,
        (select count(*)::int from current c where (
          select outcome from consent_guardian_check k where k.org_id = app_current_org()
            and k.guardian_person_id = c.guardian_person_id order by k.id desc limit 1) = 'verified') as verified`);
    const now = new Date();
    const requests = await tx.execute<{ state: RequestState; dueAt: string }>(sql`
      select state, due_at::text as "dueAt" from consent_rights_request
      where org_id = app_current_org() and state in ('open', 'in_progress')`);
    const breaches = await tx.execute<{
      discoveredAt: string;
      certInReportedAt: string | null;
    }>(sql`
      select discovered_at::text as "discoveredAt", cert_in_reported_at::text as "certInReportedAt"
      from consent_breach where org_id = app_current_org() and closed_at is null`);
    return {
      purposes,
      guardians: { total: g?.total ?? 0, verified: g?.verified ?? 0 },
      openRequests: requests.length,
      overdueRequests: requests.filter((r) =>
        requestOverdue({ state: r.state, dueAt: new Date(r.dueAt) }, now),
      ).length,
      openBreaches: breaches.length,
      lateBreaches: breaches.filter(
        (b) =>
          certInStatus(
            {
              discoveredAt: new Date(b.discoveredAt),
              certInReportedAt: b.certInReportedAt ? new Date(b.certInReportedAt) : null,
            },
            now,
          ) === 'late',
      ).length,
    };
  });
}

export type NoticeRow = {
  id: string;
  purpose: string;
  version: number;
  language: string;
  body: string;
  bodySha256: string;
  publishedAt: string;
};

export async function notices(deps: PrivacyDeps, actor: Actor): Promise<NoticeRow[]> {
  return read(deps, actor, async (tx) => [
    ...(await tx.execute<NoticeRow>(sql`
      select id::text, purpose, version, language, body, body_sha256 as "bodySha256",
        published_at::text as "publishedAt"
      from consent_notice where org_id = app_current_org()
      order by purpose, version desc, language`)),
  ]);
}

/**
 * Publishes the next version of a purpose's notice in one language. Earlier versions stay, so
 * every decision keeps pointing at the exact text the guardian saw.
 */
export async function publishNextNotice(
  deps: PrivacyDeps,
  actor: Actor,
  input: { purpose: string; language: string; body: string },
): Promise<{ id: string; version: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'platform.consent.publish_notice', resource: { orgId: actor.orgId } },
    async (tx) => {
      const body = input.body.trim();
      const [row] = await tx.execute<{ id: string; version: number }>(sql`
        insert into consent_notice (org_id, purpose, version, language, body_sha256, body)
        select app_current_org(), ${input.purpose},
          coalesce(max(version), 0) + 1, ${input.language},
          ${createHash('sha256').update(body).digest('hex')}, ${body}
        from consent_notice
        where org_id = app_current_org() and purpose = ${input.purpose} and language = ${input.language}
        returning id::text, version`);
      if (!row) throw new Error('publishNextNotice: insert returned no row');
      return {
        result: row,
        audit: {
          action: 'platform.consent.publish_notice',
          entityType: 'consent_notice',
          entityId: row.id,
          dataClass: 'operational',
          detail: { purpose: input.purpose, version: row.version, language: input.language },
        },
        events: [
          {
            type: NOTICE_PUBLISHED,
            payload: {
              noticeId: row.id,
              purpose: input.purpose,
              version: row.version,
              language: input.language,
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Data-rights requests
// ---------------------------------------------------------------------------------------------

export type RightsRequestRow = {
  id: string;
  number: number;
  kind: RequestKind;
  requesterName: string;
  requesterContact: string | null;
  subjectPersonId: string | null;
  subject: string | null;
  details: string;
  state: RequestState;
  outcome: string | null;
  receivedAt: string;
  dueAt: string;
  closedAt: string | null;
  overdue: boolean;
};

export type RequestView = 'open' | 'overdue' | 'closed';

export async function rightsRequests(
  deps: PrivacyDeps,
  actor: Actor,
  view: RequestView,
): Promise<RightsRequestRow[]> {
  return read(deps, actor, async (tx) => {
    const rows = await tx.execute<Omit<RightsRequestRow, 'subject' | 'overdue'>>(sql`
      select id::text, number, kind, requester_name as "requesterName",
        requester_contact as "requesterContact", subject_person_id::text as "subjectPersonId",
        details, state, outcome, received_at::text as "receivedAt", due_at::text as "dueAt",
        closed_at::text as "closedAt"
      from consent_rights_request
      where org_id = app_current_org()
        and ${view === 'closed' ? sql`state in ('done', 'rejected')` : sql`state in ('open', 'in_progress')`}
      order by ${view === 'closed' ? sql`closed_at desc` : sql`due_at`}
      limit 200`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => (r.subjectPersonId ? [r.subjectPersonId] : [])),
    );
    const now = new Date();
    const all = rows.map((r) => ({
      ...r,
      subject: r.subjectPersonId ? (names[r.subjectPersonId] ?? null) : null,
      overdue: requestOverdue({ state: r.state, dueAt: new Date(r.dueAt) }, now),
    }));
    return view === 'overdue' ? all.filter((r) => r.overdue) : all;
  });
}

export async function recordRightsRequest(
  deps: PrivacyDeps,
  actor: Actor,
  input: {
    kind: RequestKind;
    requesterName: string;
    requesterContact: string | null;
    subjectPersonId: string | null;
    details: string;
    receivedAt: string | null;
  },
): Promise<{ id: string; number: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
      // ponytail: number is max+1 under the row lock of a unique index; a counter table if two
      // offices ever record requests in the same instant often enough to collide.
      const [row] = await tx.execute<{ id: string; number: number }>(sql`
        insert into consent_rights_request (org_id, number, kind, requester_name, requester_contact,
          subject_person_id, details, received_at, due_at, recorded_by_account_id)
        select app_current_org(), coalesce(max(number), 0) + 1, ${input.kind},
          ${input.requesterName.trim()}, ${input.requesterContact?.trim() || null},
          ${input.subjectPersonId}, ${input.details.trim()}, ${receivedAt.toISOString()},
          ${requestDueAt(receivedAt).toISOString()}, ${actor.accountId}
        from consent_rights_request where org_id = app_current_org()
        returning id::text, number`);
      if (!row) throw new Error('recordRightsRequest: insert returned no row');
      return {
        result: row,
        audit: {
          action: 'platform.privacy.request_record',
          entityType: 'consent_rights_request',
          entityId: row.id,
          dataClass: 'personal',
          detail: { number: row.number, kind: input.kind },
        },
        events: [
          {
            type: RIGHTS_REQUEST_RECORDED,
            payload: { requestId: row.id, number: row.number, kind: input.kind },
          },
        ],
      };
    },
  );
}

/** Moves a request on. Done or rejected closes it, and needs the outcome written down. */
export async function setRightsRequestState(
  deps: PrivacyDeps,
  actor: Actor,
  input: { requestId: string; state: RequestState; outcome: string | null },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [current] = await tx.execute<{ state: RequestState; number: number }>(sql`
        select state, number from consent_rights_request
        where org_id = app_current_org() and id = ${input.requestId} for update`);
      if (!current) throw new PrivacyError('request_not_found');
      if (isClosed(current.state)) throw new PrivacyError('already_closed');
      const closing = isClosed(input.state);
      if (closing && !input.outcome?.trim()) throw new PrivacyError('outcome_required');
      await tx.execute(sql`
        update consent_rights_request set state = ${input.state},
          outcome = coalesce(${input.outcome?.trim() || null}, outcome),
          closed_at = ${closing ? sql`now()` : sql`null`}
        where org_id = app_current_org() and id = ${input.requestId}`);
      return {
        result: undefined,
        audit: {
          action: 'platform.privacy.request_state',
          entityType: 'consent_rights_request',
          entityId: input.requestId,
          dataClass: 'personal',
          detail: { number: current.number, from: current.state, to: input.state },
        },
        events: closing
          ? [
              {
                type: RIGHTS_REQUEST_CLOSED,
                payload: { requestId: input.requestId, state: input.state },
              },
            ]
          : [],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Breach register
// ---------------------------------------------------------------------------------------------

export type BreachRow = {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  affectedCount: number | null;
  discoveredAt: string;
  certInReportedAt: string | null;
  boardReportedAt: string | null;
  peopleInformedAt: string | null;
  closedAt: string | null;
  certIn: CertInStatus;
};

export async function breaches(deps: PrivacyDeps, actor: Actor): Promise<BreachRow[]> {
  return read(deps, actor, async (tx) => {
    const rows = await tx.execute<Omit<BreachRow, 'certIn'>>(sql`
      select id::text, title, description, severity, affected_count as "affectedCount",
        discovered_at::text as "discoveredAt", cert_in_reported_at::text as "certInReportedAt",
        board_reported_at::text as "boardReportedAt", people_informed_at::text as "peopleInformedAt",
        closed_at::text as "closedAt"
      from consent_breach where org_id = app_current_org()
      order by closed_at is not null, discovered_at desc limit 200`);
    const now = new Date();
    return rows.map((r) => ({
      ...r,
      certIn: certInStatus(
        {
          discoveredAt: new Date(r.discoveredAt),
          certInReportedAt: r.certInReportedAt ? new Date(r.certInReportedAt) : null,
        },
        now,
      ),
    }));
  });
}

export async function recordBreach(
  deps: PrivacyDeps,
  actor: Actor,
  input: {
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    affectedCount: number | null;
    discoveredAt: string;
  },
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into consent_breach (org_id, title, description, severity, affected_count,
          discovered_at, recorded_by_account_id)
        values (app_current_org(), ${input.title.trim()}, ${input.description.trim()},
          ${input.severity}, ${input.affectedCount}, ${input.discoveredAt}, ${actor.accountId})
        returning id::text`);
      if (!row) throw new Error('recordBreach: insert returned no row');
      return {
        result: row,
        audit: {
          action: 'platform.privacy.breach_record',
          entityType: 'consent_breach',
          entityId: row.id,
          dataClass: 'operational',
          detail: { severity: input.severity, affectedCount: input.affectedCount },
        },
        events: [
          {
            type: BREACH_RECORDED,
            payload: {
              breachId: row.id,
              severity: input.severity,
              discoveredAt: input.discoveredAt,
            },
          },
        ],
      };
    },
  );
}

export type BreachStep = 'cert_in' | 'board' | 'people' | 'close';

/** Records one step of handling a breach, at the time it happened (now if not given). */
export async function markBreachStep(
  deps: PrivacyDeps,
  actor: Actor,
  input: { breachId: string; step: BreachStep; at: string | null },
): Promise<void> {
  const column = {
    cert_in: sql`cert_in_reported_at`,
    board: sql`board_reported_at`,
    people: sql`people_informed_at`,
    close: sql`closed_at`,
  }[input.step];
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId } },
    async (tx) => {
      const [b] = await tx.execute<{ closed: boolean }>(sql`
        select closed_at is not null as closed from consent_breach
        where org_id = app_current_org() and id = ${input.breachId} for update`);
      if (!b) throw new PrivacyError('breach_not_found');
      if (b.closed) throw new PrivacyError('breach_closed');
      await tx.execute(sql`
        update consent_breach set ${column} = coalesce(${input.at}::timestamptz, now())
        where org_id = app_current_org() and id = ${input.breachId}`);
      return {
        result: undefined,
        audit: {
          action: 'platform.privacy.breach_step',
          entityType: 'consent_breach',
          entityId: input.breachId,
          dataClass: 'operational',
          detail: { step: input.step },
        },
      };
    },
  );
}
