// Staff leave (docs/specs/STAFF_LEAVE.md): organisation-wide types, requests with a balance
// check, approval that writes the school's register in the same transaction (so the cover
// screen sees the teacher away), cancel before it starts, adjustments, and a month's payroll
// inputs for the accountant. School holidays come through HolidaysPort; this module never
// reads academic tables.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, staffAt } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command, emit } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions, Resource } from '@campusverse/platform-permissions';
import {
  approvalStates,
  decideApproval,
  startApproval,
  withdrawApproval,
  type ApprovalState,
} from '@campusverse/platform-workflow';
import { sql } from 'drizzle-orm';
import type { DayStatus } from '../domain/day.js';
import {
  balanceOf,
  daysCounted,
  leaveYear,
  leaveYearRange,
  payrollRow,
  workingDates,
  type Balance,
  type LeaveUse,
  type PayrollRow,
} from '../domain/leave.js';

type Permissions = ReturnType<typeof createPermissions>;

/** The institution's holidays between two dates (inclusive), as YYYY-MM-DD. */
export type HolidaysPort = (
  tx: Tx,
  institutionId: string,
  from: string,
  to: string,
) => Promise<string[]>;

export const LEAVE_REQUESTED = 'staff.leave.requested.v1';
export const LEAVE_DECIDED = 'staff.leave.decided.v1';
export const LEAVE_CANCELLED = 'staff.leave.cancelled.v1';
/** Leave is decided through the shared approval engine (rule book §12.4 decision 6). */
const PROCESS = 'staff.leave';

export class LeaveError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'leave_type_not_found'
      | 'leave_request_not_found'
      | 'not_on_staff'
      | 'type_retired'
      | 'half_day_not_allowed'
      | 'no_working_days'
      | 'crosses_leave_year'
      | 'leave_overlaps'
      | 'over_balance'
      | 'own_leave'
      | 'not_pending'
      | 'leave_started'
      | 'note_required'
      | 'duplicate_code',
    readonly detail?: Record<string, unknown>,
  ) {
    super(`staff leave: ${code}`);
    this.name = 'LeaveError';
  }
}

export type LeaveType = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  daysPerYear: number | null;
  carryForwardMax: number;
  halfDay: boolean;
  active: boolean;
  sinceYear: number;
};
export type LeaveTypeInput = Omit<LeaveType, 'id' | 'sinceYear'>;
export type LeaveRequest = {
  id: string;
  personId: string;
  name: string;
  institutionId: string;
  typeId: string;
  typeCode: string;
  from: string;
  to: string;
  halfDay: boolean;
  days: number;
  reason: string;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
};
export type TypeBalance = Balance & { typeId: string };

export const DEFAULT_LEAVE_TYPES: LeaveTypeInput[] = [
  {
    code: 'CL',
    name: 'Casual leave',
    paid: true,
    daysPerYear: 12,
    carryForwardMax: 0,
    halfDay: true,
    active: true,
  },
  {
    code: 'SL',
    name: 'Sick leave',
    paid: true,
    daysPerYear: 12,
    carryForwardMax: 30,
    halfDay: true,
    active: true,
  },
  {
    code: 'EL',
    name: 'Earned leave',
    paid: true,
    daysPerYear: 15,
    carryForwardMax: 45,
    halfDay: true,
    active: true,
  },
  {
    code: 'LOP',
    name: 'Loss of pay',
    paid: false,
    daysPerYear: null,
    carryForwardMax: 0,
    halfDay: true,
    active: true,
  },
];

/** A new organisation's starting leave types (sign-up). Safe to repeat. */
export async function installLeaveTypes(tx: Tx): Promise<void> {
  for (const t of DEFAULT_LEAVE_TYPES)
    await tx.execute(sql`
      insert into staff_leave_type (org_id, code, name, paid, days_per_year, carry_forward_max, half_day, since_year)
      values (app_current_org(), ${t.code}, ${t.name}, ${t.paid}, ${t.daysPerYear}, ${t.carryForwardMax}, ${t.halfDay},
        extract(year from app_today() - interval '3 months')::int)
      on conflict do nothing`);
}

