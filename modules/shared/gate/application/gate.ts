// Visitors and gate (docs/specs/VISITORS_GATE.md): visitors known by phone, check in and out,
// barred visitors, expected visits, and early-leave gate passes checked against the child's
// guardians (restricted ones never). People come from people/records; a student's class from
// AcademicPlacementPort. Never reads academic tables.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  displayNames,
  memberKind,
  pickupGuardians,
  searchMembers,
  type AcademicPlacementPort,
} from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
  type Resource,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { collectorCheck, type Collector } from '../domain/gate.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements' | 'findByReference'>[];
export type GateDeps = { db: Db; permissions: Permissions; placements: Placements };

export const VISIT_CHECKED_IN = 'gate.visit.checked_in.v1';
export const PASS_LEFT = 'gate.pass.left.v1';

export const PURPOSES = [
  'parent_meeting',
  'staff_meeting',
  'admission_enquiry',
  'delivery',
  'vendor',
  'interview',
  'official',
  'other',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export class GateError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'visitor_barred'
      | 'host_not_staff'
      | 'visit_not_found'
      | 'not_expected'
      | 'not_inside'
      | 'past_date'
      | 'already_barred'
      | 'not_barred'
      | 'not_a_student'
      | 'collector_restricted'
      | 'collector_not_guardian'
      | 'pass_not_found'
      | 'pass_not_valid',
    readonly details?: Record<string, unknown>,
  ) {
    super(`gate: ${code}`);
    this.name = 'GateError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new GateError('institution_not_found');
  return p;
}
const where = (deps: GateDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, (tx) => place(tx, institutionId));
const res = (actor: Actor, p: Resource['place']): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
});
/** The school day's bounds, as times (India). */
const dayStart = (on: string) => sql`(${on}::date)::timestamp at time zone 'Asia/Kolkata'`;
const dayEnd = (on: string) => sql`(${on}::date + 1)::timestamp at time zone 'Asia/Kolkata'`;

/** Passes when the actor holds any of the permissions at the institution. */
async function assertAny(
  deps: GateDeps,
  tx: Tx,
  actor: Actor,
  permissions: string[],
  institutionId: string,
) {
  const r = res(actor, await place(tx, institutionId));
  let reason: Exclude<Awaited<ReturnType<Permissions['can']>>, { allowed: true }>['reason'] =
    'no_grant';
  for (const p of permissions) {
    const d = await deps.permissions.can(tx, actor, p, r);
    if (d.allowed) return;
    reason = d.reason;
  }
  throw new PermissionDenied(permissions[0] ?? '', reason);
}

async function reading<T>(
  deps: GateDeps,
  actor: Actor,
  institutionId: string,
  permissions: string[],
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await assertAny(deps, tx, actor, permissions, institutionId);
    return work(tx);
  });
}

async function upsertVisitor(tx: Tx, phone: string, name: string) {
  const [v] = await tx.execute<{ id: string; barredReason: string | null }>(sql`
    insert into gate_visitor (org_id, phone, name) values (app_current_org(), ${phone}, ${name.trim()})
    on conflict (org_id, phone) do update set name = excluded.name
    returning id::text, barred_reason as "barredReason"`);
  if (!v) throw new Error('gate: visitor not saved');
  return v;
}

// ---------------------------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------------------------

export type VisitRow = {
  visitId: string;
  visitorId: string;
  name: string;
  phone: string;
  purpose: Purpose;
  note: string;
  hostPersonId: string | null;
  host: string | null;
  partySize: number;
  vehicleNo: string;
  badgeNo: string;
  state: 'expected' | 'in' | 'out' | 'cancelled';
  expectedOn: string | null;
  expectedBy: string | null;
  inAt: string | null;
  outAt: string | null;
  barred: boolean;
};

async function visits(tx: Tx, filter: ReturnType<typeof sql>): Promise<VisitRow[]> {
  const rows = await tx.execute<
    Omit<VisitRow, 'host' | 'expectedBy'> & { expectedById: string | null }
  >(sql`
    select v.id::text as "visitId", g.id::text as "visitorId", g.name, g.phone, v.purpose, v.note,
      v.host_person_id::text as "hostPersonId", v.party_size as "partySize", v.vehicle_no as "vehicleNo",
      v.badge_no as "badgeNo", v.state, v.expected_on::text as "expectedOn",
      v.expected_by_person_id::text as "expectedById", v.in_at as "inAt", v.out_at as "outAt",
      g.barred_at is not null as barred
    from gate_visit v join gate_visitor g on g.org_id = v.org_id and g.id = v.visitor_id
    where v.org_id = app_current_org() and ${filter}
    order by coalesce(v.in_at, v.created_at) desc
    limit 500`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.hostPersonId, r.expectedById].filter((x): x is string => !!x)),
  );
  return rows.map(({ expectedById, ...r }) => ({
    ...r,
    inAt: r.inAt ? new Date(r.inAt).toISOString() : null,
    outAt: r.outAt ? new Date(r.outAt).toISOString() : null,
    host: r.hostPersonId ? (names[r.hostPersonId] ?? null) : null,
    expectedBy: expectedById ? (names[expectedById] ?? null) : null,
  }));
}

