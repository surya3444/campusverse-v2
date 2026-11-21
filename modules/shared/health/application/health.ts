// Health Connect › Health Records, Medical Visits and Emergency (rule book §13.9, §16.5). The
// vault is sealed with the health keys. Named records are for the medical role; management sees
// totals; anyone else reaches a student's life-saving details only through break-glass, which is
// recorded, expires, and tells the Data Protection Officer. Names through people/records.
import { open, seal, type FieldKeys } from '@campusverse/crypto';
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, memberKind, studentIdsAt } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  BREAK_GLASS_MINUTES,
  EMPTY_VAULT,
  cleanVault,
  emergencyView,
  shownCount,
  vaultFlags,
  type Vault,
  type VisitNotes,
  type VisitOutcome,
} from '../domain/health.js';

type Permissions = ReturnType<typeof createPermissions>;
/** `keys` are the health vault's own keys, never the field keys. */
export type HealthDeps = { db: Db; permissions: Permissions; keys: FieldKeys };

export const HEALTH_RECORD_UPDATED = 'health.record.updated.v1';
/** Carries the outcome only ("sent_home"), never the reason: attendance may mark medical leave. */
export const HEALTH_VISIT_RECORDED = 'health.visit.recorded.v1';
export const HEALTH_BREAK_GLASS_OPENED = 'health.break_glass.opened.v1';

export class HealthError extends Error {
  constructor(readonly code: 'institution_not_found' | 'not_a_student' | 'no_record') {
    super(`health: ${code}`);
    this.name = 'HealthError';
  }
}

const recordCtx = (orgId: string, studentId: string) => `health:${orgId}:${studentId}`;
const visitCtx = (orgId: string, studentId: string) => `health-visit:${orgId}:${studentId}`;

/** The institution's place for the permission check, after checking the student belongs to it. */
export async function studentAt(
  tx: Tx,
  actor: Actor,
  input: { institutionId: string; studentId: string },
): Promise<Resource> {
  const place = await placeOf(tx, input.institutionId);
  if (!place) throw new HealthError('institution_not_found');
  const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  const kind = await memberKind(tx, {
    institutionId: input.institutionId,
    personId: input.studentId,
    onDate: d?.d ?? '',
  });
  if (kind !== 'student') throw new HealthError('not_a_student');
  return { orgId: actor.orgId, place, subjectPersonId: input.studentId };
}

export async function readVault(deps: HealthDeps, tx: Tx, actor: Actor, studentId: string) {
  const [row] = await tx.execute<{ vault: Buffer; updatedAt: string; version: number }>(sql`
    select vault, updated_at::text as "updatedAt", version from health_record
    where org_id = app_current_org() and student_person_id = ${studentId}`);
  if (!row) return null;
  return {
    vault: JSON.parse(open(deps.keys, row.vault, recordCtx(actor.orgId, studentId))) as Vault,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

// ---------------------------------------------------------------------------------------------
// The medical role
// ---------------------------------------------------------------------------------------------

export type HealthVisit = {
  id: string;
  visitedAt: string;
  outcome: VisitOutcome;
  parentTold: boolean;
  notes: VisitNotes;
  recordedBy: string | null;
};

export type HealthRecordView = {
  studentId: string;
  name: string;
  vault: Vault;
  recorded: boolean;
  updatedAt: string | null;
  visits: HealthVisit[];
};

/** A student's health record and recent visits, for the medical role. Every opening is audited. */
export async function healthRecord(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string },
): Promise<HealthRecordView> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const resource = await studentAt(tx, actor, input);
    await deps.permissions.assertCan(tx, actor, 'health.record.read', resource);
    const current = await readVault(deps, tx, actor, input.studentId);
    const visits = await tx.execute<{
      id: string;
      visitedAt: string;
      outcome: VisitOutcome;
      parentTold: boolean;
      notes: Buffer;
      by: string | null;
    }>(sql`
      select id::text, visited_at::text as "visitedAt", outcome, parent_told as "parentTold", notes,
        recorded_by_person_id::text as by
      from health_visit where org_id = app_current_org() and student_person_id = ${input.studentId}
      order by visited_at desc limit 20`);
    const names = await displayNames(tx, [
      input.studentId,
      ...visits.flatMap((v) => (v.by ? [v.by] : [])),
    ]);
    await writeAudit(tx, actor, {
      action: 'health.record.read',
      entityType: 'health_record',
      entityId: input.studentId,
      dataClass: 'sensitive',
    });
    return {
      studentId: input.studentId,
      name: names[input.studentId] ?? '',
      vault: current?.vault ?? EMPTY_VAULT,
      recorded: !!current,
      updatedAt: current?.updatedAt ?? null,
      visits: visits.map((v) => ({
        id: v.id,
        visitedAt: v.visitedAt,
        outcome: v.outcome,
        parentTold: v.parentTold,
        notes: JSON.parse(open(deps.keys, v.notes, visitCtx(actor.orgId, input.studentId))),
        recordedBy: v.by ? (names[v.by] ?? null) : null,
      })),
    };
  });
}