async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new LeaveError('institution_not_found');
  return p;
}
const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

const typeSelect = sql`
  select id::text, code, name, paid, days_per_year::float8 as "daysPerYear",
    carry_forward_max::float8 as "carryForwardMax", half_day as "halfDay", active, since_year as "sinceYear"
  from staff_leave_type where org_id = app_current_org()`;
const typesIn = async (tx: Tx) => [
  ...(await tx.execute<LeaveType>(sql`${typeSelect} order by active desc, code`)),
];

const requestSelect = sql`
  select r.id::text, r.person_id::text as "personId", p.legal_name as name, r.institution_id::text as "institutionId",
    r.type_id::text as "typeId", t.code as "typeCode", r.from_date::text as "from", r.to_date::text as "to",
    r.half_day as "halfDay", r.days::float8 as days, r.reason, r.state,
    r.requested_by_person_id::text as "requestedBy", r.requested_at::text as "requestedAt",
    r.decided_by_person_id::text as "decidedBy", r.decided_at::text as "decidedAt", r.note
  from staff_leave_request r
  join person p on p.org_id = r.org_id and p.id = r.person_id
  join staff_leave_type t on t.org_id = r.org_id and t.id = r.type_id
  where r.org_id = app_current_org()`;

/** One person's balances for a leave year, every type. */
async function balancesOf(tx: Tx, personId: string, year: number): Promise<TypeBalance[]> {
  const types = await typesIn(tx);
  const rows = await tx.execute<{
    typeId: string;
    year: number;
    approved: number;
    pending: number;
    adjusted: number;
  }>(sql`
    select type_id::text as "typeId", y as year, sum(approved)::float8 as approved, sum(pending)::float8 as pending,
      sum(adjusted)::float8 as adjusted
    from (
      select type_id, extract(year from from_date - interval '3 months')::int as y,
        case when state = 'approved' then days else 0 end as approved,
        case when state = 'pending' then days else 0 end as pending, 0 as adjusted
      from staff_leave_request where org_id = app_current_org() and person_id = ${personId}
        and state in ('approved', 'pending')
      union all
      select type_id, leave_year, 0, 0, days from staff_leave_adjustment
      where org_id = app_current_org() and person_id = ${personId}
    ) u where y <= ${year} group by type_id, y`);
  return types.map((t) => {
    const use: LeaveUse = new Map(rows.filter((r) => r.typeId === t.id).map((r) => [r.year, r]));
    return { typeId: t.id, ...balanceOf(t, use, year) };
  });
}

const holidaySet = async (
  holidays: HolidaysPort,
  tx: Tx,
  institutionId: string,
  from: string,
  to: string,
) => new Set(await holidays(tx, institutionId, from, to));

/** Leave types: every staff member of the institution may see them. */
export async function leaveTypes(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<LeaveType[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'staff.leave.apply', {
      orgId: actor.orgId,
      subjectPersonId: actor.personId,
      place: await place(tx, institutionId),
    });
    return typesIn(tx);
  });
}