/** A visitor by phone: the name to fill in, whether they're barred, and their last visits here. */
export async function visitorByPhone(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; phone: string },
) {
  return reading(deps, actor, input.institutionId, ['gate.visitor.read'], async (tx) => {
    const [v] = await tx.execute<{ id: string; name: string; barredReason: string | null }>(sql`
      select id::text, name, barred_reason as "barredReason" from gate_visitor
      where org_id = app_current_org() and phone = ${input.phone}`);
    if (!v) return null;
    const last = await visits(
      tx,
      sql`v.visitor_id = ${v.id} and v.institution_id = ${input.institutionId} and v.in_at is not null`,
    );
    return { name: v.name, barredReason: v.barredReason, lastVisits: last.slice(0, 5) };
  });
}

export type CheckInInput = {
  institutionId: string;
  /** An expected visit being used; otherwise a walk-in. */
  visitId: string | null;
  phone: string;
  name: string;
  purpose: Purpose;
  note: string;
  hostPersonId: string | null;
  partySize: number;
  vehicleNo: string;
  badgeNo: string;
};

/** Checks a visitor in: a walk-in, or one expected today. Barred visitors are refused. */
export async function checkIn(
  deps: GateDeps,
  actor: Actor,
  input: CheckInInput,
): Promise<{ visitId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visitor.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const on = await today(tx);
      /** A host the gate picks must be staff here; the person who expected the visit stays its host. */
      const checkHost = async (keep: string | null) => {
        if (!input.hostPersonId || input.hostPersonId === keep) return;
        const kind = await memberKind(tx, {
          institutionId: input.institutionId,
          personId: input.hostPersonId,
          onDate: on,
        });
        if (kind !== 'staff') throw new GateError('host_not_staff');
      };
      let visitId: string;
      let phone = input.phone;
      if (input.visitId) {
        const [e] = await tx.execute<{
          state: string;
          expectedOn: string;
          phone: string;
          host: string | null;
        }>(sql`
          select v.state, v.expected_on::text as "expectedOn", g.phone, v.host_person_id::text as host
          from gate_visit v
          join gate_visitor g on g.org_id = v.org_id and g.id = v.visitor_id
          where v.org_id = app_current_org() and v.id = ${input.visitId}
            and v.institution_id = ${input.institutionId} for update of v`);
        if (!e) throw new GateError('visit_not_found');
        if (e.state !== 'expected' || e.expectedOn !== on) throw new GateError('not_expected');
        await checkHost(e.host);
        phone = e.phone;
        const v = await upsertVisitor(tx, phone, input.name);
        if (v.barredReason) throw new GateError('visitor_barred', { reason: v.barredReason });
        await tx.execute(sql`
          update gate_visit set state = 'in', in_at = now(), in_by_person_id = ${actor.personId},
            purpose = ${input.purpose}, note = ${input.note.trim()},
            host_person_id = coalesce(${input.hostPersonId}::uuid, host_person_id),
            party_size = ${input.partySize}, vehicle_no = ${input.vehicleNo.trim().toUpperCase()},
            badge_no = ${input.badgeNo.trim()}
          where org_id = app_current_org() and id = ${input.visitId}`);
        visitId = input.visitId;
      } else {
        await checkHost(null);
        const v = await upsertVisitor(tx, phone, input.name);
        if (v.barredReason) throw new GateError('visitor_barred', { reason: v.barredReason });
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into gate_visit (org_id, institution_id, visitor_id, purpose, note, host_person_id, party_size,
            vehicle_no, badge_no, state, in_at, in_by_person_id)
          values (app_current_org(), ${input.institutionId}, ${v.id}, ${input.purpose}, ${input.note.trim()},
            ${input.hostPersonId}, ${input.partySize}, ${input.vehicleNo.trim().toUpperCase()}, ${input.badgeNo.trim()},
            'in', now(), ${actor.personId})
          returning id::text`);
        visitId = row?.id ?? '';
      }
      return {
        result: { visitId },
        audit: {
          action: 'gate.visit.check_in',
          entityType: 'gate_visit',
          entityId: visitId,
          dataClass: 'personal',
          detail: {
            purpose: input.purpose,
            hostPersonId: input.hostPersonId,
            expected: !!input.visitId,
          },
        },
        events: [
          { type: VISIT_CHECKED_IN, payload: { visitId, institutionId: input.institutionId } },
        ],
      };
    },
  );
}

export async function checkOut(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; visitId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visitor.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const done = await tx.execute(sql`
        update gate_visit set state = 'out', out_at = greatest(now(), in_at), out_by_person_id = ${actor.personId}
        where org_id = app_current_org() and id = ${input.visitId} and institution_id = ${input.institutionId}
          and state = 'in'
        returning id`);
      if (done.length === 0) throw new GateError('not_inside');
      return {
        result: undefined,
        audit: {
          action: 'gate.visit.check_out',
          entityType: 'gate_visit',
          entityId: input.visitId,
          dataClass: 'personal',
          detail: {},
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Expected visits
// ---------------------------------------------------------------------------------------------

/** A staff member tells the gate whom they expect on a day; they are the host. */
export async function expectVisitor(
  deps: GateDeps,
  actor: Actor,
  input: {
    institutionId: string;
    phone: string;
    name: string;
    purpose: Purpose;
    note: string;
    partySize: number;
    expectedOn: string;
  },
): Promise<{ visitId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visit.expect',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      if (input.expectedOn < (await today(tx))) throw new GateError('past_date');
      const v = await upsertVisitor(tx, input.phone, input.name);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into gate_visit (org_id, institution_id, visitor_id, purpose, note, host_person_id, party_size, state,
          expected_on, expected_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${v.id}, ${input.purpose}, ${input.note.trim()},
          ${actor.personId}, ${input.partySize}, 'expected', ${input.expectedOn}::date, ${actor.personId})
        returning id::text`);
      const visitId = row?.id ?? '';
      return {
        result: { visitId },
        audit: {
          action: 'gate.visit.expect',
          entityType: 'gate_visit',
          entityId: visitId,
          dataClass: 'personal',
          detail: { expectedOn: input.expectedOn, purpose: input.purpose },
        },
      };
    },
  );
}

