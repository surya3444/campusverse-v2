// The hostel (docs/specs/HOSTEL.md): hostels, rooms and beds, allocation with moves, the roll
// call, and outpasses requested by parents or issued by the warden, never handed to a restricted
// guardian. Students come from people/records; classes from AcademicPlacementPort. Never reads
// academic tables.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import {
  displayNames,
  memberKind,
  pickupGuardians,
  searchMembers,
  studentFacts,
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
import { collectorCheck, type Collector } from '@campusverse/shared-gate';
import { sql } from 'drizzle-orm';
import {
  endOfStay,
  fitsHostel,
  isOverdue,
  outpassProblem,
  type HostelKind,
} from '../domain/hostel.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements' | 'findByReference'>[];
export type HostelDeps = { db: Db; permissions: Permissions; placements: Placements };

export const ROLL_CALL_SUBMITTED = 'hostel.rollcall.submitted.v1';
export const OUTPASS_REQUESTED = 'hostel.outpass.requested.v1';
export const OUTPASS_DECIDED = 'hostel.outpass.decided.v1';
export const OUTPASS_LEFT = 'hostel.outpass.left.v1';
export const OUTPASS_RETURNED = 'hostel.outpass.returned.v1';

export class HostelError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'hostel_not_found'
      | 'hostel_exists'
      | 'room_not_found'
      | 'room_exists'
      | 'bed_in_use'
      | 'no_such_bed'
      | 'bed_taken'
      | 'not_a_student'
      | 'already_allocated'
      | 'wrong_hostel'
      | 'allocation_not_found'
      | 'marks_incomplete'
      | 'not_resident'
      | 'past_date'
      | 'back_before_leaving'
      | 'collector_restricted'
      | 'collector_not_guardian'
      | 'outpass_not_found'
      | 'wrong_state'
      | 'not_yet'
      | 'note_needed',
    readonly details?: Record<string, unknown>,
  ) {
    super(`hostel: ${code}`);
    this.name = 'HostelError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new HostelError('institution_not_found');
  return p;
}
const res = (actor: Actor, p: Resource['place'] | null, subjectPersonId?: string): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
  ...(subjectPersonId ? { subjectPersonId } : {}),
});
const where = (deps: HostelDeps, actor: Actor, institutionId: string) =>
  withTenant(deps.db, actor.orgId, async (tx) => res(actor, await place(tx, institutionId)));

async function assertAny(
  deps: HostelDeps,
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

function reading<T>(
  deps: HostelDeps,
  actor: Actor,
  institutionId: string,
  work: (tx: Tx) => Promise<T>,
  permissions = ['hostel.resident.read'],
): Promise<T> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await assertAny(deps, tx, actor, permissions, institutionId);
    return work(tx);
  });
}

async function labels(tx: Tx, deps: HostelDeps, personIds: string[], on: string) {
  const found = await Promise.all(
    deps.placements.map((p) => p.getPlacements(tx, { personIds, onDate: on })),
  );
  return (id: string) => found.map((m) => m.get(id)).find((x) => x !== undefined);
}

async function hostelIn(tx: Tx, institutionId: string, hostelId: string) {
  const [h] = await tx.execute<{ kind: HostelKind; name: string }>(sql`
    select kind, name from hostel where org_id = app_current_org() and id = ${hostelId}
      and institution_id = ${institutionId}`);
  if (!h) throw new HostelError('hostel_not_found');
  return h;
}

// ---------------------------------------------------------------------------------------------
// Hostels and rooms
// ---------------------------------------------------------------------------------------------

export type HostelRow = {
  id: string;
  name: string;
  kind: HostelKind;
  active: boolean;
  rooms: number;
  beds: number;
  occupied: number;
};

export async function hostels(
  deps: HostelDeps,
  actor: Actor,
  institutionId: string,
): Promise<HostelRow[]> {
  return reading(deps, actor, institutionId, async (tx) => {
    const on = await today(tx);
    return [
      ...(await tx.execute<HostelRow>(sql`
        select h.id::text, h.name, h.kind, h.active,
          (select count(*)::int from hostel_room r where r.org_id = h.org_id and r.hostel_id = h.id and r.active) as rooms,
          (select coalesce(sum(beds), 0)::int from hostel_room r where r.org_id = h.org_id and r.hostel_id = h.id
            and r.active) as beds,
          (select count(*)::int from hostel_allocation a where a.org_id = h.org_id and a.hostel_id = h.id
            and a.valid_during @> ${on}::date) as occupied
        from hostel h where h.org_id = app_current_org() and h.institution_id = ${institutionId}
        order by h.active desc, h.name`)),
    ];
  });
}