/** Creates or edits a leave type (organisation-wide). A type with requests is retired, never deleted. */
export async function saveLeaveType(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: LeaveTypeInput & { id?: string | undefined },
): Promise<{ id: string }> {
  return command(
    db,
    permissions,
    actor,
    { permission: 'staff.leave.manage', resource: { orgId: actor.orgId } },
    async (tx) => {
      const [taken] = await tx.execute<{ id: string }>(sql`
        select id::text from staff_leave_type where org_id = app_current_org() and code = ${input.code}
          and (${input.id ?? null}::uuid is null or id <> ${input.id ?? null}::uuid)`);
      if (taken) throw new LeaveError('duplicate_code');
      const [row] = input.id
        ? await tx.execute<{ id: string }>(sql`
            update staff_leave_type set code = ${input.code}, name = ${input.name}, paid = ${input.paid},
              days_per_year = ${input.daysPerYear}, carry_forward_max = ${input.carryForwardMax},
              half_day = ${input.halfDay}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`)
        : await tx.execute<{ id: string }>(sql`
            insert into staff_leave_type (org_id, code, name, paid, days_per_year, carry_forward_max, half_day, active,
              since_year)
            values (app_current_org(), ${input.code}, ${input.name}, ${input.paid}, ${input.daysPerYear},
              ${input.carryForwardMax}, ${input.halfDay}, ${input.active},
              extract(year from app_today() - interval '3 months')::int)
            returning id::text`);
      if (!row) throw new LeaveError('leave_type_not_found');
      return {
        result: { id: row.id },
        audit: {
          action: input.id ? 'staff.leave.type_update' : 'staff.leave.type_create',
          entityType: 'staff_leave_type',
          entityId: row.id,
          dataClass: 'operational',
          detail: {
            code: input.code,
            name: input.name,
            paid: input.paid,
            daysPerYear: input.daysPerYear,
            carryForwardMax: input.carryForwardMax,
            halfDay: input.halfDay,
            active: input.active,
          },
        },
      };
    },
  );
}

/** One's own leave at an institution: what's left of each type this year, and one's requests. */
export async function myLeave(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<{ year: number; balances: TypeBalance[]; requests: LeaveRequest[] }> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'staff.leave.apply', {
      orgId: actor.orgId,
      subjectPersonId: actor.personId,
      place: await place(tx, institutionId),
    });
    const year = leaveYear(await today(tx));
    return {
      year,
      balances: await balancesOf(tx, actor.personId, year),
      requests: [
        ...(await tx.execute<LeaveRequest>(sql`${requestSelect} and r.person_id = ${actor.personId}
          and r.to_date >= ${leaveYearRange(year).from}::date order by r.from_date desc`)),
      ],
    };
  });
}

/** Days a request would count and what's left of its type: shown while the form is filled in. */
export async function leaveQuote(
  db: Db,
  permissions: Permissions,
  holidays: HolidaysPort,
  actor: Actor,
  input: {
    institutionId: string;
    personId?: string | undefined;
    typeId: string;
    from: string;
    to: string;
    halfDay: boolean;
  },
): Promise<{ days: number; left: number | null }> {
  return withTenant(db, actor.orgId, async (tx) => {
    const personId = input.personId ?? actor.personId;
    await assertMayAsk(tx, permissions, actor, personId, await place(tx, input.institutionId));
    const days = daysCounted(
      input.from,
      input.to,
      input.halfDay,
      await holidaySet(holidays, tx, input.institutionId, input.from, input.to),
    );
    const b = (await balancesOf(tx, personId, leaveYear(input.from))).find(
      (x) => x.typeId === input.typeId,
    );
    return { days, left: b?.left ?? null };
  });
}

/** Own leave needs `apply` (self); someone else's needs `manage` at the institution. */
async function assertMayAsk(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
  personId: string,
  where: NonNullable<Resource['place']>,
) {
  if (personId === actor.personId)
    await permissions.assertCan(tx, actor, 'staff.leave.apply', {
      orgId: actor.orgId,
      subjectPersonId: personId,
      place: where,
    });
  else
    await permissions.assertCan(tx, actor, 'staff.leave.manage', {
      orgId: actor.orgId,
      place: where,
    });
}

/**
 * Asks for leave: one's own, or (office) on someone's behalf. Days are the working days in the
 * range; the type's balance must hold them (pending days hold their place).
 */
