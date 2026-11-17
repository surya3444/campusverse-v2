// Transport setup (Milestone 18 step 1): vehicles and their papers, stops, routes. Everything
// belongs to a campus; callers name an institution (the screen's scope) and we use its campus,
// so one bus can serve every institution on that campus.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import { checksFailing, memberKind, REQUIRED_CHECKS, staffAt } from '@campusverse/people-records';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  checkStops,
  normaliseRegistration,
  vehicleReadiness,
  type DocumentKind,
  type Readiness,
  type RouteStopInput,
} from '../domain/vehicle.js';

type Permissions = ReturnType<typeof createPermissions>;
type Place = { campusId: string; institutionId: string };

export const TRANSPORT_VEHICLE_SAVED = 'transport.vehicle.saved.v1';
export const TRANSPORT_ROUTE_SAVED = 'transport.route.saved.v1';

export class TransportError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'vehicle_not_found'
      | 'stop_not_found'
      | 'route_not_found'
      | 'invalid_registration'
      | 'registration_taken'
      | 'name_taken'
      | 'no_stops'
      | 'stop_repeated'
      | 'times_out_of_order'
      | 'assignment_not_found'
      | 'stop_not_on_route'
      | 'not_a_student'
      | 'stop_has_riders'
      | 'route_has_riders'
      | 'trip_not_found'
      | 'trip_ended'
      | 'vehicle_not_ready'
      | 'wrong_mark'
      | 'not_on_route'
      | 'note_required'
      | 'riders_on_board'
      | 'bad_date'
      | 'not_staff'
      | 'same_person'
      | 'crew_checks',
    /** For crew_checks: who on the crew, and which safety checks are missing or expired. */
    readonly details: { crew: 'driver' | 'attendant'; checks: string[] } | null = null,
  ) {
    super(`transport: ${code}`);
    this.name = 'TransportError';
  }
}

async function placeFor(db: Db, actor: Actor, institutionId: string): Promise<Place> {
  const p = await withTenant(db, actor.orgId, (tx) => placeOf(tx, institutionId));
  if (!p) throw new TransportError('institution_not_found');
  return p;
}

export type Vehicle = {
  id: string;
  registration: string;
  kind: 'bus' | 'van' | 'auto';
  seats: number;
  ownedBy: 'school' | 'contractor';
  contractorName: string | null;
  active: boolean;
} & Readiness;

export type Stop = {
  id: string;
  name: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  fareZone: number | null;
  active: boolean;
};

export type Route = {
  id: string;
  name: string;
  direction: 'pickup' | 'drop';
  vehicleId: string | null;
  /** The usual driver and attendant (staff of the school): suggestions for each trip, not access. */
  driverPersonId: string | null;
  attendantPersonId: string | null;
  active: boolean;
  stops: (RouteStopInput & { seq: number })[];
};

/** Staff of the school who can be a route's crew, with whether their roles let them drive or attend. */
export type CrewMember = {
  personId: string;
  name: string;
  designation: string | null;
  canDrive: boolean;
  canAttend: boolean;
  /** Safety checks missing or expired for driving, and for attending (empty when ready). */
  driverChecksMissing: string[];
  attendantChecksMissing: string[];
};

export type TransportSetup = {
  vehicles: Vehicle[];
  stops: Stop[];
  routes: Route[];
  crew: CrewMember[];
  /** Fare zones in use on the campus (each can carry its own fee). */
  zones: { id: string; number: number }[];
};