export async function saveHostel(
  deps: HostelDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id: string | null;
    name: string;
    kind: HostelKind;
    active: boolean;
  },
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.room.manage', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      const name = input.name.trim();
      const [same] = await tx.execute<{ id: string }>(sql`
        select id::text from hostel where org_id = app_current_org() and institution_id = ${input.institutionId}
          and lower(btrim(name)) = lower(${name})`);
      if (same && same.id !== input.id) throw new HostelError('hostel_exists');
      let id = input.id;
      if (id) {
        await hostelIn(tx, input.institutionId, id);
        await tx.execute(sql`
          update hostel set name = ${name}, kind = ${input.kind}, active = ${input.active}
          where org_id = app_current_org() and id = ${id}`);
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into hostel (org_id, institution_id, name, kind, active)
          values (app_current_org(), ${input.institutionId}, ${name}, ${input.kind}, ${input.active})
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'hostel.hostel.save',
          entityType: 'hostel',
          entityId: id,
          dataClass: 'operational',
          detail: { name, kind: input.kind, active: input.active },
        },
      };
    },
  );
}

export type Bed = {
  bedNo: number;
  allocationId: string | null;
  studentId: string | null;
  name: string | null;
  label: string | null;
  since: string | null;
};
export type RoomRow = {
  id: string;
  number: string;
  floor: string;
  beds: number;
  active: boolean;
  occupants: Bed[];
};

/** A hostel's rooms, each with every bed: who is in it since when, or free. */
export async function rooms(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; hostelId: string },
): Promise<RoomRow[]> {
  return reading(deps, actor, input.institutionId, async (tx) => {
    await hostelIn(tx, input.institutionId, input.hostelId);
    const on = await today(tx);
    const rs = await tx.execute<Omit<RoomRow, 'occupants'>>(sql`
      select id::text, number, floor, beds, active from hostel_room
      where org_id = app_current_org() and hostel_id = ${input.hostelId}
      order by active desc, floor, length(number), number`);
    const allocs = await tx.execute<{
      allocationId: string;
      roomId: string;
      bedNo: number;
      studentId: string;
      since: string;
    }>(sql`
      select id::text as "allocationId", room_id::text as "roomId", bed_no as "bedNo",
        student_person_id::text as "studentId", lower(valid_during)::text as since
      from hostel_allocation where org_id = app_current_org() and hostel_id = ${input.hostelId}
        and valid_during @> ${on}::date`);
    const names = await displayNames(
      tx,
      allocs.map((a) => a.studentId),
    );
    const placed = await labels(
      tx,
      deps,
      allocs.map((a) => a.studentId),
      on,
    );
    return rs.map((r) => ({
      ...r,
      occupants: Array.from({ length: r.beds }, (_, i): Bed => {
        const a = allocs.find((x) => x.roomId === r.id && x.bedNo === i + 1);
        return {
          bedNo: i + 1,
          allocationId: a?.allocationId ?? null,
          studentId: a?.studentId ?? null,
          name: a ? (names[a.studentId] ?? null) : null,
          label: a ? (placed(a.studentId)?.displayLabel ?? null) : null,
          since: a?.since ?? null,
        };
      }),
    }));
  });
}