export async function askLeave(
  db: Db,
  permissions: Permissions,
  holidays: HolidaysPort,
  actor: Actor,
  input: {
    institutionId: string;
    personId?: string | undefined;
    typeId: string;
    from: string;
    to: string;
    halfDay: boolean;
    reason: string;
  },
): Promise<{ id: string; days: number }> {
  const personId = input.personId ?? actor.personId;
  const where = await withTenant(db, actor.orgId, (tx) => place(tx, input.institutionId));
  const resource: Resource =
    personId === actor.personId
      ? { orgId: actor.orgId, subjectPersonId: personId, place: where }
      : { orgId: actor.orgId, place: where };
  return command(
    db,
    permissions,
    actor,
    {
      permission: personId === actor.personId ? 'staff.leave.apply' : 'staff.leave.manage',
      resource,
    },
    async (tx) => {
      const [type] = await tx.execute<LeaveType>(sql`${typeSelect} and id = ${input.typeId}`);
      if (!type) throw new LeaveError('leave_type_not_found');
      if (!type.active) throw new LeaveError('type_retired');
      if (input.halfDay && (!type.halfDay || input.from !== input.to))
        throw new LeaveError('half_day_not_allowed');
      if (leaveYear(input.from) !== leaveYear(input.to)) throw new LeaveError('crosses_leave_year');
      if (
        !(await staffAt(tx, input.institutionId, input.from)).some((s) => s.personId === personId)
      )
        throw new LeaveError('not_on_staff');
      const days = daysCounted(
        input.from,
        input.to,
        input.halfDay,
        await holidaySet(holidays, tx, input.institutionId, input.from, input.to),
      );
      if (days === 0) throw new LeaveError('no_working_days');
      // One request at a time per person, so two can't both pass the overlap and balance checks.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('staff_leave:' || ${personId}))`);
      const [overlap] = await tx.execute<{ id: string }>(sql`
        select id::text from staff_leave_request where org_id = app_current_org() and person_id = ${personId}
          and state in ('pending', 'approved') and from_date <= ${input.to}::date and to_date >= ${input.from}::date
        limit 1`);
      if (overlap) throw new LeaveError('leave_overlaps');
      const left = (await balancesOf(tx, personId, leaveYear(input.from))).find(
        (b) => b.typeId === type.id,
      )?.left;
      if (left !== null && left !== undefined && days > left)
        throw new LeaveError('over_balance', { left });
      const reason = input.reason.trim();
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into staff_leave_request (org_id, person_id, institution_id, type_id, from_date, to_date, half_day,
          days, reason, requested_by_person_id)
        values (app_current_org(), ${personId}, ${input.institutionId}, ${type.id}, ${input.from}::date,
          ${input.to}::date, ${input.halfDay}, ${days}, ${reason}, ${actor.personId})
        returning id::text`);
      const id = row?.id ?? '';
      const name = (await displayNames(tx, [personId]))[personId] ?? '';
      const span = input.from === input.to ? input.from : `${input.from} to ${input.to}`;
      // The person on leave is the requester, so the engine never lets them decide it.
      await startApproval(tx, {
        process: PROCESS,
        subjectId: id,
        institutionId: input.institutionId,
        amountPaise: null,
        summary: `${name} · ${type.code} · ${span} · ${days} ${days === 1 ? 'day' : 'days'}`,
        requestedBy: personId,
      });
      return {
        result: { id, days },
        audit: {
          action: 'staff.leave.request',
          entityType: 'person',
          entityId: personId,
          dataClass: 'personal',
          detail: { requestId: id, type: type.code, from: input.from, to: input.to, days },
        },
        events: [
          {
            type: LEAVE_REQUESTED,
            payload: { requestId: id, personId, institutionId: input.institutionId },
          },
        ],
      };
    },
  );
}

async function loadRequest(tx: Tx, id: string): Promise<LeaveRequest> {
  const [r] = await tx.execute<LeaveRequest>(
    sql`${requestSelect} and r.id = ${id} for update of r`,
  );
  if (!r) throw new LeaveError('leave_request_not_found');
  return r;
}
const requestPlace = (db: Db, actor: Actor, id: string) =>
  withTenant(db, actor.orgId, async (tx) => {
    const [r] = await tx.execute<{ institutionId: string; personId: string }>(sql`
      select institution_id::text as "institutionId", person_id::text as "personId"
      from staff_leave_request where org_id = app_current_org() and id = ${id}`);
    if (!r) throw new LeaveError('leave_request_not_found');
    return { ...r, where: await place(tx, r.institutionId) };
  });

/**
 * Decides the current approval step of a pending request through the shared engine (who decides
 * comes from the approval designer; by default anyone with `staff.leave.approve`). After the last
 * step it is approved, which marks each counted day in the register (on leave, or half day for a
 * half-day leave), overwriting earlier marks; the audit keeps them. A rejection is final at once.
 */
export async function decideLeave(
  db: Db,
  permissions: Permissions,
  holidays: HolidaysPort,
  actor: Actor,
  input: { requestId: string; approve: boolean; note?: string | null | undefined },
): Promise<'approved' | 'rejected' | 'pending'> {
  return withTenant(db, actor.orgId, async (tx) => {
    const r = await loadRequest(tx, input.requestId);
    if (r.personId === actor.personId) throw new LeaveError('own_leave');
    if (r.state !== 'pending') throw new LeaveError('not_pending');
    const note = input.note?.trim() || null;
    if (!input.approve && !note) throw new LeaveError('note_required');
    const outcome = await decideApproval(tx, permissions, actor, {
      process: PROCESS,
      subjectId: r.id,
      approve: input.approve,
      note,
    });
    const detail = { requestId: r.id, type: r.typeCode, from: r.from, to: r.to, days: r.days };
    if (outcome === 'pending') {
      await writeAudit(tx, actor, {
        action: 'staff.leave.step_approve',
        entityType: 'person',
        entityId: r.personId,
        dataClass: 'personal',
        detail,
      });
      return outcome;
    }
    const approved = outcome === 'approved';
    await tx.execute(sql`
      update staff_leave_request set state = ${outcome},
        decided_by_person_id = ${actor.personId}, decided_at = now(), note = ${note}
      where org_id = app_current_org() and id = ${r.id}`);
    let overwritten: { onDate: string; status: string }[] = [];
    if (approved) {
      const dates = workingDates(
        r.from,
        r.to,
        await holidaySet(holidays, tx, r.institutionId, r.from, r.to),
      );
      overwritten = [
        ...(await tx.execute<{ onDate: string; status: string }>(sql`
          select on_date::text as "onDate", status from staff_attendance_day
          where org_id = app_current_org() and institution_id = ${r.institutionId} and person_id = ${r.personId}
            and on_date = any(${`{${dates.join(',')}}`}::date[])`)),
      ];
      const status: DayStatus = r.halfDay ? 'half_day' : 'on_leave';
      for (const d of dates)
        await tx.execute(sql`
          insert into staff_attendance_day (org_id, person_id, institution_id, on_date, status, source,
            marked_by_person_id, reason, leave_request_id)
          values (app_current_org(), ${r.personId}, ${r.institutionId}, ${d}::date, ${status}, 'register',
            ${actor.personId}, ${`Leave: ${r.typeCode}`}, ${r.id})
          on conflict (org_id, institution_id, on_date, person_id) do update set
            status = excluded.status, source = 'register', marked_by_person_id = excluded.marked_by_person_id,
            reason = excluded.reason, leave_request_id = excluded.leave_request_id, updated_at = now()`);
    }
    await writeAudit(tx, actor, {
      action: approved ? 'staff.leave.approve' : 'staff.leave.reject',
      entityType: 'person',
      entityId: r.personId,
      dataClass: 'personal',
      ...(note ? { reason: note } : {}),
      detail: {
        ...detail,
        overwritten: overwritten.map((o) => `${o.onDate}:${o.status}`).join(',') || null,
      },
    });
    await emit(tx, {
      type: LEAVE_DECIDED,
      payload: {
        requestId: r.id,
        personId: r.personId,
        institutionId: r.institutionId,
        approved,
      },
    });
    return outcome;
  });
}

/**
 * Cancels a request: its person (own leave) or a manager. A pending one any time; an approved
 * one only before it starts, taking its register days back. Once started, leave stands.
 */
export async function cancelLeave(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  requestId: string,
): Promise<void> {
  const { where, personId } = await requestPlace(db, actor, requestId);
  const own = personId === actor.personId;
  await command(
    db,
    permissions,
    actor,
    {
      permission: own ? 'staff.leave.apply' : 'staff.leave.manage',
      resource: own
        ? { orgId: actor.orgId, subjectPersonId: personId, place: where }
        : { orgId: actor.orgId, place: where },
    },
    async (tx) => {
      const r = await loadRequest(tx, requestId);
      if (r.state !== 'pending' && r.state !== 'approved') throw new LeaveError('not_pending');
      if (r.state === 'approved' && r.from <= (await today(tx)))
        throw new LeaveError('leave_started');
      await tx.execute(sql`
        delete from staff_attendance_day where org_id = app_current_org() and leave_request_id = ${r.id}`);
      await tx.execute(sql`
        update staff_leave_request set state = 'cancelled' where org_id = app_current_org() and id = ${r.id}`);
      if (r.state === 'pending') await withdrawApproval(tx, PROCESS, r.id);
      return {
        result: undefined,
        audit: {
          action: 'staff.leave.cancel',
          entityType: 'person',
          entityId: r.personId,
          dataClass: 'personal',
          detail: { requestId: r.id, was: r.state, from: r.from, to: r.to },
        },
        events: [
          {
            type: LEAVE_CANCELLED,
            payload: { requestId: r.id, personId: r.personId, institutionId: r.institutionId },
          },
        ],
      };
    },
  );
}

/** The office's view (`manage` or `approve`): every request at the institution in a leave year, waiting first. */
export async function leaveRequests(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  year?: number,
): Promise<{
  year: number;
  requests: LeaveRequest[];
  names: Record<string, string>;
  /** Each waiting request's approval: step, who decides, and whether the viewer may. */
  approvals: Record<string, ApprovalState>;
}> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await place(tx, institutionId);
    const resource = { orgId: actor.orgId, place: where };
    if (!(await permissions.can(tx, actor, 'staff.leave.approve', resource)).allowed)
      await permissions.assertCan(tx, actor, 'staff.leave.manage', resource);
    const y = year ?? leaveYear(await today(tx));
    const { from, to } = leaveYearRange(y);
    const requests = [
      ...(await tx.execute<LeaveRequest>(sql`${requestSelect} and r.institution_id = ${institutionId}
        and r.from_date between ${from}::date and ${to}::date
        order by (r.state = 'pending') desc, r.from_date desc`)),
    ];
    const ids = requests.flatMap((r) => [r.requestedBy, ...(r.decidedBy ? [r.decidedBy] : [])]);
    const approvals = await approvalStates(
      tx,
      permissions,
      actor,
      PROCESS,
      requests.filter((r) => r.state === 'pending').map((r) => r.id),
    );
    return { year: y, requests, names: await displayNames(tx, ids), approvals };
  });
}

/** Every staff member's balances at the institution for a leave year (`manage`). */
export async function leaveBalances(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
  year?: number,
) {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'staff.leave.manage', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    const now = await today(tx);
    const y = year ?? leaveYear(now);
    const staff = await staffAt(tx, institutionId, now);
    // ponytail: one balance query per staff member; one grouped query if a school has hundreds.
    const rows = [];
    for (const s of staff) rows.push({ ...s, balances: await balancesOf(tx, s.personId, y) });
    return { year: y, types: await typesIn(tx), staff: rows };
  });
}

/** Adds or takes away days of a type for a person in a leave year (`manage`, with a reason). */
export async function adjustLeave(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    personId: string;
    typeId: string;
    year: number;
    days: number;
    reason: string;
  },
): Promise<void> {
  const where = await withTenant(db, actor.orgId, (tx) => place(tx, input.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'staff.leave.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [type] = await tx.execute<LeaveType>(sql`${typeSelect} and id = ${input.typeId}`);
      if (!type) throw new LeaveError('leave_type_not_found');
      if (
        !(await staffAt(tx, input.institutionId, await today(tx))).some(
          (s) => s.personId === input.personId,
        )
      )
        throw new LeaveError('not_on_staff');
      const reason = input.reason.trim();
      await tx.execute(sql`
        insert into staff_leave_adjustment (org_id, person_id, type_id, leave_year, days, reason, by_person_id)
        values (app_current_org(), ${input.personId}, ${type.id}, ${input.year}, ${input.days}, ${reason},
          ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'staff.leave.adjust',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          reason,
          detail: { type: type.code, year: input.year, days: input.days },
        },
      };
    },
  );
}