/** The visits this person expects, from today on, and today's that already happened. */
export async function myExpected(deps: GateDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, ['gate.visit.expect'], async (tx) => {
    const on = await today(tx);
    const rows = await visits(
      tx,
      sql`v.institution_id = ${institutionId} and v.expected_by_person_id = ${actor.personId}
        and v.expected_on >= ${on}::date`,
    );
    // Phones stay at the gate; the host knows their own visitor.
    return rows
      .map((r) => ({ ...r, phone: '' }))
      .sort((a, b) => (a.expectedOn ?? '').localeCompare(b.expectedOn ?? ''));
  });
}

/** Cancels an expected visit: the person who expects it, or the gate. */
export async function cancelExpected(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; visitId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visit.expect',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [v] = await tx.execute<{ state: string; by: string }>(sql`
        select state, expected_by_person_id::text as by from gate_visit
        where org_id = app_current_org() and id = ${input.visitId} and institution_id = ${input.institutionId}
        for update`);
      if (!v) throw new GateError('visit_not_found');
      if (v.state !== 'expected') throw new GateError('not_expected');
      if (v.by !== actor.personId)
        await assertAny(deps, tx, actor, ['gate.visitor.manage'], input.institutionId);
      await tx.execute(sql`
        update gate_visit set state = 'cancelled' where org_id = app_current_org() and id = ${input.visitId}`);
      return {
        result: undefined,
        audit: {
          action: 'gate.visit.cancel',
          entityType: 'gate_visit',
          entityId: input.visitId,
          dataClass: 'personal',
          detail: {},
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Barred visitors (organisation-wide; checked at the institution the person works in)
// ---------------------------------------------------------------------------------------------

export async function barVisitor(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; phone: string; name: string; reason: string },
): Promise<{ visitorId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visitor.bar',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [existing] = await tx.execute<{ id: string; name: string; barred: boolean }>(sql`
        select id::text, name, barred_at is not null as barred from gate_visitor
        where org_id = app_current_org() and phone = ${input.phone} for update`);
      if (existing?.barred) throw new GateError('already_barred');
      const v = existing ?? (await upsertVisitor(tx, input.phone, input.name));
      await tx.execute(sql`
        update gate_visitor set barred_at = now(), barred_reason = ${input.reason.trim()},
          barred_by_person_id = ${actor.personId}
        where org_id = app_current_org() and id = ${v.id}`);
      return {
        result: { visitorId: v.id },
        audit: {
          action: 'gate.visitor.bar',
          entityType: 'gate_visitor',
          entityId: v.id,
          dataClass: 'personal',
          detail: { reason: input.reason.trim() },
        },
      };
    },
  );
}

export async function liftBar(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; visitorId: string; reason: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visitor.bar',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const done = await tx.execute<{ was: string }>(sql`
        update gate_visitor g set barred_at = null, barred_reason = null, barred_by_person_id = null
        from gate_visitor old
        where g.org_id = app_current_org() and g.id = ${input.visitorId} and g.barred_at is not null
          and old.org_id = g.org_id and old.id = g.id
        returning old.barred_reason as was`);
      if (done.length === 0) throw new GateError('not_barred');
      return {
        result: undefined,
        audit: {
          action: 'gate.visitor.lift_bar',
          entityType: 'gate_visitor',
          entityId: input.visitorId,
          dataClass: 'personal',
          detail: { reason: input.reason.trim(), barredFor: done[0]?.was ?? null },
        },
      };
    },
  );
}

export type BarredRow = {
  visitorId: string;
  name: string;
  phone: string;
  reason: string;
  barredAt: string;
  barredBy: string | null;
};

export async function barredVisitors(
  deps: GateDeps,
  actor: Actor,
  institutionId: string,
): Promise<BarredRow[]> {
  return reading(deps, actor, institutionId, ['gate.visitor.read'], async (tx) => {
    const rows = await tx.execute<Omit<BarredRow, 'barredBy'> & { byId: string }>(sql`
      select id::text as "visitorId", name, phone, barred_reason as reason, barred_at as "barredAt",
        barred_by_person_id::text as "byId"
      from gate_visitor where org_id = app_current_org() and barred_at is not null
      order by barred_at desc`);
    const names = await displayNames(
      tx,
      rows.map((r) => r.byId),
    );
    return rows.map(({ byId, ...r }) => ({
      ...r,
      barredAt: new Date(r.barredAt).toISOString(),
      barredBy: names[byId] ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------------------------
// Gate passes
// ---------------------------------------------------------------------------------------------

export type PassRow = {
  passId: string;
  studentId: string;
  student: string;
  label: string | null;
  collector: string;
  relation: string;
  phone: string | null;
  guardian: boolean;
  reason: string;
  state: 'issued' | 'left' | 'cancelled';
  issuedOn: string;
  issuedAt: string;
  issuedBy: string | null;
  leftAt: string | null;
};

async function labels(tx: Tx, deps: GateDeps, personIds: string[], on: string) {
  const found = await Promise.all(
    deps.placements.map((p) => p.getPlacements(tx, { personIds, onDate: on })),
  );
  return (id: string) => found.map((m) => m.get(id)).find((x) => x !== undefined);
}

async function passes(tx: Tx, deps: GateDeps, institutionId: string, on: string) {
  const rows = await tx.execute<
    Omit<PassRow, 'student' | 'label' | 'issuedBy'> & { byId: string }
  >(sql`
    select id::text as "passId", student_person_id::text as "studentId", collector_name as collector,
      collector_relation as relation, collector_phone as phone, collector_guardian_id is not null as guardian,
      reason, state, issued_on::text as "issuedOn", issued_at as "issuedAt", issued_by_person_id::text as "byId",
      left_at as "leftAt"
    from gate_pass
    where org_id = app_current_org() and institution_id = ${institutionId} and issued_on = ${on}::date
    order by issued_at desc`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.studentId, r.byId]),
  );
  const placed = await labels(
    tx,
    deps,
    rows.map((r) => r.studentId),
    on,
  );
  return rows.map(({ byId, ...r }): PassRow => ({
    ...r,
    student: names[r.studentId] ?? '',
    label: placed(r.studentId)?.displayLabel ?? null,
    issuedAt: new Date(r.issuedAt).toISOString(),
    issuedBy: names[byId] ?? null,
    leftAt: r.leftAt ? new Date(r.leftAt).toISOString() : null,
  }));
}

/** Who may collect the child: unrestricted guardians only; restricted ones are never offered. */
export async function pickupOptions(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; studentId: string },
) {
  return reading(deps, actor, input.institutionId, ['gate.pass.issue'], async (tx) =>
    (await pickupGuardians(tx, input.studentId))
      .filter((g) => !g.restricted)
      .map((g) => ({
        personId: g.personId,
        name: g.name,
        relationship: g.relationship,
        canPickup: g.canPickup,
      })),
  );
}

export type PassInput = {
  institutionId: string;
  studentId: string;
  collector: Collector;
  reason: string;
};

/** The office lets a child leave early today, collected by a guardian or a named person. */
export async function issuePass(
  deps: GateDeps,
  actor: Actor,
  input: PassInput,
): Promise<{ passId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.pass.issue',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const on = await today(tx);
      const kind = await memberKind(tx, {
        institutionId: input.institutionId,
        personId: input.studentId,
        onDate: on,
      });
      if (kind !== 'student') throw new GateError('not_a_student');
      const guardians = await pickupGuardians(tx, input.studentId);
      const check = collectorCheck(guardians, input.collector);
      if (check !== 'ok') throw new GateError(check);
      const c = input.collector;
      const g = 'guardianId' in c ? guardians.find((x) => x.personId === c.guardianId) : undefined;
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into gate_pass (org_id, institution_id, student_person_id, collector_guardian_id, collector_name,
          collector_relation, collector_phone, reason, issued_on, issued_by_person_id)
        values (app_current_org(), ${input.institutionId}, ${input.studentId}, ${g?.personId ?? null},
          ${g ? g.name : 'name' in c ? c.name.trim() : ''}, ${g ? g.relationship : 'relation' in c ? c.relation.trim() : ''},
          ${g ? (g.phones[0] ?? null) : 'phone' in c ? c.phone : null}, ${input.reason.trim()}, ${on}::date, ${actor.personId})
        returning id::text`);
      const passId = row?.id ?? '';
      return {
        result: { passId },
        audit: {
          action: 'gate.pass.issue',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { passId, guardian: !!g, reason: input.reason.trim() },
        },
      };
    },
  );
}