export async function saveRoom(
  deps: HostelDeps,
  actor: Actor,
  input: {
    institutionId: string;
    hostelId: string;
    id: string | null;
    number: string;
    floor: string;
    beds: number;
    active: boolean;
  },
): Promise<{ id: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.room.manage', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      await hostelIn(tx, input.institutionId, input.hostelId);
      const number = input.number.trim();
      const [same] = await tx.execute<{ id: string }>(sql`
        select id::text from hostel_room where org_id = app_current_org() and hostel_id = ${input.hostelId}
          and upper(btrim(number)) = upper(${number})`);
      if (same && same.id !== input.id) throw new HostelError('room_exists');
      let id = input.id;
      if (id) {
        const on = await today(tx);
        const [busy] = await tx.execute<{ top: number | null; n: number }>(sql`
          select max(bed_no)::int as top, count(*)::int as n from hostel_allocation
          where org_id = app_current_org() and room_id = ${id}
            and (upper_inf(valid_during) or upper(valid_during) > ${on}::date)`);
        if ((busy?.top ?? 0) > input.beds || (!input.active && (busy?.n ?? 0) > 0))
          throw new HostelError('bed_in_use');
        const done = await tx.execute(sql`
          update hostel_room set number = ${number}, floor = ${input.floor.trim()}, beds = ${input.beds},
            active = ${input.active}
          where org_id = app_current_org() and id = ${id} and hostel_id = ${input.hostelId} returning id`);
        if (done.length === 0) throw new HostelError('room_not_found');
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into hostel_room (org_id, hostel_id, number, floor, beds, active)
          values (app_current_org(), ${input.hostelId}, ${number}, ${input.floor.trim()}, ${input.beds}, ${input.active})
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'hostel.room.save',
          entityType: 'hostel_room',
          entityId: id,
          dataClass: 'operational',
          detail: { number, beds: input.beds, active: input.active },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------------------------

/** Students of the school by name or admission number, with their bed if they have one. */
export async function findStudents(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; text: string },
): Promise<{ personId: string; name: string; label: string | null; bed: string | null }[]> {
  return reading(
    deps,
    actor,
    input.institutionId,
    async (tx) => {
      if (input.text.trim().length < 2) return [];
      const on = await today(tx);
      const byNumber = (
        await Promise.all(
          deps.placements.map((p) =>
            p.findByReference(tx, { institutionId: input.institutionId, text: input.text }),
          ),
        )
      ).flat();
      const members = (
        await searchMembers(tx, {
          institutionId: input.institutionId,
          text: input.text,
          onDate: on,
          ids: byNumber,
        })
      ).filter((m) => m.kind === 'student');
      const ids = members.map((m) => m.personId);
      const beds = await tx.execute<{ id: string; bed: string }>(sql`
        select a.student_person_id::text as id, h.name || ' · ' || r.number || ' · bed ' || a.bed_no as bed
        from hostel_allocation a
        join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
        join hostel_room r on r.org_id = a.org_id and r.id = a.room_id
        where a.org_id = app_current_org() and a.valid_during @> ${on}::date
          and a.student_person_id = any(${`{${ids.join(',')}}`}::uuid[])`);
      const placed = await labels(tx, deps, ids, on);
      return members.map((m) => ({
        personId: m.personId,
        name: m.name,
        label: placed(m.personId)?.displayLabel ?? null,
        bed: beds.find((b) => b.id === m.personId)?.bed ?? null,
      }));
    },
    ['hostel.room.manage', 'hostel.outpass.decide'],
  );
}

async function roomIn(tx: Tx, institutionId: string, roomId: string) {
  const [r] = await tx.execute<{
    hostelId: string;
    beds: number;
    active: boolean;
    kind: HostelKind;
  }>(sql`
    select r.hostel_id::text as "hostelId", r.beds, r.active and h.active as active, h.kind
    from hostel_room r join hostel h on h.org_id = r.org_id and h.id = r.hostel_id
    where r.org_id = app_current_org() and r.id = ${roomId} and h.institution_id = ${institutionId}`);
  if (!r || !r.active) throw new HostelError('room_not_found');
  return r;
}

/** Checks a bed for a student from `from`: in range, free, and the right hostel for them. */
async function checkBed(
  tx: Tx,
  input: { institutionId: string; roomId: string; bedNo: number; studentId: string },
  from: string,
  ignoreAllocation: string | null,
) {
  const r = await roomIn(tx, input.institutionId, input.roomId);
  if (input.bedNo > r.beds) throw new HostelError('no_such_bed');
  const [taken] = await tx.execute(sql`
    select 1 from hostel_allocation where org_id = app_current_org() and room_id = ${input.roomId}
      and bed_no = ${input.bedNo} and valid_during && daterange(${from}::date, null)
      and id is distinct from ${ignoreAllocation}::uuid`);
  if (taken) throw new HostelError('bed_taken');
  const facts = await studentFacts(tx, input.studentId);
  if (!fitsHostel(r.kind, facts?.gender ?? null)) throw new HostelError('wrong_hostel');
  return r;
}

export async function allocate(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; roomId: string; bedNo: number; studentId: string },
): Promise<{ allocationId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.room.manage', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      const on = await today(tx);
      const kind = await memberKind(tx, {
        institutionId: input.institutionId,
        personId: input.studentId,
        onDate: on,
      });
      if (kind !== 'student') throw new HostelError('not_a_student');
      const [already] = await tx.execute(sql`
        select 1 from hostel_allocation where org_id = app_current_org() and student_person_id = ${input.studentId}
          and valid_during && daterange(${on}::date, null)`);
      if (already) throw new HostelError('already_allocated');
      const r = await checkBed(tx, input, on, null);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into hostel_allocation (org_id, hostel_id, room_id, bed_no, student_person_id, valid_during,
          allocated_by_person_id)
        values (app_current_org(), ${r.hostelId}, ${input.roomId}, ${input.bedNo}, ${input.studentId},
          daterange(${on}::date, null), ${actor.personId})
        returning id::text`);
      const allocationId = row?.id ?? '';
      return {
        result: { allocationId },
        audit: {
          action: 'hostel.allocation.add',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { allocationId, roomId: input.roomId, bedNo: input.bedNo },
        },
      };
    },
  );
}

async function currentAllocation(tx: Tx, institutionId: string, allocationId: string, on: string) {
  const [a] = await tx.execute<{
    studentId: string;
    from: string;
    roomId: string;
    bedNo: number;
  }>(sql`
    select a.student_person_id::text as "studentId", lower(a.valid_during)::text as "from",
      a.room_id::text as "roomId", a.bed_no as "bedNo"
    from hostel_allocation a join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
    where a.org_id = app_current_org() and a.id = ${allocationId} and h.institution_id = ${institutionId}
      and a.valid_during && daterange(${on}::date, null)
    for update of a`);
  if (!a) throw new HostelError('allocation_not_found');
  return a;
}

/** Moves a student to another bed from today; the old bed's record keeps its dates. */
export async function moveStudent(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; allocationId: string; roomId: string; bedNo: number },
): Promise<{ allocationId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.room.manage', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      const on = await today(tx);
      const a = await currentAllocation(tx, input.institutionId, input.allocationId, on);
      const r = await checkBed(tx, { ...input, studentId: a.studentId }, on, input.allocationId);
      let allocationId = input.allocationId;
      if (a.from >= on) {
        // Allocated today: correct the bed rather than keep a record of a few hours.
        await tx.execute(sql`
          update hostel_allocation set hostel_id = ${r.hostelId}, room_id = ${input.roomId}, bed_no = ${input.bedNo}
          where org_id = app_current_org() and id = ${input.allocationId}`);
      } else {
        await tx.execute(sql`
          update hostel_allocation set valid_during = daterange(lower(valid_during), ${on}::date),
            ended_reason = 'Moved'
          where org_id = app_current_org() and id = ${input.allocationId}`);
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into hostel_allocation (org_id, hostel_id, room_id, bed_no, student_person_id, valid_during,
            allocated_by_person_id)
          values (app_current_org(), ${r.hostelId}, ${input.roomId}, ${input.bedNo}, ${a.studentId},
            daterange(${on}::date, null), ${actor.personId})
          returning id::text`);
        allocationId = row?.id ?? '';
      }
      return {
        result: { allocationId },
        audit: {
          action: 'hostel.allocation.move',
          entityType: 'person',
          entityId: a.studentId,
          dataClass: 'personal',
          detail: {
            fromRoomId: a.roomId,
            fromBed: a.bedNo,
            toRoomId: input.roomId,
            toBed: input.bedNo,
          },
        },
      };
    },
  );
}

