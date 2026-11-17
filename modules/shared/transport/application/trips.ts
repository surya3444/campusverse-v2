// Trips (Milestone 18 step 3): today's buses, the attendant's marks, and the empty-bus check.
// A trip is made when the attendant starts it (one per route per day). Marks come one tap at a
// time, often from a phone that was offline; each is accepted once by its device event id.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, type AcademicPlacementPort } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  MARKS,
  canClearEmpty,
  riderState,
  tripCounts,
  type Direction,
  type MarkKind,
  type RiderState,
  type TripCounts,
} from '../domain/trip.js';
import { vehicleReadiness } from '../domain/vehicle.js';
import { TransportError } from './setup.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements'>[];

export const TRANSPORT_TRIP_STARTED = 'transport.trip.started.v1';
export const TRANSPORT_STUDENT_MARKED = 'transport.student.marked.v1';
export const TRANSPORT_TRIP_ENDED = 'transport.trip.ended.v1';

/** Minutes after the last planned stop before the in-charge hears a trip hasn't been cleared. */
export const NOT_CLEARED_AFTER_MIN = 30;

export type TripInfo = {
  id: string;
  /** Times as the school reads them: "7:05 am". */
  startedAt: string;
  /** The same as "07:05" (and the end), for the Day Line. */
  startedHm: string;
  endedHm: string | null;
  startedBy: string;
  endedAt: string | null;
  checkOutcome: 'empty' | 'child_found' | null;
  overridden: boolean;
  /** The bus's last shared position (step 4): "7:12 am", minutes ago, and where. */
  lastSeen: { at: string; minutesAgo: number; lat: number; lng: number } | null;
  sos: { at: string; note: string | null } | null;
};

export type TodayTrip = {
  routeId: string;
  name: string;
  direction: Direction;
  vehicle: string | null;
  /** Fitness, insurance or permit missing or expired: starting needs a reason. */
  blocked: string[];
  firstAt: string | null;
  lastAt: string | null;
  riders: number;
  trip: TripInfo | null;
  counts: TripCounts;
};

export type SheetRider = {
  personId: string;
  name: string;
  label: string | null;
  state: RiderState;
  /** The parent said the child won't ride today. */
  skipping: boolean;
};
export type TripSheet = Omit<TodayTrip, 'counts' | 'riders'> & {
  date: string;
  marks: readonly MarkKind[];
  stops: { stopId: string; name: string; plannedAt: string; riders: SheetRider[] }[];
};

async function campusOf(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new TransportError('institution_not_found');
  return p;
}

type RouteRow = Omit<TodayTrip, 'trip' | 'counts' | 'blocked' | 'riders'> & {
  vehicleId: string | null;
};