/**
 * The guard lets the child out with the collector. Today's passes only, and the collector is
 * checked again: a guardian restricted since the pass was issued is refused.
 */
export async function passLeft(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; passId: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.visitor.manage',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const [p] = await tx.execute<{
        studentId: string;
        state: string;
        issuedOn: string;
        guardianId: string | null;
        name: string;
        relation: string;
        phone: string | null;
      }>(sql`
        select student_person_id::text as "studentId", state, issued_on::text as "issuedOn",
          collector_guardian_id::text as "guardianId", collector_name as name, collector_relation as relation,
          collector_phone as phone
        from gate_pass where org_id = app_current_org() and id = ${input.passId}
          and institution_id = ${input.institutionId} for update`);
      if (!p) throw new GateError('pass_not_found');
      if (p.state !== 'issued' || p.issuedOn !== (await today(tx)))
        throw new GateError('pass_not_valid', { state: p.state });
      const check = collectorCheck(
        await pickupGuardians(tx, p.studentId),
        p.guardianId
          ? { guardianId: p.guardianId }
          : { name: p.name, relation: p.relation, phone: p.phone ?? '' },
      );
      if (check !== 'ok') throw new GateError(check);
      await tx.execute(sql`
        update gate_pass set state = 'left', left_at = now(), left_by_person_id = ${actor.personId}
        where org_id = app_current_org() and id = ${input.passId}`);
      return {
        result: undefined,
        audit: {
          action: 'gate.pass.left',
          entityType: 'person',
          entityId: p.studentId,
          dataClass: 'personal',
          detail: { passId: input.passId },
        },
        events: [
          {
            type: PASS_LEFT,
            payload: { passId: input.passId, institutionId: input.institutionId },
          },
        ],
      };
    },
  );
}