/** Everything on the campus's transport screens in one read (a campus has tens of rows, not thousands). */
export async function transportSetup(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<TransportSetup> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await placeOf(tx, institutionId);
    if (!where) throw new TransportError('institution_not_found');
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      place: where,
    });
    const [today] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const docs = await tx.execute<{ vehicleId: string; kind: string; validUntil: string }>(sql`
      select d.vehicle_id::text as "vehicleId", d.kind, d.valid_until::text as "validUntil"
      from transport_vehicle_document d join transport_vehicle v on v.org_id = d.org_id and v.id = d.vehicle_id
      where d.org_id = app_current_org() and v.campus_id = ${where.campusId}`);
    const vehicles = await tx.execute<Omit<Vehicle, keyof Readiness>>(sql`
      select id::text, registration, kind, seats, owned_by as "ownedBy", contractor_name as "contractorName", active
      from transport_vehicle where org_id = app_current_org() and campus_id = ${where.campusId}
      order by active desc, registration`);
    const stops = await tx.execute<Stop>(sql`
      select id::text, name, landmark, latitude::float8 as latitude, longitude::float8 as longitude,
        fare_zone as "fareZone", active
      from transport_stop where org_id = app_current_org() and campus_id = ${where.campusId}
      order by active desc, name`);
    const routes = await tx.execute<Omit<Route, 'stops'>>(sql`
      select id::text, name, direction, vehicle_id::text as "vehicleId",
        driver_person_id::text as "driverPersonId", attendant_person_id::text as "attendantPersonId", active
      from transport_route where org_id = app_current_org() and campus_id = ${where.campusId}
      order by active desc, name, direction`);
    const routeStops = await tx.execute<Route['stops'][number] & { routeId: string }>(sql`
      select rs.route_id::text as "routeId", rs.seq, rs.stop_id::text as "stopId",
        to_char(rs.planned_at, 'HH24:MI') as "plannedAt"
      from transport_route_stop rs join transport_route r on r.org_id = rs.org_id and r.id = rs.route_id
      where rs.org_id = app_current_org() and r.campus_id = ${where.campusId}
      order by rs.route_id, rs.seq`);
    // Crew pickers: today's staff of the school. Whether each may drive or attend comes from their
    // own roles, read through the permission service (so transport never reads role tables).
    const staff = await staffAt(tx, institutionId, today?.d ?? '');
    const crew: CrewMember[] = [];
    for (const m of staff) {
      const who = { accountId: '', orgId: actor.orgId, personId: m.personId };
      const res = { orgId: actor.orgId, place: where };
      crew.push({
        personId: m.personId,
        name: m.name,
        designation: m.designation,
        canDrive: (await permissions.can(tx, who, 'transport.trip.drive', res)).allowed,
        canAttend: (await permissions.can(tx, who, 'transport.trip.attend', res)).allowed,
        driverChecksMissing: await checksFailing(tx, m.personId, REQUIRED_CHECKS.driver ?? []),
        attendantChecksMissing: await checksFailing(
          tx,
          m.personId,
          REQUIRED_CHECKS.bus_attendant ?? [],
        ),
      });
    }
    const zones = await tx.execute<{ id: string; number: number }>(sql`
      select id::text, number from transport_fare_zone
      where org_id = app_current_org() and campus_id = ${where.campusId} order by number`);
    return {
      crew,
      zones: [...zones],
      vehicles: vehicles.map((v) => ({
        ...v,
        ...vehicleReadiness(
          docs.filter((d) => d.vehicleId === v.id),
          today?.d ?? '',
        ),
      })),
      stops: [...stops],
      routes: routes.map((r) => ({
        ...r,
        stops: routeStops
          .filter((s) => s.routeId === r.id)
          .map(({ seq, stopId, plannedAt }) => ({ seq, stopId, plannedAt })),
      })),
    };
  });
}

async function onCampus(tx: Tx, table: 'vehicle' | 'stop' | 'route', id: string, campusId: string) {
  const [row] = await tx.execute(sql`
    select 1 from ${sql.raw(`transport_${table}`)}
    where org_id = app_current_org() and id = ${id} and campus_id = ${campusId}`);
  if (!row) throw new TransportError(`${table}_not_found`);
}

export type VehicleInput = {
  institutionId: string;
  id?: string | undefined;
  registration: string;
  kind: Vehicle['kind'];
  seats: number;
  ownedBy: Vehicle['ownedBy'];
  contractorName?: string | null | undefined;
  active: boolean;
};