export async function saveHealthRecord(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string; vault: Vault },
): Promise<void> {
  const resource = await withTenant(deps.db, actor.orgId, (tx) => studentAt(tx, actor, input));
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.record.update', resource },
    async (tx) => {
      const vault = cleanVault(input.vault);
      const f = vaultFlags(vault);
      const sealed = seal(
        deps.keys,
        JSON.stringify(vault),
        recordCtx(actor.orgId, input.studentId),
      );
      await tx.execute(sql`
        insert into health_record (org_id, student_person_id, vault, has_allergies, has_conditions,
          blood_group_known, updated_by_account_id)
        values (app_current_org(), ${input.studentId}, ${sealed}, ${f.hasAllergies},
          ${f.hasConditions}, ${f.bloodGroupKnown}, ${actor.accountId})
        on conflict (org_id, student_person_id) do update set vault = excluded.vault,
          has_allergies = excluded.has_allergies, has_conditions = excluded.has_conditions,
          blood_group_known = excluded.blood_group_known, version = health_record.version + 1,
          updated_at = now(), updated_by_account_id = excluded.updated_by_account_id`);
      return {
        result: undefined,
        audit: {
          action: 'health.record.update',
          entityType: 'health_record',
          entityId: input.studentId,
          dataClass: 'sensitive',
        },
        events: [{ type: HEALTH_RECORD_UPDATED, payload: { studentId: input.studentId } }],
      };
    },
  );
}