export async function vacate(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; allocationId: string; reason: string },
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.room.manage', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      const on = await today(tx);
      const a = await currentAllocation(tx, input.institutionId, input.allocationId, on);
      await tx.execute(sql`
        update hostel_allocation set valid_during = daterange(lower(valid_during), ${endOfStay(a.from, on)}::date),
          ended_reason = ${input.reason.trim()}
        where org_id = app_current_org() and id = ${input.allocationId}`);
      return {
        result: undefined,
        audit: {
          action: 'hostel.allocation.end',
          entityType: 'person',
          entityId: a.studentId,
          dataClass: 'personal',
          detail: { allocationId: input.allocationId, reason: input.reason.trim() },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Roll call
// ---------------------------------------------------------------------------------------------

export type Session = 'night' | 'morning';
export type MarkStatus = 'present' | 'absent' | 'on_leave';
export type RollLine = {
  studentId: string;
  name: string;
  label: string | null;
  room: string;
  bedNo: number;
  status: MarkStatus | null;
  outOnPass: boolean;
};

async function residents(tx: Tx, hostelId: string, on: string) {
  return tx.execute<{ studentId: string; room: string; bedNo: number; out: boolean }>(sql`
    select a.student_person_id::text as "studentId", r.number as room, a.bed_no as "bedNo",
      exists (select 1 from hostel_outpass o where o.org_id = a.org_id and o.student_person_id = a.student_person_id
        and o.state = 'out') as out
    from hostel_allocation a join hostel_room r on r.org_id = a.org_id and r.id = a.room_id
    where a.org_id = app_current_org() and a.hostel_id = ${hostelId} and a.valid_during @> ${on}::date
    order by r.floor, length(r.number), r.number, a.bed_no`);
}

/** Today's roll call for a hostel and session: every resident with their mark, if taken. */
export async function rollCallSheet(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; hostelId: string; session: Session },
): Promise<{ onDate: string; takenAt: string | null; takenBy: string | null; lines: RollLine[] }> {
  return reading(
    deps,
    actor,
    input.institutionId,
    async (tx) => {
      await hostelIn(tx, input.institutionId, input.hostelId);
      const on = await today(tx);
      const rs = await residents(tx, input.hostelId, on);
      const [call] = await tx.execute<{ id: string; takenAt: string; by: string }>(sql`
        select id::text, taken_at as "takenAt", taken_by_person_id::text as by from hostel_roll_call
        where org_id = app_current_org() and hostel_id = ${input.hostelId} and on_date = ${on}::date
          and session = ${input.session}`);
      const marks = call
        ? await tx.execute<{ studentId: string; status: MarkStatus }>(sql`
            select student_person_id::text as "studentId", status from hostel_roll_mark
            where org_id = app_current_org() and roll_call_id = ${call.id}`)
        : [];
      const ids = rs.map((r) => r.studentId);
      const names = await displayNames(tx, call ? [...ids, call.by] : ids);
      const placed = await labels(tx, deps, ids, on);
      return {
        onDate: on,
        takenAt: call ? new Date(call.takenAt).toISOString() : null,
        takenBy: call ? (names[call.by] ?? null) : null,
        lines: rs.map((r) => ({
          studentId: r.studentId,
          name: names[r.studentId] ?? '',
          label: placed(r.studentId)?.displayLabel ?? null,
          room: r.room,
          bedNo: r.bedNo,
          status:
            marks.find((m) => m.studentId === r.studentId)?.status ?? (r.out ? 'on_leave' : null),
          outOnPass: r.out,
        })),
      };
    },
    ['hostel.rollcall.mark', 'hostel.resident.read'],
  );
}

/** Saves today's roll call; every resident marked. Corrections the same day replace the marks. */
export async function saveRollCall(
  deps: HostelDeps,
  actor: Actor,
  input: {
    institutionId: string;
    hostelId: string;
    session: Session;
    marks: { studentId: string; status: MarkStatus }[];
  },
): Promise<{ rollCallId: string; absent: number }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.rollcall.mark', resource: await where(deps, actor, input.institutionId) },
    async (tx) => {
      await hostelIn(tx, input.institutionId, input.hostelId);
      const on = await today(tx);
      const rs = await residents(tx, input.hostelId, on);
      const given = new Map(input.marks.map((m) => [m.studentId, m.status]));
      const missing = rs.filter((r) => !given.has(r.studentId));
      const strangers = input.marks.filter((m) => !rs.some((r) => r.studentId === m.studentId));
      if (missing.length || strangers.length)
        throw new HostelError('marks_incomplete', { missing: missing.length });
      const [call] = await tx.execute<{ id: string }>(sql`
        insert into hostel_roll_call (org_id, hostel_id, on_date, session, taken_by_person_id)
        values (app_current_org(), ${input.hostelId}, ${on}::date, ${input.session}, ${actor.personId})
        on conflict (org_id, hostel_id, on_date, session)
        do update set taken_by_person_id = excluded.taken_by_person_id, taken_at = now()
        returning id::text`);
      const rollCallId = call?.id ?? '';
      await tx.execute(sql`
        delete from hostel_roll_mark where org_id = app_current_org() and roll_call_id = ${rollCallId}`);
      for (const m of input.marks)
        await tx.execute(sql`
          insert into hostel_roll_mark (org_id, roll_call_id, student_person_id, status)
          values (app_current_org(), ${rollCallId}, ${m.studentId}, ${m.status})`);
      const absent = input.marks.filter((m) => m.status === 'absent').length;
      return {
        result: { rollCallId, absent },
        audit: {
          action: 'hostel.rollcall.save',
          entityType: 'hostel',
          entityId: input.hostelId,
          dataClass: 'personal',
          detail: { rollCallId, session: input.session, residents: rs.length, absent },
        },
        events: [{ type: ROLL_CALL_SUBMITTED, payload: { rollCallId, hostelId: input.hostelId } }],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Outpasses
// ---------------------------------------------------------------------------------------------

export type OutpassState = 'requested' | 'approved' | 'rejected' | 'out' | 'returned' | 'cancelled';
export type OutpassRow = {
  outpassId: string;
  studentId: string;
  student: string;
  label: string | null;
  hostel: string;
  room: string | null;
  leavesOn: string;
  backBy: string;
  reason: string;
  collector: string;
  relation: string;
  phone: string | null;
  guardian: boolean;
  state: OutpassState;
  overdue: boolean;
  requestedBy: string | null;
  byParent: boolean;
  decidedBy: string | null;
  decisionNote: string | null;
  leftAt: string | null;
  returnedAt: string | null;
};

async function outpassRows(
  tx: Tx,
  deps: HostelDeps,
  filter: ReturnType<typeof sql>,
): Promise<OutpassRow[]> {
  const on = await today(tx);
  const rows = await tx.execute<
    Omit<OutpassRow, 'student' | 'label' | 'overdue' | 'requestedBy' | 'decidedBy'> & {
      requestedById: string;
      decidedById: string | null;
    }
  >(sql`
    select o.id::text as "outpassId", o.student_person_id::text as "studentId", h.name as hostel,
      (select r.number from hostel_allocation a join hostel_room r on r.org_id = a.org_id and r.id = a.room_id
        where a.org_id = o.org_id and a.student_person_id = o.student_person_id
          and a.valid_during @> ${on}::date limit 1) as room,
      o.leaves_on::text as "leavesOn", o.back_by::text as "backBy", o.reason, o.collector_name as collector,
      o.collector_relation as relation, o.collector_phone as phone, o.collector_guardian_id is not null as guardian,
      o.state, o.requested_by_person_id::text as "requestedById",
      exists (select 1 from guardian_link g where g.org_id = o.org_id and g.guardian_person_id = o.requested_by_person_id
        and g.student_person_id = o.student_person_id) as "byParent",
      o.decided_by_person_id::text as "decidedById", o.decision_note as "decisionNote",
      o.left_at as "leftAt", o.returned_at as "returnedAt"
    from hostel_outpass o join hostel h on h.org_id = o.org_id and h.id = o.hostel_id
    where o.org_id = app_current_org() and ${filter}
    order by o.leaves_on desc, o.created_at desc
    limit 300`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) =>
      [r.studentId, r.requestedById, r.decidedById].filter((x): x is string => !!x),
    ),
  );
  const placed = await labels(
    tx,
    deps,
    rows.map((r) => r.studentId),
    on,
  );
  return rows.map(({ requestedById, decidedById, ...r }) => ({
    ...r,
    student: names[r.studentId] ?? '',
    label: placed(r.studentId)?.displayLabel ?? null,
    overdue: isOverdue(r.state, r.backBy, on),
    requestedBy: names[requestedById] ?? null,
    decidedBy: decidedById ? (names[decidedById] ?? null) : null,
    leftAt: r.leftAt ? new Date(r.leftAt).toISOString() : null,
    returnedAt: r.returnedAt ? new Date(r.returnedAt).toISOString() : null,
  }));
}

const VIEWS = {
  requested: sql`o.state = 'requested'`,
  approved: sql`o.state = 'approved'`,
  out: sql`o.state = 'out'`,
  overdue: sql`o.state = 'out' and o.back_by < app_today()`,
  recent: sql`o.created_at > now() - interval '30 days'`,
} as const;
export type OutpassView = keyof typeof VIEWS;

export async function outpasses(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; view: OutpassView },
): Promise<OutpassRow[]> {
  return reading(deps, actor, input.institutionId, (tx) =>
    outpassRows(tx, deps, sql`h.institution_id = ${input.institutionId} and ${VIEWS[input.view]}`),
  );
}

