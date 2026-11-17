// The parent's view (Milestone 18 step 5): their own child's bus today, and "not taking the bus
// today". A parent sees the bus's position only while their child's trip runs, never other
// children and never the bus outside a trip. ETA is planned stop times shifted by how late the
// trip started (decision 4: no maps routing).
import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { AcademicPlacementPort } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import type { Direction, MarkKind } from '../domain/trip.js';
import { TransportError } from './setup.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements'>[];

export const TRANSPORT_RIDE_SKIPPED = 'transport.ride.skipped.v1';

export type ChildBus = {
  direction: Direction;
  route: string;
  stop: string;
  /** Planned time at the child's stop, "07:25". */
  stopAt: string;
  /** The parent said the child won't ride today. */
  skipping: boolean;
  trip: { running: boolean; startedAt: string } | null;
  /** The child's latest mark today, with the time ("7:12 am"). */
  mark: { kind: MarkKind; at: string } | null;
  /** Minutes to the child's stop, while the bus is on its way there. */
  etaMin: number | null;
  /** Only while the trip runs. */
  bus: { lat: number; lng: number; at: string; minutesAgo: number } | null;
};

/** Where the child studies today, for the permission check (scope plus guardian relation). */
async function childPlace(tx: Tx, placements: Placements, studentId: string) {
  const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  for (const p of placements) {
    const found = (await p.getPlacements(tx, { personIds: [studentId], onDate: d?.d ?? '' })).get(
      studentId,
    );
    if (found) return placeOf(tx, found.institutionId);
  }
  return null;
}

/** The child's bus today, per direction they ride. Empty when they don't take the bus. */
export async function childBus(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  studentId: string,
): Promise<ChildBus[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    const place = await childPlace(tx, placements, studentId);
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      ...(place ? { place } : {}),
      subjectPersonId: studentId,
    });
    return [
      ...(await tx.execute<ChildBus>(sql`
        select a.direction, r.name as route, s.name as stop,
          to_char(rs.planned_at, 'HH24:MI') as "stopAt",
          exists (select 1 from transport_skip k where k.org_id = a.org_id and k.person_id = a.person_id
            and k.trip_date = app_today() and k.direction = a.direction and k.cancelled_at is null) as skipping,
          case when t.id is not null then json_build_object(
            'running', t.ended_at is null,
            'startedAt', to_char(t.started_at at time zone 'Asia/Kolkata', 'FMHH12:MI am')) end as trip,
          case when m.kind is not null then json_build_object(
            'kind', m.kind,
            'at', to_char(m.occurred_at at time zone 'Asia/Kolkata', 'FMHH12:MI am')) end as mark,
          -- On the way to the child's stop: pickup before boarding, drop after boarding.
          case when t.ended_at is null and t.id is not null and (
              (a.direction = 'pickup' and m.kind is null)
              or (a.direction = 'drop' and m.kind = 'boarded'))
            then greatest(0, floor(extract(epoch from
              (app_today() + rs.planned_at) at time zone 'Asia/Kolkata'
              + (t.started_at - (app_today() + first.at) at time zone 'Asia/Kolkata')
              - now()) / 60))::int end as "etaMin",
          case when t.ended_at is null and p.at is not null then json_build_object(
            'lat', p.latitude::float8, 'lng', p.longitude::float8,
            'at', to_char(p.at at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
            'minutesAgo', floor(extract(epoch from now() - p.at) / 60)::int) end as bus
        from transport_assignment a
        join transport_route r on r.org_id = a.org_id and r.id = a.route_id
        join transport_stop s on s.org_id = a.org_id and s.id = a.stop_id
        join transport_route_stop rs on rs.org_id = a.org_id and rs.route_id = a.route_id
          and rs.stop_id = a.stop_id
        cross join lateral (select min(planned_at) as at from transport_route_stop
          where org_id = a.org_id and route_id = a.route_id) first
        left join transport_trip t on t.org_id = a.org_id and t.route_id = a.route_id
          and t.trip_date = app_today()
        left join lateral (select kind, occurred_at from transport_boarding_event
          where org_id = a.org_id and trip_id = t.id and person_id = a.person_id
          order by occurred_at desc limit 1) m on true
        left join lateral (select at, latitude, longitude from transport_position
          where org_id = a.org_id and trip_id = t.id order by at desc limit 1) p on true
        where a.org_id = app_current_org() and a.person_id = ${studentId}
          and a.valid_during @> app_today()
        order by a.direction desc`)),
    ];
  });
}

/**
 * "Not taking the bus today" (or on a later day): one row per direction the child rides. Telling
 * twice changes nothing. The attendant sees it on the stop's list, and no "not on the bus"
 * alert goes out.
 */
export async function skipRide(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: { studentId: string; date: string; cancel?: boolean | undefined },
): Promise<void> {
  const place = await withTenant(db, actor.orgId, (tx) =>
    childPlace(tx, placements, input.studentId),
  );
  if (!place) throw new TransportError('not_a_student');
  await command(
    db,
    permissions,
    actor,
    {
      permission: 'transport.ride.skip',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.studentId },
    },
    async (tx) => {
      const [ok] = await tx.execute<{ fine: boolean }>(sql`
        select ${input.date}::date between app_today() and app_today() + 30 as fine`);
      if (!ok?.fine) throw new TransportError('bad_date');
      const rows = input.cancel
        ? await tx.execute(sql`
            update transport_skip set cancelled_at = now()
            where org_id = app_current_org() and person_id = ${input.studentId}
              and trip_date = ${input.date}::date and cancelled_at is null
            returning id`)
        : await tx.execute(sql`
            insert into transport_skip (org_id, person_id, trip_date, direction, requested_by_person_id)
            select distinct app_current_org(), person_id, ${input.date}::date, direction, ${actor.personId}::uuid
            from transport_assignment
            where org_id = app_current_org() and person_id = ${input.studentId}
              and valid_during @> ${input.date}::date
            on conflict do nothing returning id`);
      return {
        result: undefined,
        audit: {
          action: input.cancel ? 'transport.ride.skip_cancel' : 'transport.ride.skip',
          entityType: 'person',
          entityId: input.studentId,
          dataClass: 'personal',
          detail: { date: input.date, rows: rows.length },
        },
        events: [
          {
            type: TRANSPORT_RIDE_SKIPPED,
            payload: { personId: input.studentId, date: input.date, cancelled: !!input.cancel },
          },
        ],
      };
    },
  );
}