export type PayrollInputs = {
  month: string;
  calendarDays: number;
  /** Working days so far (later ones in the month aren't counted yet). */
  through: string;
  staff: {
    personId: string;
    name: string;
    employeeCode: string;
    designation: string | null;
    row: PayrollRow;
  }[];
};

/** A month's payroll inputs (YYYY-MM): one row per staff member, for the accountant (`manage`). */
export async function payrollInputs(
  db: Db,
  permissions: Permissions,
  holidays: HolidaysPort,
  actor: Actor,
  institutionId: string,
  month: string,
): Promise<PayrollInputs> {
  return withTenant(db, actor.orgId, async (tx) => {
    await permissions.assertCan(tx, actor, 'staff.leave.manage', {
      orgId: actor.orgId,
      place: await place(tx, institutionId),
    });
    return payrollInputsIn(tx, holidays, institutionId, month);
  });
}

/**
 * The same inputs inside the caller's transaction, for payroll, which checks its own permission
 * (a payroll preparer needn't manage leave). Read-only.
 */
export async function payrollInputsIn(
  tx: Tx,
  holidays: HolidaysPort,
  institutionId: string,
  month: string,
): Promise<PayrollInputs> {
  {
    const first = `${month}-01`;
    const [m] = await tx.execute<{ last: string; through: string }>(sql`
      select (${first}::date + interval '1 month' - interval '1 day')::date::text as last,
        least((${first}::date + interval '1 month' - interval '1 day')::date, app_today())::text as through`);
    const last = m?.last ?? first;
    const through = m?.through ?? first;
    const working =
      through < first
        ? []
        : workingDates(
            first,
            through,
            await holidaySet(holidays, tx, institutionId, first, through),
          );
    const days = await tx.execute<{ personId: string; onDate: string; status: DayStatus }>(sql`
      select person_id::text as "personId", on_date::text as "onDate", status from staff_attendance_day
      where org_id = app_current_org() and institution_id = ${institutionId}
        and on_date between ${first}::date and ${last}::date`);
    const leave = await tx.execute<{
      personId: string;
      from: string;
      to: string;
      halfDay: boolean;
      paid: boolean;
    }>(sql`
      select r.person_id::text as "personId", r.from_date::text as "from", r.to_date::text as "to",
        r.half_day as "halfDay", t.paid
      from staff_leave_request r join staff_leave_type t on t.org_id = r.org_id and t.id = r.type_id
      where r.org_id = app_current_org() and r.institution_id = ${institutionId} and r.state = 'approved'
        and r.from_date <= ${last}::date and r.to_date >= ${first}::date`);
    // On staff on the 1st or at the end: a leaver's last month and a joiner's first are listed
    // (days outside their time with the school show as not marked).
    const staff = [
      ...new Map(
        [
          ...(await staffAt(tx, institutionId, first)),
          ...(await staffAt(tx, institutionId, through < first ? first : through)),
        ].map((s) => [s.personId, s]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name));
    return {
      month,
      calendarDays: Number(last.slice(8, 10)),
      through,
      staff: staff.map((s) => {
        const leaveDays = new Map<string, { days: number; paid: boolean }>();
        for (const l of leave.filter((x) => x.personId === s.personId))
          for (const d of working.filter((w) => w >= l.from && w <= l.to))
            leaveDays.set(d, { days: l.halfDay ? 0.5 : 1, paid: l.paid });
        return {
          personId: s.personId,
          name: s.name,
          employeeCode: s.employeeCode,
          designation: s.designation,
          row: payrollRow({
            calendarDays: Number(last.slice(8, 10)),
            working,
            days: new Map(
              days.filter((d) => d.personId === s.personId).map((d) => [d.onDate, d.status]),
            ),
            leave: leaveDays,
          }),
        };
      }),
    };
  }
}