/** Adds a vehicle, or changes one (registration numbers are unique across the organisation). */
export async function saveVehicle(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: VehicleInput,
): Promise<{ id: string }> {
  const registration = normaliseRegistration(input.registration);
  if (!registration) throw new TransportError('invalid_registration');
  const where = await placeFor(db, actor, input.institutionId);
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.vehicle.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      if (input.id) await onCampus(tx, 'vehicle', input.id, where.campusId);
      const [taken] = await tx.execute(sql`
        select 1 from transport_vehicle where org_id = app_current_org() and registration = ${registration}
          and id is distinct from ${input.id ?? null}::uuid`);
      if (taken) throw new TransportError('registration_taken');
      const contractor =
        input.ownedBy === 'contractor' ? input.contractorName?.trim() || null : null;
      const [row] = await tx.execute<{ id: string }>(
        input.id
          ? sql`
            update transport_vehicle set registration = ${registration}, kind = ${input.kind}, seats = ${input.seats},
              owned_by = ${input.ownedBy}, contractor_name = ${contractor}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`
          : sql`
            insert into transport_vehicle (org_id, campus_id, registration, kind, seats, owned_by, contractor_name, active)
            values (app_current_org(), ${where.campusId}, ${registration}, ${input.kind}, ${input.seats},
              ${input.ownedBy}, ${contractor}, ${input.active})
            returning id::text`,
      );
      const id = row?.id ?? '';
      return {
        result: { id },
        audit: {
          action: input.id ? 'transport.vehicle.update' : 'transport.vehicle.create',
          entityType: 'transport_vehicle',
          entityId: id,
          dataClass: 'operational',
          detail: { kind: input.kind, seats: input.seats, active: input.active },
        },
        events: [
          { type: TRANSPORT_VEHICLE_SAVED, payload: { vehicleId: id, campusId: where.campusId } },
        ],
      };
    },
  );
}

/** Records a vehicle document or its renewal. Earlier ones stay; the one valid longest counts. */
export async function addVehicleDocument(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    vehicleId: string;
    kind: DocumentKind;
    number?: string | null | undefined;
    validUntil: string;
    fileId?: string | null | undefined;
  },
): Promise<void> {
  const where = await placeFor(db, actor, input.institutionId);
  await command(
    db,
    permissions,
    actor,
    { permission: 'transport.vehicle.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      await onCampus(tx, 'vehicle', input.vehicleId, where.campusId);
      await tx.execute(sql`
        insert into transport_vehicle_document (org_id, vehicle_id, kind, number, valid_until, file_id,
          recorded_by_person_id)
        values (app_current_org(), ${input.vehicleId}, ${input.kind}, ${input.number?.trim() || null},
          ${input.validUntil}::date, ${input.fileId ?? null}, ${actor.personId})`);
      return {
        result: undefined,
        audit: {
          action: 'transport.vehicle.document_add',
          entityType: 'transport_vehicle',
          entityId: input.vehicleId,
          dataClass: 'operational',
          detail: { kind: input.kind, validUntil: input.validUntil },
        },
        events: [
          {
            type: TRANSPORT_VEHICLE_SAVED,
            payload: { vehicleId: input.vehicleId, campusId: where.campusId },
          },
        ],
      };
    },
  );
}

export type StopInput = {
  institutionId: string;
  id?: string | undefined;
  name: string;
  landmark?: string | null | undefined;
  location?: { lat: number; lng: number } | null | undefined;
  fareZone?: number | null | undefined;
  active: boolean;
};

