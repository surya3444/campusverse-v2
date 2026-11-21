// Health Connect › Emergency (rule book §13.9 SOS & Protocols, §16.5 steps 3–6). Any staff member
// raises an SOS in one tap. When a student is named, the responder sees blood group, allergies
// and responder notes through a recorded break-glass; leaders and the nurse are alerted, the
// family is told that the school is responding (never a health detail), and the partner hospitals
// are listed in the order the school set. Leaders close the incident with a sealed report.
import { open, seal } from '@campusverse/crypto';
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  BREAK_GLASS_MINUTES,
  emergencyView,
  sosReason,
  type IncidentKind,
  type IncidentOutcome,
  type PartnerKind,
} from '../domain/health.js';
import {
  HEALTH_BREAK_GLASS_OPENED,
  HealthError,
  readVault,
  studentAt,
  type EmergencyView,
  type HealthDeps,
} from './health.js';

export const HEALTH_SOS_RAISED = 'health.sos.raised.v1';
export const HEALTH_INCIDENT_CLOSED = 'health.incident.closed.v1';

export class EmergencyError extends Error {
  constructor(readonly code: 'incident_not_found' | 'incident_closed' | 'partner_not_found') {
    super(`health emergency: ${code}`);
    this.name = 'EmergencyError';
  }
}

const reportCtx = (orgId: string, id: string) => `health-incident:${orgId}:${id}`;

async function placeRes(tx: Tx, actor: Actor, institutionId: string): Promise<Resource> {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new HealthError('institution_not_found');
  return { orgId: actor.orgId, place: p };
}

export type Partner = {
  id: string;
  name: string;
  kind: PartnerKind;
  phone: string;
  address: string | null;
  active: boolean;
};

async function activePartners(tx: Tx, institutionId: string, all = false): Promise<Partner[]> {
  return tx.execute<Partner>(sql`
    select id::text, name, kind, phone, address, active from health_partner
    where org_id = app_current_org() and institution_id = ${institutionId} and (active or ${all})
    order by active desc, sort, name`);
}

export type SosResult = {
  incidentId: string;
  /** The life-saving card, when a student with a health record was named. */
  emergency: EmergencyView | null;
  partners: Partner[];
};