export type OutpassInput = {
  studentId: string;
  leavesOn: string;
  backBy: string;
  reason: string;
  collector: Collector;
};

/** Validates and writes an outpass for a resident; the collector is checked against guardians. */
async function writeOutpass(
  tx: Tx,
  actor: Actor,
  input: OutpassInput,
  institutionId: string | null,
  state: 'requested' | 'approved',
): Promise<{ outpassId: string; hostelId: string; institutionId: string }> {
  const on = await today(tx);
  const [a] = await tx.execute<{ hostelId: string; institutionId: string }>(sql`
    select a.hostel_id::text as "hostelId", h.institution_id::text as "institutionId"
    from hostel_allocation a join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
    where a.org_id = app_current_org() and a.student_person_id = ${input.studentId}
      and a.valid_during @> ${on}::date`);
  if (!a || (institutionId && a.institutionId !== institutionId))
    throw new HostelError('not_resident');
  const problem = outpassProblem(input.leavesOn, input.backBy, on);
  if (problem) throw new HostelError(problem);
  const guardians = await pickupGuardians(tx, input.studentId);
  const check = collectorCheck(guardians, input.collector);
  if (check !== 'ok') throw new HostelError(check);
  const c = input.collector;
  const g = 'guardianId' in c ? guardians.find((x) => x.personId === c.guardianId) : undefined;
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into hostel_outpass (org_id, hostel_id, student_person_id, leaves_on, back_by, reason,
      collector_guardian_id, collector_name, collector_relation, collector_phone, state, requested_by_person_id,
      decided_by_person_id, decided_at)
    values (app_current_org(), ${a.hostelId}, ${input.studentId}, ${input.leavesOn}::date, ${input.backBy}::date,
      ${input.reason.trim()}, ${g?.personId ?? null}, ${g ? g.name : 'name' in c ? c.name.trim() : ''},
      ${g ? g.relationship : 'relation' in c ? c.relation.trim() : ''},
      ${g ? (g.phones[0] ?? null) : 'phone' in c ? c.phone : null}, ${state}, ${actor.personId},
      ${state === 'approved' ? actor.personId : null}, ${state === 'approved' ? sql`now()` : null})
    returning id::text`);
  return { outpassId: row?.id ?? '', hostelId: a.hostelId, institutionId: a.institutionId };
}

/** The warden issues an outpass directly (already approved), for a parent who phoned. */
export async function issueOutpass(
  deps: HostelDeps,
  actor: Actor,
  input: OutpassInput & { institutionId: string },
): Promise<{ outpassId: string }> {
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'hostel.outpass.decide',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const o = await writeOutpass(tx, actor, input, input.institutionId, 'approved');
      return {
        result: { outpassId: o.outpassId },
        audit: {
          action: 'hostel.outpass.issue',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { outpassId: o.outpassId, leavesOn: input.leavesOn, backBy: input.backBy },
        },
      };
    },
  );
}

/** A parent asks for an outpass for their own child, from the app. */
export async function requestOutpass(
  deps: HostelDeps,
  actor: Actor,
  input: OutpassInput,
): Promise<{ outpassId: string }> {
  const resource = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [a] = await tx.execute<{ institutionId: string }>(sql`
      select h.institution_id::text as "institutionId" from hostel_allocation a
      join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
      where a.org_id = app_current_org() and a.student_person_id = ${input.studentId}
        and a.valid_during @> app_today()`);
    return res(actor, a ? await placeOf(tx, a.institutionId) : null, input.studentId);
  });
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'hostel.outpass.request', resource },
    async (tx) => {
      const o = await writeOutpass(tx, actor, input, null, 'requested');
      return {
        result: { outpassId: o.outpassId },
        audit: {
          action: 'hostel.outpass.request',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { outpassId: o.outpassId, leavesOn: input.leavesOn, backBy: input.backBy },
        },
        events: [
          {
            type: OUTPASS_REQUESTED,
            payload: { outpassId: o.outpassId, institutionId: o.institutionId },
          },
        ],
      };
    },
  );
}

async function lockOutpass(tx: Tx, institutionId: string, outpassId: string) {
  const [o] = await tx.execute<{
    studentId: string;
    state: OutpassState;
    leavesOn: string;
    requestedBy: string;
    guardianId: string | null;
    name: string;
    relation: string;
    phone: string | null;
  }>(sql`
    select o.student_person_id::text as "studentId", o.state, o.leaves_on::text as "leavesOn",
      o.requested_by_person_id::text as "requestedBy", o.collector_guardian_id::text as "guardianId",
      o.collector_name as name, o.collector_relation as relation, o.collector_phone as phone
    from hostel_outpass o join hostel h on h.org_id = o.org_id and h.id = o.hostel_id
    where o.org_id = app_current_org() and o.id = ${outpassId} and h.institution_id = ${institutionId}
    for update of o`);
  if (!o) throw new HostelError('outpass_not_found');
  return o;
}

type Step = 'decide' | 'left' | 'back';

async function step(
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; outpassId: string; approve?: boolean; note?: string },
  kind: Step,
): Promise<void> {
  await command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'hostel.outpass.decide',
      resource: await where(deps, actor, input.institutionId),
    },
    async (tx) => {
      const o = await lockOutpass(tx, input.institutionId, input.outpassId);
      const on = await today(tx);
      let set;
      let event: string;
      let action: string;
      if (kind === 'decide') {
        if (o.state !== 'requested') throw new HostelError('wrong_state', { state: o.state });
        const note = (input.note ?? '').trim();
        if (!input.approve && note.length < 3) throw new HostelError('note_needed');
        set = sql`state = ${input.approve ? 'approved' : 'rejected'}, decided_by_person_id = ${actor.personId},
          decided_at = now(), decision_note = ${note || null}`;
        event = OUTPASS_DECIDED;
        action = input.approve ? 'hostel.outpass.approve' : 'hostel.outpass.reject';
      } else if (kind === 'left') {
        if (o.state !== 'approved') throw new HostelError('wrong_state', { state: o.state });
        if (o.leavesOn > on) throw new HostelError('not_yet');
        const check = collectorCheck(
          await pickupGuardians(tx, o.studentId),
          o.guardianId
            ? { guardianId: o.guardianId }
            : { name: o.name, relation: o.relation, phone: o.phone ?? '' },
        );
        if (check !== 'ok') throw new HostelError(check);
        set = sql`state = 'out', left_at = now(), left_by_person_id = ${actor.personId}`;
        event = OUTPASS_LEFT;
        action = 'hostel.outpass.left';
      } else {
        if (o.state !== 'out') throw new HostelError('wrong_state', { state: o.state });
        set = sql`state = 'returned', returned_at = now(), returned_by_person_id = ${actor.personId}`;
        event = OUTPASS_RETURNED;
        action = 'hostel.outpass.back';
      }
      await tx.execute(
        sql`update hostel_outpass set ${set} where org_id = app_current_org() and id = ${input.outpassId}`,
      );
      return {
        result: undefined,
        audit: {
          action,
          entityType: 'person',
          entityId: o.studentId,
          dataClass: 'personal',
          detail: { outpassId: input.outpassId, note: input.note ?? null },
        },
        events: [
          {
            type: event,
            payload: { outpassId: input.outpassId, institutionId: input.institutionId },
          },
        ],
      };
    },
  );
}

export const decideOutpass = (
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; outpassId: string; approve: boolean; note: string },
) => step(deps, actor, input, 'decide');
export const outpassLeft = (
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; outpassId: string },
) => step(deps, actor, input, 'left');
export const outpassBack = (
  deps: HostelDeps,
  actor: Actor,
  input: { institutionId: string; outpassId: string },
) => step(deps, actor, input, 'back');

/** Cancels an outpass before the child leaves: the parent who asked, or the warden. */
export async function cancelOutpass(
  deps: HostelDeps,
  actor: Actor,
  input: { outpassId: string },
): Promise<void> {
  const found = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [o] = await tx.execute<{
      studentId: string;
      institutionId: string;
      requestedBy: string;
    }>(sql`
      select o.student_person_id::text as "studentId", h.institution_id::text as "institutionId",
        o.requested_by_person_id::text as "requestedBy"
      from hostel_outpass o join hostel h on h.org_id = o.org_id and h.id = o.hostel_id
      where o.org_id = app_current_org() and o.id = ${input.outpassId}`);
    if (!o) throw new HostelError('outpass_not_found');
    const p = await place(tx, o.institutionId);
    const warden = await deps.permissions.can(tx, actor, 'hostel.outpass.decide', res(actor, p));
    return { o, p, warden: warden.allowed };
  });
  // The parent who asked cancels under their own request permission for that child.
  const check = found.warden
    ? { permission: 'hostel.outpass.decide', resource: res(actor, found.p) }
    : {
        permission: 'hostel.outpass.request',
        resource: res(actor, found.p, found.o.studentId),
      };
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    const o = await lockOutpass(tx, found.o.institutionId, input.outpassId);
    if (!found.warden && o.requestedBy !== actor.personId)
      throw new HostelError('outpass_not_found');
    if (o.state !== 'requested' && o.state !== 'approved')
      throw new HostelError('wrong_state', { state: o.state });
    await tx.execute(sql`
      update hostel_outpass set state = 'cancelled' where org_id = app_current_org() and id = ${input.outpassId}`);
    return {
      result: undefined,
      audit: {
        action: 'hostel.outpass.cancel',
        entityType: 'person',
        entityId: o.studentId,
        dataClass: 'personal',
        detail: { outpassId: input.outpassId },
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The parent's view, figures and the fee audience
// ---------------------------------------------------------------------------------------------

export type ChildHostel = {
  stay: { hostel: string; room: string; bedNo: number; since: string } | null;
  roll: { onDate: string; session: Session; status: MarkStatus }[];
  outpasses: OutpassRow[];
  collectors: { personId: string; name: string; relationship: string }[];
};

/** A guardian's view of their own child: bed, recent roll calls, outpasses, who may collect. */
export async function childHostel(
  deps: HostelDeps,
  actor: Actor,
  studentId: string,
): Promise<ChildHostel> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const on = await today(tx);
    const [stay] = await tx.execute<{
      institutionId: string;
      hostel: string;
      room: string;
      bedNo: number;
      since: string;
    }>(sql`
      select h.institution_id::text as "institutionId", h.name as hostel, r.number as room, a.bed_no as "bedNo",
        lower(a.valid_during)::text as since
      from hostel_allocation a
      join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
      join hostel_room r on r.org_id = a.org_id and r.id = a.room_id
      where a.org_id = app_current_org() and a.student_person_id = ${studentId} and a.valid_during @> ${on}::date`);
    await deps.permissions.assertCan(
      tx,
      actor,
      'hostel.resident.read',
      res(actor, stay ? await placeOf(tx, stay.institutionId) : null, studentId),
    );
    const roll = await tx.execute<{ onDate: string; session: Session; status: MarkStatus }>(sql`
      select c.on_date::text as "onDate", c.session, m.status from hostel_roll_mark m
      join hostel_roll_call c on c.org_id = m.org_id and c.id = m.roll_call_id
      where m.org_id = app_current_org() and m.student_person_id = ${studentId}
      order by c.on_date desc, c.session limit 7`);
    return {
      stay: stay
        ? { hostel: stay.hostel, room: stay.room, bedNo: stay.bedNo, since: stay.since }
        : null,
      roll: [...roll],
      outpasses: (await outpassRows(tx, deps, sql`o.student_person_id = ${studentId}`)).slice(
        0,
        10,
      ),
      collectors: (await pickupGuardians(tx, studentId))
        .filter((g) => !g.restricted)
        .map((g) => ({ personId: g.personId, name: g.name, relationship: g.relationship })),
    };
  });
}

export type HostelFigures = {
  residents: number;
  freeBeds: number;
  out: number;
  overdue: number;
  requested: number;
  absentLastRollCall: number;
};

async function figures(tx: Tx, institutionId: string): Promise<HostelFigures> {
  const on = await today(tx);
  const [f] = await tx.execute<HostelFigures>(sql`
    with hs as (select id from hostel where org_id = app_current_org() and institution_id = ${institutionId} and active)
    select
      (select count(*)::int from hostel_allocation where org_id = app_current_org() and hostel_id in (select id from hs)
        and valid_during @> ${on}::date) as residents,
      (select coalesce(sum(r.beds), 0)::int from hostel_room r where r.org_id = app_current_org() and r.active
        and r.hostel_id in (select id from hs))
      - (select count(*)::int from hostel_allocation a join hostel_room r on r.org_id = a.org_id and r.id = a.room_id
        where a.org_id = app_current_org() and r.active and a.hostel_id in (select id from hs)
          and a.valid_during @> ${on}::date) as "freeBeds",
      (select count(*)::int from hostel_outpass where org_id = app_current_org() and hostel_id in (select id from hs)
        and state = 'out') as out,
      (select count(*)::int from hostel_outpass where org_id = app_current_org() and hostel_id in (select id from hs)
        and state = 'out' and back_by < ${on}::date) as overdue,
      (select count(*)::int from hostel_outpass where org_id = app_current_org() and hostel_id in (select id from hs)
        and state = 'requested') as requested,
      (select count(*)::int from hostel_roll_mark m
        where m.org_id = app_current_org() and m.status = 'absent' and m.roll_call_id in (
          select distinct on (hostel_id) id from hostel_roll_call
          where org_id = app_current_org() and hostel_id in (select id from hs)
          order by hostel_id, on_date desc, taken_at desc)) as "absentLastRollCall"`);
  return (
    f ?? { residents: 0, freeBeds: 0, out: 0, overdue: 0, requested: 0, absentLastRollCall: 0 }
  );
}

export async function hostelFigures(deps: HostelDeps, actor: Actor, institutionId: string) {
  return reading(deps, actor, institutionId, (tx) => figures(tx, institutionId));
}

/** Residents as an audience: "Hostel: Boys hostel residents" for fee plans and notices. */
export const hostelAudience = {
  async groups(tx: Tx, institutionId: string): Promise<{ id: string; label: string }[]> {
    return [
      ...(await tx.execute<{ id: string; label: string }>(sql`
        select id::text, 'Hostel: ' || name || ' residents' as label from hostel
        where org_id = app_current_org() and institution_id = ${institutionId} and active order by name`)),
    ];
  },
  async students(
    tx: Tx,
    institutionId: string,
    groupIds: string[] | null,
    onDate: string,
  ): Promise<string[]> {
    if (!groupIds?.length) return [];
    const rows = await tx.execute<{ id: string }>(sql`
      select distinct a.student_person_id::text as id from hostel_allocation a
      join hostel h on h.org_id = a.org_id and h.id = a.hostel_id
      where a.org_id = app_current_org() and h.institution_id = ${institutionId}
        and a.hostel_id = any(${`{${groupIds.join(',')}}`}::uuid[]) and a.valid_during @> ${onDate}::date`);
    return rows.map((r) => r.id);
  },
};