export async function saveStop(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: StopInput,
): Promise<{ id: string }> {
  const where = await placeFor(db, actor, input.institutionId);
  const name = input.name.trim();
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.route.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      if (input.id) await onCampus(tx, 'stop', input.id, where.campusId);
      const [taken] = await tx.execute(sql`
        select 1 from transport_stop where org_id = app_current_org() and campus_id = ${where.campusId}
          and lower(name) = lower(${name}) and id is distinct from ${input.id ?? null}::uuid`);
      if (taken) throw new TransportError('name_taken');
      const v = {
        landmark: input.landmark?.trim() || null,
        lat: input.location?.lat ?? null,
        lng: input.location?.lng ?? null,
        zone: input.fareZone ?? null,
      };
      const [row] = await tx.execute<{ id: string }>(
        input.id
          ? sql`
            update transport_stop set name = ${name}, landmark = ${v.landmark}, latitude = ${v.lat},
              longitude = ${v.lng}, fare_zone = ${v.zone}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`
          : sql`
            insert into transport_stop (org_id, campus_id, name, landmark, latitude, longitude, fare_zone, active)
            values (app_current_org(), ${where.campusId}, ${name}, ${v.landmark}, ${v.lat}, ${v.lng}, ${v.zone},
              ${input.active})
            returning id::text`,
      );
      const id = row?.id ?? '';
      if (v.zone !== null)
        await tx.execute(sql`
          insert into transport_fare_zone (org_id, campus_id, number)
          values (app_current_org(), ${where.campusId}, ${v.zone}) on conflict do nothing`);
      return {
        result: { id },
        audit: {
          action: input.id ? 'transport.stop.update' : 'transport.stop.create',
          entityType: 'transport_stop',
          entityId: id,
          dataClass: 'operational',
          detail: { fareZone: v.zone, active: input.active },
        },
        events: [],
      };
    },
  );
}

export type RouteInput = {
  institutionId: string;
  id?: string | undefined;
  name: string;
  direction: Route['direction'];
  vehicleId?: string | null | undefined;
  driverPersonId?: string | null | undefined;
  attendantPersonId?: string | null | undefined;
  active: boolean;
  stops: RouteStopInput[];
};

/** A route's crew must be staff of the school today, and two different people. */
/**
 * The crew must be on staff, and no child rides with a driver or attendant whose safety checks
 * (licence, police verification, medical fitness) are missing or expired.
 */
async function checkCrew(
  tx: Tx,
  institutionId: string,
  crew: { driver: string | null; attendant: string | null },
  /** The crew already on the route: their papers were checked when they joined it. */
  before: { driver: string | null; attendant: string | null } | undefined,
) {
  const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  const given = [crew.driver, crew.attendant].filter((x): x is string => !!x);
  if (new Set(given).size !== given.length) throw new TransportError('same_person');
  for (const personId of given)
    if ((await memberKind(tx, { institutionId, personId, onDate: d?.d ?? '' })) !== 'staff')
      throw new TransportError('not_staff');
  for (const [who, personId, role] of [
    ['driver', crew.driver, 'driver'],
    ['attendant', crew.attendant, 'bus_attendant'],
  ] as const) {
    if (!personId || personId === before?.[who]) continue;
    const failing = await checksFailing(tx, personId, REQUIRED_CHECKS[role] ?? []);
    if (failing.length > 0) throw new TransportError('crew_checks', { crew: who, checks: failing });
  }
}