export async function recordVisit(
  deps: HealthDeps,
  actor: Actor,
  input: {
    institutionId: string;
    studentId: string;
    notes: VisitNotes;
    outcome: VisitOutcome;
    parentTold: boolean;
  },
): Promise<{ id: string }> {
  const resource = await withTenant(deps.db, actor.orgId, (tx) => studentAt(tx, actor, input));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.visit.record', resource },
    async (tx) => {
      const notes = seal(
        deps.keys,
        JSON.stringify({
          complaint: input.notes.complaint.trim().slice(0, 1000),
          care: input.notes.care.trim().slice(0, 2000),
        }),
        visitCtx(actor.orgId, input.studentId),
      );
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into health_visit (org_id, institution_id, student_person_id, notes, outcome,
          parent_told, recorded_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.studentId}, ${notes},
          ${input.outcome}, ${input.parentTold}, ${actor.personId})
        returning id::text`);
      if (!row) throw new Error('recordVisit: insert returned no row');
      return {
        result: row,
        audit: {
          action: 'health.visit.record',
          entityType: 'health_visit',
          entityId: row.id,
          dataClass: 'sensitive',
          detail: { studentId: input.studentId, outcome: input.outcome },
        },
        events: [
          {
            type: HEALTH_VISIT_RECORDED,
            payload: {
              visitId: row.id,
              studentId: input.studentId,
              institutionId: input.institutionId,
              outcome: input.outcome,
            },
          },
        ],
      };
    },
  );
}

export type VisitRow = {
  id: string;
  studentId: string;
  name: string;
  visitedAt: string;
  outcome: VisitOutcome;
  parentTold: boolean;
};

/** Today's sick-room visits at a school, for the medical role. No notes in the list. */
export async function visitsToday(
  deps: HealthDeps,
  actor: Actor,
  institutionId: string,
): Promise<VisitRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, institutionId);
    if (!place) throw new HealthError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'health.visit.record', {
      orgId: actor.orgId,
      place,
    });
    const rows = await tx.execute<Omit<VisitRow, 'name'>>(sql`
      select id::text, student_person_id::text as "studentId", visited_at::text as "visitedAt",
        outcome, parent_told as "parentTold"
      from health_visit
      where org_id = app_current_org() and institution_id = ${institutionId}
        and (visited_at at time zone 'Asia/Kolkata')::date = app_today()
      order by visited_at desc`);
    const names = await displayNames(
      tx,
      rows.map((r) => r.studentId),
    );
    return rows.map((r) => ({ ...r, name: names[r.studentId] ?? '' }));
  });
}

// ---------------------------------------------------------------------------------------------
// Management: totals only
// ---------------------------------------------------------------------------------------------

export type HealthTotals = {
  /** Null means "fewer than 5", so no small group can be picked out. */
  records: number | null;
  allergies: number | null;
  conditions: number | null;
  bloodGroupKnown: number | null;
  visitsToday: number | null;
  sentHomeToday: number | null;
  visitsThisMonth: number | null;
  breakGlassThisMonth: number;
};

/** Totals for a school: never a name (rule book §13.9 Health Reports). */
export async function healthTotals(
  deps: HealthDeps,
  actor: Actor,
  institutionId: string,
): Promise<HealthTotals> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = await placeOf(tx, institutionId);
    if (!place) throw new HealthError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'health.report.read', {
      orgId: actor.orgId,
      place,
    });
    const ids = `{${(await studentIdsAt(tx, institutionId)).join(',')}}`;
    const [r] = await tx.execute<{
      records: number;
      allergies: number;
      conditions: number;
      bloodGroupKnown: number;
      visitsToday: number;
      sentHomeToday: number;
      visitsThisMonth: number;
      breakGlass: number;
    }>(sql`
      with h as (
        select * from health_record
        where org_id = app_current_org() and student_person_id = any(${ids}::uuid[])
      ),
      v as (
        select * from health_visit
        where org_id = app_current_org() and institution_id = ${institutionId}
          and visited_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
      )
      select
        (select count(*)::int from h) as records,
        (select count(*)::int from h where has_allergies) as allergies,
        (select count(*)::int from h where has_conditions) as conditions,
        (select count(*)::int from h where blood_group_known) as "bloodGroupKnown",
        (select count(*)::int from v where (visited_at at time zone 'Asia/Kolkata')::date = app_today())
          as "visitsToday",
        (select count(*)::int from v where outcome = 'sent_home'
          and (visited_at at time zone 'Asia/Kolkata')::date = app_today()) as "sentHomeToday",
        (select count(*)::int from v) as "visitsThisMonth",
        (select count(*)::int from health_break_glass b where b.org_id = app_current_org()
          and b.student_person_id = any(${ids}::uuid[]) and b.opened_at >= now() - interval '30 days')
          as "breakGlass"`);
    return {
      records: shownCount(r?.records ?? 0),
      allergies: shownCount(r?.allergies ?? 0),
      conditions: shownCount(r?.conditions ?? 0),
      bloodGroupKnown: shownCount(r?.bloodGroupKnown ?? 0),
      visitsToday: shownCount(r?.visitsToday ?? 0),
      sentHomeToday: shownCount(r?.sentHomeToday ?? 0),
      visitsThisMonth: shownCount(r?.visitsThisMonth ?? 0),
      // How often the glass was broken is a governance figure, shown exactly.
      breakGlassThisMonth: r?.breakGlass ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Emergency: break-glass
// ---------------------------------------------------------------------------------------------

export type EmergencyView = ReturnType<typeof emergencyView> & {
  name: string;
  expiresAt: string;
};

/**
 * Opens a student's life-saving details for someone outside the medical role: a reason of at
 * least 10 characters, an expiry of an hour, recorded for ever, and the Data Protection Officer
 * told through the event. Shows blood group, allergies and responder notes only.
 */
export async function openBreakGlass(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string; reason: string },
): Promise<EmergencyView> {
  const resource = await withTenant(deps.db, actor.orgId, (tx) => studentAt(tx, actor, input));
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.emergency.open', resource },
    async (tx) => {
      const current = await readVault(deps, tx, actor, input.studentId);
      if (!current) throw new HealthError('no_record');
      const [row] = await tx.execute<{ id: string; expiresAt: string }>(sql`
        insert into health_break_glass (org_id, student_person_id, opened_by_person_id, reason, expires_at)
        values (app_current_org(), ${input.studentId}, ${actor.personId}, ${input.reason.trim()},
          now() + make_interval(mins => ${BREAK_GLASS_MINUTES}))
        returning id::text, expires_at::text as "expiresAt"`);
      if (!row) throw new Error('openBreakGlass: insert returned no row');
      const names = await displayNames(tx, [input.studentId]);
      return {
        result: {
          ...emergencyView(current.vault),
          name: names[input.studentId] ?? '',
          expiresAt: row.expiresAt,
        },
        audit: {
          action: 'health.emergency.open',
          entityType: 'health_record',
          entityId: input.studentId,
          dataClass: 'sensitive',
          reason: input.reason.trim(),
          detail: { breakGlassId: row.id },
        },
        events: [
          {
            type: HEALTH_BREAK_GLASS_OPENED,
            payload: {
              breakGlassId: row.id,
              studentId: input.studentId,
              openedBy: actor.personId,
              institutionId: input.institutionId,
            },
          },
        ],
      };
    },
  );
}