/** Active routes on the campus with riders today, and today's trip for each. */
async function routesToday(tx: Tx, campusId: string, routeId: string | null, d: string) {
  const routes = await tx.execute<RouteRow>(sql`
    select r.id::text as "routeId", r.name, r.direction, r.vehicle_id::text as "vehicleId",
      v.registration as vehicle,
      (select to_char(min(planned_at), 'HH24:MI') from transport_route_stop s
        where s.org_id = r.org_id and s.route_id = r.id) as "firstAt",
      (select to_char(max(planned_at), 'HH24:MI') from transport_route_stop s
        where s.org_id = r.org_id and s.route_id = r.id) as "lastAt"
    from transport_route r
    left join transport_vehicle v on v.org_id = r.org_id and v.id = r.vehicle_id
    where r.org_id = app_current_org() and r.campus_id = ${campusId} and r.active
      and (${routeId}::uuid is null or r.id = ${routeId}::uuid)
    order by "firstAt" nulls last, r.name`);
  const trips = await tx.execute<TripInfo & { routeId: string; startedById: string }>(sql`
    select t.id::text, t.route_id::text as "routeId",
      to_char(t.started_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') as "startedAt",
      t.started_by_person_id::text as "startedById",
      to_char(t.started_at at time zone 'Asia/Kolkata', 'HH24:MI') as "startedHm",
      to_char(t.ended_at at time zone 'Asia/Kolkata', 'HH24:MI') as "endedHm",
      to_char(t.ended_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') as "endedAt",
      t.check_outcome as "checkOutcome", t.override_reason is not null as overridden,
      case when p.at is not null then json_build_object(
        'at', to_char(p.at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
        'minutesAgo', floor(extract(epoch from now() - p.at) / 60)::int,
        'lat', p.latitude::float8, 'lng', p.longitude::float8) end as "lastSeen",
      case when t.sos_at is not null then json_build_object(
        'at', to_char(t.sos_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'), 'note', t.sos_note) end as sos
    from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
    left join lateral (
      select at, latitude, longitude from transport_position
      where org_id = t.org_id and trip_id = t.id order by at desc limit 1) p on true
    where t.org_id = app_current_org() and r.campus_id = ${campusId} and t.trip_date = ${d}::date`);
  const riders = await tx.execute<{ routeId: string; personId: string; stopId: string }>(sql`
    select a.route_id::text as "routeId", a.person_id::text as "personId", a.stop_id::text as "stopId"
    from transport_assignment a join transport_route r on r.org_id = a.org_id and r.id = a.route_id
    where a.org_id = app_current_org() and r.campus_id = ${campusId} and a.valid_during @> ${d}::date`);
  const marks = await tx.execute<{
    tripId: string;
    personId: string;
    kind: MarkKind;
    at: string;
  }>(sql`
    select e.trip_id::text as "tripId", e.person_id::text as "personId", e.kind,
      e.occurred_at::text as at
    from transport_boarding_event e join transport_trip t on t.org_id = e.org_id and t.id = e.trip_id
    join transport_route r on r.org_id = t.org_id and r.id = t.route_id
    where e.org_id = app_current_org() and r.campus_id = ${campusId} and t.trip_date = ${d}::date`);
  const docs = await tx.execute<{ vehicleId: string; kind: string; validUntil: string }>(sql`
    select vehicle_id::text as "vehicleId", kind, valid_until::text as "validUntil"
    from transport_vehicle_document where org_id = app_current_org()
      and vehicle_id in (select vehicle_id from transport_route where org_id = app_current_org()
        and campus_id = ${campusId})`);
  const starters = await displayNames(tx, [...new Set(trips.map((t) => t.startedById))]);

  return routes
    .map((r) => {
      const t = trips.find((x) => x.routeId === r.routeId);
      const onRoute = riders.filter((x) => x.routeId === r.routeId);
      const stateOf = (personId: string): RiderState =>
        t
          ? riderState(marks.filter((m) => m.tripId === t.id && m.personId === personId))
          : 'expected';
      const { vehicleId, ...rest } = r;
      return {
        ...rest,
        blocked: vehicleId
          ? vehicleReadiness(
              docs.filter((x) => x.vehicleId === vehicleId),
              d,
            ).blocked
          : [],
        riders: onRoute.length,
        onRoute,
        stateOf,
        trip: t
          ? {
              id: t.id,
              startedAt: t.startedAt,
              startedBy: starters[t.startedById] ?? '',
              startedHm: t.startedHm,
              endedHm: t.endedHm,
              endedAt: t.endedAt,
              checkOutcome: t.checkOutcome,
              overridden: t.overridden,
              lastSeen: t.lastSeen,
              sos: t.sos,
            }
          : null,
      };
    })
    .filter((r) => r.riders > 0 || r.trip);
}

async function today(tx: Tx): Promise<string> {
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return r?.d ?? '';
}

type Place = { campusId: string; institutionId: string };

/**
 * The permission someone on the bus acts under: the attendant's, or else the driver's. Both may
 * start a trip and raise an SOS; only the attendant marks children and ends the trip.
 */
async function onBus(tx: Tx, permissions: Permissions, actor: Actor, place: Place) {
  const resource = { orgId: actor.orgId, place };
  if ((await permissions.can(tx, actor, 'transport.trip.attend', resource)).allowed)
    return 'transport.trip.attend';
  await permissions.assertCan(tx, actor, 'transport.trip.drive', resource);
  return 'transport.trip.drive';
}