/** Adds or changes a route; its stops are replaced in the order given. */
export async function saveRoute(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: RouteInput,
): Promise<{ id: string }> {
  const problem = checkStops(input.stops);
  if (problem) throw new TransportError(problem);
  const where = await placeFor(db, actor, input.institutionId);
  const name = input.name.trim();
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.route.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      if (input.id) await onCampus(tx, 'route', input.id, where.campusId);
      if (input.vehicleId) await onCampus(tx, 'vehicle', input.vehicleId, where.campusId);
      for (const s of input.stops) await onCampus(tx, 'stop', s.stopId, where.campusId);
      const driverId = input.driverPersonId ?? null;
      const attendantId = input.attendantPersonId ?? null;
      // Only a change of crew is checked, so a route keeps saving while papers are renewed.
      const [before] = input.id
        ? await tx.execute<{ driver: string | null; attendant: string | null }>(sql`
            select driver_person_id::text as driver, attendant_person_id::text as attendant
            from transport_route where org_id = app_current_org() and id = ${input.id}`)
        : [];
      await checkCrew(
        tx,
        input.institutionId,
        { driver: driverId, attendant: attendantId },
        before,
      );
      const [taken] = await tx.execute(sql`
        select 1 from transport_route where org_id = app_current_org() and campus_id = ${where.campusId}
          and lower(name) = lower(${name}) and direction = ${input.direction}
          and id is distinct from ${input.id ?? null}::uuid`);
      if (taken) throw new TransportError('name_taken');
      if (input.id) {
        // Riders today or later keep their route's direction and their stop.
        const riders = await tx.execute<{ stopId: string; direction: string }>(sql`
          select distinct stop_id::text as "stopId", direction from transport_assignment
          where org_id = app_current_org() and route_id = ${input.id} and not isempty(valid_during)
            and (upper_inf(valid_during) or upper(valid_during) > app_today())`);
        if (riders.some((r) => r.direction !== input.direction))
          throw new TransportError('route_has_riders');
        const kept = new Set(input.stops.map((x) => x.stopId));
        if (riders.some((r) => !kept.has(r.stopId))) throw new TransportError('stop_has_riders');
      }
      const vehicleId = input.vehicleId ?? null;
      const [row] = await tx.execute<{ id: string }>(
        input.id
          ? sql`
            update transport_route set name = ${name}, direction = ${input.direction}, vehicle_id = ${vehicleId},
              driver_person_id = ${driverId}, attendant_person_id = ${attendantId}, active = ${input.active}
            where org_id = app_current_org() and id = ${input.id} returning id::text`
          : sql`
            insert into transport_route (org_id, campus_id, name, direction, vehicle_id, driver_person_id,
              attendant_person_id, active)
            values (app_current_org(), ${where.campusId}, ${name}, ${input.direction}, ${vehicleId}, ${driverId},
              ${attendantId}, ${input.active})
            returning id::text`,
      );
      const id = row?.id ?? '';
      await tx.execute(sql`
        delete from transport_route_stop where org_id = app_current_org() and route_id = ${id}`);
      for (const [i, s] of input.stops.entries())
        await tx.execute(sql`
          insert into transport_route_stop (org_id, route_id, seq, stop_id, planned_at)
          values (app_current_org(), ${id}, ${i + 1}, ${s.stopId}, ${s.plannedAt}::time)`);
      return {
        result: { id },
        audit: {
          action: input.id ? 'transport.route.update' : 'transport.route.create',
          entityType: 'transport_route',
          entityId: id,
          dataClass: 'operational',
          detail: {
            direction: input.direction,
            stops: input.stops.length,
            active: input.active,
            driverPersonId: driverId,
            attendantPersonId: attendantId,
          },
        },
        events: [
          { type: TRANSPORT_ROUTE_SAVED, payload: { routeId: id, campusId: where.campusId } },
        ],
      };
    },
  );
}

/** Routes where a staff member is the usual driver or attendant, for their staff record. */
export async function crewDuty(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<
  {
    routeId: string;
    name: string;
    direction: Route['direction'];
    as: 'driver' | 'attendant';
    vehicle: string | null;
  }[]
> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await placeOf(tx, input.institutionId);
    if (!where) throw new TransportError('institution_not_found');
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      place: where,
    });
    return [
      ...(await tx.execute<{
        routeId: string;
        name: string;
        direction: Route['direction'];
        as: 'driver' | 'attendant';
        vehicle: string | null;
      }>(sql`
        select r.id::text as "routeId", r.name, r.direction,
          case when r.driver_person_id = ${input.personId} then 'driver' else 'attendant' end as as,
          v.registration as vehicle
        from transport_route r
        left join transport_vehicle v on v.org_id = r.org_id and v.id = r.vehicle_id
        where r.org_id = app_current_org() and r.campus_id = ${where.campusId} and r.active
          and (r.driver_person_id = ${input.personId} or r.attendant_person_id = ${input.personId})
        order by r.name, r.direction`)),
    ];
  });
}
