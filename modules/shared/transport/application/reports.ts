// Transport reports (Milestone 18 step 6): the day's boarding log and a month's ridership. The
// papers list needs no read of its own: transportSetup already carries each document's status.
import { withTenant, type Db } from '@campusverse/db';
import { displayNames, type AcademicPlacementPort } from '@campusverse/people-records';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import type { MarkKind } from '../domain/trip.js';
import { TransportError } from './setup.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements'>[];

export type BoardingRow = {
  route: string;
  direction: 'pickup' | 'drop';
  personId: string;
  name: string;
  label: string | null;
  reference: string | null;
  kind: MarkKind;
  /** "07:12" in India time. */
  at: string;
  stop: string | null;
  by: string;
};

export type BoardingLog = {
  date: string;
  trips: {
    route: string;
    direction: 'pickup' | 'drop';
    startedAt: string;
    endedAt: string | null;
    checkOutcome: 'empty' | 'child_found' | null;
    checkNote: string | null;
    overrideReason: string | null;
    sosNote: string | null;
    sosAt: string | null;
  }[];
  marks: BoardingRow[];
};

export type RidershipRow = {
  route: string;
  direction: 'pickup' | 'drop';
  /** Children on the route on any day of the month. */
  riders: number;
  /** Days a trip ran. */
  tripDays: number;
  boarded: number;
  notBoarded: number;
  /** Trips ended because a child was found on the bus. */
  childFound: number;
};

async function readable(db: Db, permissions: Permissions, actor: Actor, institutionId: string) {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await placeOf(tx, institutionId);
    if (!where) throw new TransportError('institution_not_found');
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      place: where,
    });
    return where;
  });
}

/** Every trip on the campus that day and every tap, in time order. */
export async function boardingLog(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: { institutionId: string; date: string },
): Promise<BoardingLog> {
  const where = await readable(db, permissions, actor, input.institutionId);
  return withTenant(db, actor.orgId, async (tx) => {
    const hm = (col: string) => sql.raw(`to_char(${col} at time zone 'Asia/Kolkata', 'HH24:MI')`);
    const trips = await tx.execute<BoardingLog['trips'][number]>(sql`
      select r.name as route, t.direction, ${hm('t.started_at')} as "startedAt",
        ${hm('t.ended_at')} as "endedAt", t.check_outcome as "checkOutcome", t.check_note as "checkNote",
        t.override_reason as "overrideReason", t.sos_note as "sosNote", ${hm('t.sos_at')} as "sosAt"
      from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
      where t.org_id = app_current_org() and r.campus_id = ${where.campusId}
        and t.trip_date = ${input.date}::date
      order by t.started_at`);
    const marks = await tx.execute<
      Omit<BoardingRow, 'name' | 'label' | 'reference' | 'by'> & {
        byId: string;
      }
    >(sql`
      select r.name as route, t.direction, e.person_id::text as "personId", e.kind,
        ${hm('e.occurred_at')} as at, s.name as stop, e.by_person_id::text as "byId"
      from transport_boarding_event e
      join transport_trip t on t.org_id = e.org_id and t.id = e.trip_id
      join transport_route r on r.org_id = t.org_id and r.id = t.route_id
      left join transport_stop s on s.org_id = e.org_id and s.id = e.stop_id
      where e.org_id = app_current_org() and r.campus_id = ${where.campusId}
        and t.trip_date = ${input.date}::date
      order by e.occurred_at`);
    const ids = [...new Set(marks.flatMap((m) => [m.personId, m.byId]))];
    const names = await displayNames(tx, ids);
    const placed = new Map<string, { label: string; reference: string | null }>();
    const children = [...new Set(marks.map((m) => m.personId))];
    for (const p of placements)
      for (const [id, v] of await p.getPlacements(tx, { personIds: children, onDate: input.date }))
        placed.set(id, { label: v.displayLabel, reference: v.reference ?? null });
    return {
      date: input.date,
      trips: [...trips],
      marks: marks.map(({ byId, ...m }) => ({
        ...m,
        name: names[m.personId] ?? '',
        label: placed.get(m.personId)?.label ?? null,
        reference: placed.get(m.personId)?.reference ?? null,
        by: names[byId] ?? '',
      })),
    };
  });
}

/** Per route for a month ("2026-11"): riders, days run, boardings, and anything found. */
export async function ridership(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; month: string },
): Promise<RidershipRow[]> {
  const where = await readable(db, permissions, actor, input.institutionId);
  const start = `${input.month}-01`;
  return withTenant(db, actor.orgId, async (tx) => [
    ...(await tx.execute<RidershipRow>(sql`
      with m as (select daterange(${start}::date, (${start}::date + interval '1 month')::date) as span)
      select r.name as route, r.direction,
        (select count(distinct a.person_id)::int from transport_assignment a, m
          where a.org_id = r.org_id and a.route_id = r.id and a.valid_during && m.span) as riders,
        (select count(*)::int from transport_trip t, m
          where t.org_id = r.org_id and t.route_id = r.id and m.span @> t.trip_date) as "tripDays",
        (select count(distinct (e.trip_id, e.person_id))::int from transport_boarding_event e
          join transport_trip t on t.org_id = e.org_id and t.id = e.trip_id, m
          where t.org_id = r.org_id and t.route_id = r.id and m.span @> t.trip_date
            and e.kind = 'boarded') as boarded,
        (select count(distinct (e.trip_id, e.person_id))::int from transport_boarding_event e
          join transport_trip t on t.org_id = e.org_id and t.id = e.trip_id, m
          where t.org_id = r.org_id and t.route_id = r.id and m.span @> t.trip_date
            and e.kind = 'not_boarded') as "notBoarded",
        (select count(*)::int from transport_trip t, m
          where t.org_id = r.org_id and t.route_id = r.id and m.span @> t.trip_date
            and t.check_outcome = 'child_found') as "childFound"
      from transport_route r
      where r.org_id = app_current_org() and r.campus_id = ${where.campusId}
      order by r.name, r.direction`)),
  ]);
}