/** One tap from any staff member. Naming the student is optional; the place is required. */
export async function raiseSos(
  deps: HealthDeps,
  actor: Actor,
  input: {
    institutionId: string;
    studentId?: string | undefined;
    kind: IncidentKind;
    location: string;
  },
): Promise<SosResult> {
  const resource: Resource = await withTenant(deps.db, actor.orgId, async (tx) =>
    input.studentId
      ? await studentAt(tx, actor, {
          institutionId: input.institutionId,
          studentId: input.studentId,
        })
      : await placeRes(tx, actor, input.institutionId),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.emergency.raise', resource },
    async (tx) => {
      const location = input.location.trim();
      let emergency: EmergencyView | null = null;
      let breakGlassId: string | null = null;
      const events: { type: string; payload: Record<string, unknown> }[] = [];
      if (input.studentId) {
        const current = await readVault(deps, tx, actor, input.studentId);
        if (current) {
          const [bg] = await tx.execute<{ id: string; expiresAt: string }>(sql`
            insert into health_break_glass (org_id, student_person_id, opened_by_person_id, reason, expires_at)
            values (app_current_org(), ${input.studentId}, ${actor.personId}, ${sosReason(input.kind, location)},
              now() + make_interval(mins => ${BREAK_GLASS_MINUTES}))
            returning id::text, expires_at::text as "expiresAt"`);
          if (!bg) throw new Error('raiseSos: break-glass insert returned no row');
          breakGlassId = bg.id;
          const names = await displayNames(tx, [input.studentId]);
          emergency = {
            ...emergencyView(current.vault),
            name: names[input.studentId] ?? '',
            expiresAt: bg.expiresAt,
          };
          events.push({
            type: HEALTH_BREAK_GLASS_OPENED,
            payload: {
              breakGlassId: bg.id,
              studentId: input.studentId,
              openedBy: actor.personId,
              institutionId: input.institutionId,
            },
          });
        }
      }
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into health_incident (org_id, institution_id, student_person_id, kind, location,
          raised_by_person_id, break_glass_id)
        values (app_current_org(), ${input.institutionId}, ${input.studentId ?? null}, ${input.kind},
          ${location}, ${actor.personId}, ${breakGlassId})
        returning id::text`);
      if (!row) throw new Error('raiseSos: insert returned no row');
      events.push({
        type: HEALTH_SOS_RAISED,
        payload: {
          incidentId: row.id,
          institutionId: input.institutionId,
          studentId: input.studentId ?? null,
          raisedBy: actor.personId,
        },
      });
      return {
        result: {
          incidentId: row.id,
          emergency,
          partners: await activePartners(tx, input.institutionId),
        },
        audit: {
          action: 'health.emergency.raise',
          entityType: 'health_incident',
          entityId: row.id,
          dataClass: 'sensitive',
          detail: { kind: input.kind, studentId: input.studentId ?? null, breakGlassId },
        },
        events,
      };
    },
  );
}

/** The partner list a responder calls from; anyone who may raise an SOS may read it. */
export async function emergencyPartners(
  deps: HealthDeps,
  actor: Actor,
  institutionId: string,
): Promise<Partner[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const res = await placeRes(tx, actor, institutionId);
    const manager = (await deps.permissions.can(tx, actor, 'health.emergency.manage', res)).allowed;
    if (!manager) await deps.permissions.assertCan(tx, actor, 'health.emergency.raise', res);
    return activePartners(tx, institutionId, manager);
  });
}

export async function savePartner(
  deps: HealthDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id?: string | undefined;
    name: string;
    kind: PartnerKind;
    phone: string;
    address: string | null;
    sort: number;
    active: boolean;
  },
): Promise<{ id: string }> {
  const resource = await withTenant(deps.db, actor.orgId, (tx) =>
    placeRes(tx, actor, input.institutionId),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.emergency.manage', resource },
    async (tx) => {
      const [row] = input.id
        ? await tx.execute<{ id: string }>(sql`
            update health_partner set name = btrim(${input.name}), kind = ${input.kind},
              phone = btrim(${input.phone}), address = ${input.address}, sort = ${input.sort}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} and institution_id = ${input.institutionId}
            returning id::text`)
        : await tx.execute<{ id: string }>(sql`
            insert into health_partner (org_id, institution_id, name, kind, phone, address, sort, active)
            values (app_current_org(), ${input.institutionId}, btrim(${input.name}), ${input.kind},
              btrim(${input.phone}), ${input.address}, ${input.sort}, ${input.active})
            returning id::text`);
      if (!row) throw new EmergencyError('partner_not_found');
      return {
        result: row,
        audit: {
          action: input.id ? 'health.partner.update' : 'health.partner.create',
          entityType: 'health_partner',
          entityId: row.id,
          dataClass: 'operational',
        },
      };
    },
  );
}

export type IncidentRow = {
  id: string;
  kind: IncidentKind;
  location: string;
  raisedAt: string;
  raisedBy: string;
  student: string | null;
  closedAt: string | null;
  outcome: IncidentOutcome | null;
};

/** Open incidents first, then the last 30 days. No report text in the list. */
export async function incidents(
  deps: HealthDeps,
  actor: Actor,
  institutionId: string,
): Promise<IncidentRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(
      tx,
      actor,
      'health.emergency.manage',
      await placeRes(tx, actor, institutionId),
    );
    const rows = await tx.execute<
      Omit<IncidentRow, 'raisedBy' | 'student'> & { raisedById: string; studentId: string | null }
    >(sql`
      select id::text, kind, location, raised_at::text as "raisedAt", closed_at::text as "closedAt", outcome,
        raised_by_person_id::text as "raisedById", student_person_id::text as "studentId"
      from health_incident
      where org_id = app_current_org() and institution_id = ${institutionId}
        and (closed_at is null or raised_at >= now() - interval '30 days')
      order by (closed_at is null) desc, raised_at desc limit 100`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => [r.raisedById, ...(r.studentId ? [r.studentId] : [])]),
    );
    return rows.map(({ raisedById, studentId, ...r }) => ({
      ...r,
      raisedBy: names[raisedById] ?? '',
      student: studentId ? (names[studentId] ?? '') : null,
    }));
  });
}

/** Closes an incident with what happened. The report is sealed with the health keys. */
export async function closeIncident(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; incidentId: string; outcome: IncidentOutcome; report: string },
): Promise<void> {
  const resource = await withTenant(deps.db, actor.orgId, (tx) =>
    placeRes(tx, actor, input.institutionId),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'health.emergency.manage', resource },
    async (tx) => {
      const [i] = await tx.execute<{ closed: boolean; studentId: string | null }>(sql`
        select closed_at is not null as closed, student_person_id::text as "studentId" from health_incident
        where org_id = app_current_org() and id = ${input.incidentId} and institution_id = ${input.institutionId}
        for update`);
      if (!i) throw new EmergencyError('incident_not_found');
      if (i.closed) throw new EmergencyError('incident_closed');
      const report = seal(
        deps.keys,
        input.report.trim().slice(0, 4000),
        reportCtx(actor.orgId, input.incidentId),
      );
      await tx.execute(sql`
        update health_incident set closed_at = now(), closed_by_person_id = ${actor.personId},
          outcome = ${input.outcome}, report = ${report}
        where org_id = app_current_org() and id = ${input.incidentId}`);
      return {
        result: undefined,
        audit: {
          action: 'health.emergency.close',
          entityType: 'health_incident',
          entityId: input.incidentId,
          dataClass: 'sensitive',
          detail: { outcome: input.outcome },
        },
        // The outcome only ("sent_home"), never the report: attendance may mark medical leave.
        events: [
          {
            type: HEALTH_INCIDENT_CLOSED,
            payload: {
              incidentId: input.incidentId,
              institutionId: input.institutionId,
              studentId: i.studentId,
              outcome: input.outcome,
            },
          },
        ],
      };
    },
  );
}

/** A closed incident's report, for the people who manage emergencies. Every opening is audited. */
export async function incidentReport(
  deps: HealthDeps,
  actor: Actor,
  input: { institutionId: string; incidentId: string },
): Promise<{ report: string | null }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'health.emergency.manage',
      resource: await withTenant(deps.db, actor.orgId, (tx) =>
        placeRes(tx, actor, input.institutionId),
      ),
    },
    async (tx) => {
      const [i] = await tx.execute<{ report: Buffer | null }>(sql`
        select report from health_incident
        where org_id = app_current_org() and id = ${input.incidentId} and institution_id = ${input.institutionId}`);
      if (!i) throw new EmergencyError('incident_not_found');
      return {
        result: {
          report: i.report
            ? open(deps.keys, i.report, reportCtx(actor.orgId, input.incidentId))
            : null,
        },
        audit: {
          action: 'health.emergency.report_read',
          entityType: 'health_incident',
          entityId: input.incidentId,
          dataClass: 'sensitive',
        },
      };
    },
  );
}