export async function cancelPass(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; passId: string; reason: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'gate.pass.issue',
      resource: res(actor, await where(deps, actor, input.institutionId)),
    },
    async (tx) => {
      const done = await tx.execute<{ studentId: string }>(sql`
        update gate_pass set state = 'cancelled', cancel_reason = ${input.reason.trim()}
        where org_id = app_current_org() and id = ${input.passId} and institution_id = ${input.institutionId}
          and state = 'issued'
        returning student_person_id::text as "studentId"`);
      if (done.length === 0) throw new GateError('pass_not_valid');
      return {
        result: undefined,
        audit: {
          action: 'gate.pass.cancel',
          entityType: 'person',
          entityId: done[0]?.studentId ?? '',
          dataClass: 'personal',
          detail: { passId: input.passId, reason: input.reason.trim() },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// The gate's day, history and people search
// ---------------------------------------------------------------------------------------------

export type GateFigures = {
  insideNow: number;
  peopleInside: number;
  visitorsToday: number;
  expectedToday: number;
  passesToday: number;
};

async function figures(tx: Tx, institutionId: string, on: string): Promise<GateFigures> {
  const [f] = await tx.execute<GateFigures>(sql`
    select count(*) filter (where state = 'in')::int as "insideNow",
      coalesce(sum(party_size) filter (where state = 'in'), 0)::int as "peopleInside",
      count(*) filter (where in_at >= ${dayStart(on)} and in_at < ${dayEnd(on)})::int as "visitorsToday",
      count(*) filter (where state = 'expected' and expected_on = ${on}::date)::int as "expectedToday",
      (select count(*)::int from gate_pass where org_id = app_current_org() and institution_id = ${institutionId}
        and issued_on = ${on}::date and state <> 'cancelled') as "passesToday"
    from gate_visit where org_id = app_current_org() and institution_id = ${institutionId}
      and (state in ('in', 'expected') or in_at >= ${dayStart(on)})`);
  return f ?? { insideNow: 0, peopleInside: 0, visitorsToday: 0, expectedToday: 0, passesToday: 0 };
}

/** Everything the gate needs now: who is inside, who is expected, today's passes. */
export async function gateToday(deps: GateDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, ['gate.visitor.read'], async (tx) => {
    const on = await today(tx);
    return {
      today: on,
      figures: await figures(tx, institutionId, on),
      inside: (await visits(tx, sql`v.institution_id = ${institutionId} and v.state = 'in'`)).sort(
        (a, b) => (a.inAt ?? '').localeCompare(b.inAt ?? ''),
      ),
      expected: await visits(
        tx,
        sql`v.institution_id = ${institutionId} and v.state = 'expected' and v.expected_on = ${on}::date`,
      ),
      passes: await passes(tx, deps, institutionId, on),
    };
  });
}

export async function gateFigures(deps: GateDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, ['gate.visitor.read'], async (tx) =>
    figures(tx, institutionId, await today(tx)),
  );
}

/** Visits on a day (arrived, or expected for it), searchable by name, phone or vehicle. */
export async function visitHistory(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; on: string; search: string },
): Promise<{ visits: VisitRow[]; passes: PassRow[] }> {
  return reading(deps, actor, input.institutionId, ['gate.visitor.read'], async (tx) => {
    const q = `%${input.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return {
      visits: await visits(
        tx,
        sql`v.institution_id = ${input.institutionId}
          and ((v.in_at >= ${dayStart(input.on)} and v.in_at < ${dayEnd(input.on)})
            or (v.in_at is null and v.expected_on = ${input.on}::date))
          and (g.name ilike ${q} or g.phone like ${q} or v.vehicle_no ilike ${q})`,
      ),
      passes: input.search.trim() ? [] : await passes(tx, deps, input.institutionId, input.on),
    };
  });
}

/**
 * Staff to meet (for the gate and for expecting visitors) or students for a pass, by name,
 * admission number or employee code.
 */
export async function findPeople(
  deps: GateDeps,
  actor: Actor,
  input: { institutionId: string; text: string; kind: 'staff' | 'student' },
): Promise<{ personId: string; name: string; label: string | null }[]> {
  const permissions =
    input.kind === 'student' ? ['gate.pass.issue'] : ['gate.visitor.read', 'gate.visit.expect'];
  return reading(deps, actor, input.institutionId, permissions, async (tx) => {
    if (input.text.trim().length < 2) return [];
    const on = await today(tx);
    const byNumber =
      input.kind === 'student'
        ? (
            await Promise.all(
              deps.placements.map((p) =>
                p.findByReference(tx, { institutionId: input.institutionId, text: input.text }),
              ),
            )
          ).flat()
        : [];
    const members = (
      await searchMembers(tx, {
        institutionId: input.institutionId,
        text: input.text,
        onDate: on,
        ids: byNumber,
      })
    ).filter((m) => m.kind === input.kind);
    const placed = await labels(
      tx,
      deps,
      members.map((m) => m.personId),
      on,
    );
    return members.slice(0, 20).map((m) => ({
      personId: m.personId,
      name: m.name,
      label: m.kind === 'staff' ? m.employeeCode : (placed(m.personId)?.displayLabel ?? null),
    }));
  });
}
