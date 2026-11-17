// Incidents and personal-data breaches: opened with what happened and when it was discovered,
// clocks from discovery, each step recorded with who and when, and each affected school's own
// audit log told. Nothing is ever deleted.
import type { Db } from '@campusverse/db';
import { sql } from 'drizzle-orm';
import { incidentClocks, type Clock } from '../domain/incident.js';
import { adminAudit, assertStaffCan, ControlError, inCustomer, type Staff } from './common.js';

export type IncidentStep = 'certin_reported' | 'board_notified' | 'schools_notified';

export type IncidentRow = {
  id: string;
  title: string;
  details: string;
  discoveredAt: string;
  personalData: boolean;
  openedBy: string;
  customers: { orgId: string; name: string }[];
  closedAt: string | null;
  closingNote: string | null;
  clocks: { certin: Clock; board: Clock | null; schools: Clock | null };
};

export async function openIncident(
  db: Db,
  staff: Staff,
  input: {
    title: string;
    details: string;
    discoveredAt: string;
    personalData: boolean;
    orgIds: string[];
  },
): Promise<{ incidentId: string }> {
  assertStaffCan(staff, 'incidents.manage');
  const incidentId = await db.transaction(async (tx) => {
    const [i] = await tx.execute<{ id: string }>(sql`
      insert into control.incident (title, details, discovered_at, personal_data, opened_by)
      values (${input.title.trim()}, ${input.details.trim()}, ${input.discoveredAt}::timestamptz,
        ${input.personalData}, ${staff.staffId})
      returning id::text`);
    if (!i) throw new ControlError('incident_not_saved');
    for (const orgId of input.orgIds)
      await tx.execute(sql`
        insert into control.incident_customer (incident_id, org_id) values (${i.id}, ${orgId})`);
    await adminAudit(tx, staff, {
      action: 'incident.opened',
      detail: {
        incidentId: i.id,
        personalData: input.personalData,
        customers: input.orgIds.length,
      },
    });
    return i.id;
  });
  // Each affected school's own log shows that Campusverse recorded an incident affecting it.
  for (const orgId of input.orgIds)
    await inCustomer(
      db,
      staff,
      orgId,
      { action: 'incident.recorded', entityType: 'incident', detail: { incidentId } },
      async () => undefined,
    );
  return { incidentId };
}

const COLUMN: Record<IncidentStep | 'closed', { at: string; by: string }> = {
  certin_reported: { at: 'certin_reported_at', by: 'certin_reported_by' },
  board_notified: { at: 'board_notified_at', by: 'board_notified_by' },
  schools_notified: { at: 'schools_notified_at', by: 'schools_notified_by' },
  closed: { at: 'closed_at', by: 'closed_by' },
};

/** Records that a step was done (once), or closes the incident with a note. */
export async function recordIncidentStep(
  db: Db,
  staff: Staff,
  input: { incidentId: string; step: IncidentStep | 'closed'; note?: string | undefined },
): Promise<void> {
  assertStaffCan(staff, 'incidents.manage');
  if (input.step === 'closed' && !input.note?.trim()) throw new ControlError('note_required');
  const c = COLUMN[input.step];
  await db.transaction(async (tx) => {
    const [done] = await tx.execute<{ id: string }>(sql`
      update control.incident set ${sql.identifier(c.at)} = now(), ${sql.identifier(c.by)} = ${staff.staffId}
        ${input.step === 'closed' ? sql`, closing_note = ${input.note?.trim() ?? ''}` : sql``}
      where id = ${input.incidentId} and ${sql.identifier(c.at)} is null and closed_at is null
      returning id::text`);
    if (!done) throw new ControlError('incident_step_done');
    await adminAudit(tx, staff, {
      action: `incident.${input.step}`,
      ...(input.note ? { reason: input.note } : {}),
      detail: { incidentId: input.incidentId },
    });
  });
}

export async function listIncidents(
  db: Db,
  staff: Staff,
  now = new Date(),
): Promise<IncidentRow[]> {
  assertStaffCan(staff, 'customers.read');
  const rows = await db.execute<
    Omit<IncidentRow, 'clocks'> & {
      certinReportedAt: string | null;
      boardNotifiedAt: string | null;
      schoolsNotifiedAt: string | null;
    }
  >(sql`
    select i.id::text, i.title, i.details, i.discovered_at as "discoveredAt", i.personal_data as "personalData",
      s.name as "openedBy", i.closed_at as "closedAt", i.closing_note as "closingNote",
      i.certin_reported_at as "certinReportedAt", i.board_notified_at as "boardNotifiedAt",
      i.schools_notified_at as "schoolsNotifiedAt",
      coalesce((select json_agg(json_build_object('orgId', c.org_id, 'name', c.name) order by c.name)
        from control.incident_customer ic join control.customer c on c.org_id = ic.org_id
        where ic.incident_id = i.id), '[]') as customers
    from control.incident i join control.staff s on s.id = i.opened_by
    order by i.closed_at is null desc, i.discovered_at desc limit 100`);
  const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
  return rows.map(({ certinReportedAt, boardNotifiedAt, schoolsNotifiedAt, ...r }) => ({
    ...r,
    discoveredAt: iso(r.discoveredAt) ?? '',
    closedAt: iso(r.closedAt),
    clocks: incidentClocks(
      {
        discoveredAt: iso(r.discoveredAt) ?? '',
        personalData: r.personalData,
        certinReportedAt: iso(certinReportedAt),
        boardNotifiedAt: iso(boardNotifiedAt),
        schoolsNotifiedAt: iso(schoolsNotifiedAt),
      },
      now,
    ),
  }));
}