/**
 * Every bus on the campus today: its trip (if started) and where its riders are. Drivers see it
 * too (counts only, never names), to pick their bus.
 */
export async function todayTrips(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  institutionId: string,
): Promise<TodayTrip[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await campusOf(tx, institutionId);
    const resource = { orgId: actor.orgId, place: where };
    if (!(await permissions.can(tx, actor, 'transport.trip.read', resource)).allowed)
      await permissions.assertCan(tx, actor, 'transport.trip.drive', resource);
    const rows = await routesToday(tx, where.campusId, null, await today(tx));
    return rows.map(({ onRoute, stateOf, ...r }) => ({
      ...r,
      counts: tripCounts(onRoute.map((x) => stateOf(x.personId))),
    }));
  });
}

/** The attendant's sheet for one route today: stops in order, each with its children. */
export async function tripSheet(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: { institutionId: string; routeId: string },
): Promise<TripSheet> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await campusOf(tx, input.institutionId);
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      place: where,
    });
    const d = await today(tx);
    const [r] = await routesToday(tx, where.campusId, input.routeId, d);
    if (!r) throw new TransportError('route_not_found');
    const { onRoute, stateOf, ...route } = r;
    const stops = await tx.execute<{ stopId: string; name: string; plannedAt: string }>(sql`
      select rs.stop_id::text as "stopId", s.name, to_char(rs.planned_at, 'HH24:MI') as "plannedAt"
      from transport_route_stop rs join transport_stop s on s.org_id = rs.org_id and s.id = rs.stop_id
      where rs.org_id = app_current_org() and rs.route_id = ${input.routeId} order by rs.seq`);
    const ids = onRoute.map((x) => x.personId);
    const names = await displayNames(tx, ids);
    const skips = new Set(
      (
        await tx.execute<{ personId: string }>(sql`
          select person_id::text as "personId" from transport_skip
          where org_id = app_current_org() and trip_date = ${d}::date
            and direction = ${route.direction} and cancelled_at is null`)
      ).map((x) => x.personId),
    );
    const labels = new Map<string, string>();
    for (const p of placements)
      for (const [id, v] of await p.getPlacements(tx, { personIds: ids, onDate: d }))
        labels.set(id, v.displayLabel);
    return {
      ...route,
      date: d,
      marks: MARKS[route.direction],
      stops: stops.map((s) => ({
        ...s,
        riders: onRoute
          .filter((x) => x.stopId === s.stopId)
          .map((x) => ({
            personId: x.personId,
            name: names[x.personId] ?? '',
            label: labels.get(x.personId) ?? null,
            state: stateOf(x.personId),
            skipping: skips.has(x.personId),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  });
}

/**
 * Starts today's trip on a route. Starting twice returns the same trip. A vehicle whose fitness,
 * insurance or permit is missing or expired runs only with a reason, which is audited.
 */
export async function startTrip(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; routeId: string; overrideReason?: string | undefined },
): Promise<{ id: string }> {
  const { where, existing, as } = await withTenant(db, actor.orgId, async (tx) => {
    const p = await campusOf(tx, input.institutionId);
    const as = await onBus(tx, permissions, actor, p);
    const [t] = await tx.execute<{ id: string; ended: boolean }>(sql`
      select id::text, ended_at is not null as ended from transport_trip
      where org_id = app_current_org() and route_id = ${input.routeId} and trip_date = app_today()`);
    return { where: p, existing: t, as };
  });
  if (existing?.ended) throw new TransportError('trip_ended');
  if (existing) return { id: existing.id };
  return command(
    db,
    permissions,
    actor,
    { permission: as, resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const d = await today(tx);
      const [r] = await routesToday(tx, where.campusId, input.routeId, d);
      if (!r) throw new TransportError('route_not_found');
      const reason = input.overrideReason?.trim() || null;
      if (r.blocked.length > 0 && !reason) throw new TransportError('vehicle_not_ready');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into transport_trip (org_id, route_id, direction, trip_date, vehicle_id,
          started_by_person_id, override_reason)
        select app_current_org(), id, direction, ${d}::date, vehicle_id, ${actor.personId},
          ${r.blocked.length > 0 ? reason : null}
        from transport_route where org_id = app_current_org() and id = ${input.routeId}
        returning id::text`);
      const id = row?.id ?? '';
      // When to check the bus was cleared: 30 minutes after the last planned stop, and never
      // sooner than the route's length plus 30 minutes from now (a trip that starts late).
      const [due] = await tx.execute<{ ms: number }>(sql`
        select extract(epoch from greatest(
          ((app_today() + max(planned_at)) at time zone 'Asia/Kolkata'),
          now() + (max(planned_at) - min(planned_at))
        ) + make_interval(mins => ${NOT_CLEARED_AFTER_MIN}) - now())::float8 * 1000 as ms
        from transport_route_stop where org_id = app_current_org() and route_id = ${input.routeId}`);
      return {
        result: { id },
        audit: {
          action: 'transport.trip.start',
          entityType: 'transport_trip',
          entityId: id,
          dataClass: 'operational',
          detail: {
            routeId: input.routeId,
            ...(r.blocked.length > 0
              ? { blocked: r.blocked.join(', '), overrideReason: reason }
              : {}),
          },
        },
        events: [
          {
            type: TRANSPORT_TRIP_STARTED,
            payload: {
              tripId: id,
              routeId: input.routeId,
              campusId: where.campusId,
              checkInMs: Math.max(0, Math.round(due?.ms ?? NOT_CLEARED_AFTER_MIN * 60_000)),
            },
          },
        ],
      };
    },
  );
}

export type MarkInput = {
  institutionId: string;
  eventId: string;
  deviceId: string;
  occurredAt: string;
  tripId: string;
  personId: string;
  kind: MarkKind;
  stopId?: string | null | undefined;
};

/**
 * One tap of the attendant. Accepted once per event id (a resend says "duplicate"). The child
 * must ride this route today; the mark must fit the trip's direction; a mark made after the
 * trip ended is refused, while marks queued offline before it ended still count.
 */
export async function recordMark(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: MarkInput,
): Promise<{ outcome: 'accepted' | 'duplicate' }> {
  const found = await withTenant(db, actor.orgId, async (tx) => {
    const where = await campusOf(tx, input.institutionId);
    const [seen] = await tx.execute(sql`
      select 1 from transport_boarding_event where org_id = app_current_org() and id = ${input.eventId}`);
    if (seen) return null;
    const [t] = await tx.execute<{
      direction: Direction;
      routeId: string;
      tripDate: string;
      late: boolean;
    }>(sql`
      select t.direction, t.route_id::text as "routeId", t.trip_date::text as "tripDate",
        coalesce(${input.occurredAt}::timestamptz > t.ended_at, false) as late
      from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
      where t.org_id = app_current_org() and t.id = ${input.tripId} and r.campus_id = ${where.campusId}`);
    if (!t) throw new TransportError('trip_not_found');
    return { where, trip: t };
  });
  if (!found) return { outcome: 'duplicate' };
  const { where, trip } = found;
  if (!MARKS[trip.direction].includes(input.kind)) throw new TransportError('wrong_mark');
  if (trip.late) throw new TransportError('trip_ended');
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.trip.attend', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [rides] = await tx.execute<{ stopId: string }>(sql`
        select stop_id::text as "stopId" from transport_assignment
        where org_id = app_current_org() and person_id = ${input.personId}
          and route_id = ${trip.routeId} and valid_during @> ${trip.tripDate}::date`);
      if (!rides) throw new TransportError('not_on_route');
      // Two requests racing with one event id: the primary key refuses the second, and the
      // device's resend is then answered "duplicate".
      await tx.execute(sql`
        insert into transport_boarding_event (org_id, id, trip_id, person_id, kind, stop_id,
          occurred_at, by_person_id, device_id)
        values (app_current_org(), ${input.eventId}, ${input.tripId}, ${input.personId}, ${input.kind},
          ${input.stopId ?? (input.kind === 'handed_to_school' ? null : rides.stopId)},
          ${input.occurredAt}::timestamptz, ${actor.personId}, ${input.deviceId})`);
      return {
        result: { outcome: 'accepted' as const },
        audit: {
          action: 'transport.trip.mark',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          detail: { tripId: input.tripId, kind: input.kind },
        },
        events: [
          {
            type: TRANSPORT_STUDENT_MARKED,
            payload: {
              eventId: input.eventId,
              tripId: input.tripId,
              personId: input.personId,
              kind: input.kind,
              campusId: where.campusId,
            },
          },
        ],
      };
    },
  );
}

/**
 * Ends the trip with the empty-bus check. "Bus is empty" is refused while the marks still show a
 * child on board; "child found" always ends it and alerts the in-charge at once.
 */
export async function endTrip(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    tripId: string;
    outcome: 'empty' | 'child_found';
    note?: string | undefined;
  },
): Promise<void> {
  const where = await withTenant(db, actor.orgId, (tx) => campusOf(tx, input.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'transport.trip.attend', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [t] = await tx.execute<{ routeId: string; endedAt: string | null }>(sql`
        select t.route_id::text as "routeId", t.ended_at::text as "endedAt"
        from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
        where t.org_id = app_current_org() and t.id = ${input.tripId} and r.campus_id = ${where.campusId}
        for update of t`);
      if (!t) throw new TransportError('trip_not_found');
      if (t.endedAt) throw new TransportError('trip_ended');
      const note = input.note?.trim() || null;
      if (input.outcome === 'child_found' && !note) throw new TransportError('note_required');
      if (input.outcome === 'empty') {
        const [r] = await routesToday(tx, where.campusId, t.routeId, await today(tx));
        const states = r?.onRoute.map((x) => r.stateOf(x.personId)) ?? [];
        if (!canClearEmpty(states)) throw new TransportError('riders_on_board');
      }
      await tx.execute(sql`
        update transport_trip set ended_at = now(), ended_by_person_id = ${actor.personId},
          check_outcome = ${input.outcome}, check_note = ${note}
        where org_id = app_current_org() and id = ${input.tripId}`);
      return {
        result: undefined,
        audit: {
          action: 'transport.trip.end',
          entityType: 'transport_trip',
          entityId: input.tripId,
          dataClass: 'operational',
          detail: { outcome: input.outcome },
        },
        events: [
          {
            type: TRANSPORT_TRIP_ENDED,
            payload: {
              tripId: input.tripId,
              campusId: where.campusId,
              outcome: input.outcome,
              note,
            },
          },
        ],
      };
    },
  );
}

export type MarkSync = {
  eventId: string;
  deviceId: string;
  actorId: string;
  occurredAt: string;
  payload: Omit<MarkInput, 'eventId' | 'deviceId' | 'occurredAt'>;
};

/** The attendant's queued taps from the offline sync batch. Every answer is final for its event. */
export async function acceptMarks(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  events: MarkSync[],
): Promise<{ eventId: string; outcome: 'accepted' | 'duplicate' | 'rejected'; code?: string }[]> {
  const results = [];
  for (const e of events) {
    if (e.actorId !== actor.personId) {
      results.push({ eventId: e.eventId, outcome: 'rejected' as const, code: 'other_actor' });
      continue;
    }
    try {
      const r = await recordMark(db, permissions, actor, {
        ...e.payload,
        eventId: e.eventId,
        deviceId: e.deviceId,
        occurredAt: e.occurredAt,
      });
      results.push({ eventId: e.eventId, ...r });
    } catch (err) {
      const code =
        err instanceof TransportError
          ? err.code
          : err instanceof PermissionDenied
            ? 'forbidden'
            : null;
      if (!code) throw err;
      results.push({ eventId: e.eventId, outcome: 'rejected' as const, code });
    }
  }
  return results;
}
