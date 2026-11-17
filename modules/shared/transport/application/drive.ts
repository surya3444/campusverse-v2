// Driving (Milestone 18 step 4): the driver's phone shares the bus's position only while a trip
// runs (never outside one), and anyone on the bus can raise an SOS to the in-charge.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { TransportError } from './setup.js';

type Permissions = ReturnType<typeof createPermissions>;

export const TRANSPORT_SOS = 'transport.trip.sos.v1';
/** Decision 3: positions older than this are deleted. */
export const POSITION_RETENTION_DAYS = 30;

export type Point = {
  at: string;
  lat: number;
  lng: number;
  speedKmh?: number | null | undefined;
  accuracyM?: number | null | undefined;
};

async function runningTrip(tx: Tx, tripId: string, campusId: string) {
  const [t] = await tx.execute<{ running: boolean }>(sql`
    select t.ended_at is null as running
    from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
    where t.org_id = app_current_org() and t.id = ${tripId} and r.campus_id = ${campusId}
    for update of t`);
  if (!t) throw new TransportError('trip_not_found');
  if (!t.running) throw new TransportError('trip_ended');
}

async function placeFor(db: Db, actor: Actor, institutionId: string) {
  const p = await withTenant(db, actor.orgId, (tx) => placeOf(tx, institutionId));
  if (!p) throw new TransportError('institution_not_found');
  return p;
}

/**
 * A batch of the driver's positions (the phone sends one every half minute or so). Points from
 * before the trip started are dropped; a resent batch adds nothing. Old positions go here too:
 * each batch deletes the organisation's positions past the retention period.
 */
export async function recordPositions(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; tripId: string; points: Point[] },
): Promise<{ saved: number }> {
  const where = await placeFor(db, actor, input.institutionId);
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.trip.drive', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      await runningTrip(tx, input.tripId, where.campusId);
      let saved = 0;
      for (const p of input.points) {
        const rows = await tx.execute(sql`
          insert into transport_position (org_id, trip_id, at, latitude, longitude, speed_kmh, accuracy_m)
          select app_current_org(), id, ${p.at}::timestamptz, ${p.lat}, ${p.lng}, ${p.speedKmh ?? null},
            ${p.accuracyM ?? null}
          from transport_trip where org_id = app_current_org() and id = ${input.tripId}
            and ${p.at}::timestamptz >= started_at - interval '1 minute'
            and ${p.at}::timestamptz <= now() + interval '1 minute'
          on conflict do nothing returning 1`);
        saved += rows.length;
      }
      await tx.execute(sql`
        update transport_trip set driver_person_id = coalesce(driver_person_id, ${actor.personId})
        where org_id = app_current_org() and id = ${input.tripId}`);
      // ponytail: retention runs on each batch (indexed on org_id, at); a nightly job if it ever shows up in timings.
      await tx.execute(sql`
        delete from transport_position where org_id = app_current_org()
          and at < now() - make_interval(days => ${POSITION_RETENTION_DAYS})`);
      return {
        result: { saved },
        audit: {
          action: 'transport.trip.positions',
          entityType: 'transport_trip',
          entityId: input.tripId,
          dataClass: 'operational',
          detail: { points: saved },
        },
        events: [],
      };
    },
  );
}

/** Raises an SOS on a running trip: the in-charge and principal are told at once. */
export async function raiseSos(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: {
    institutionId: string;
    tripId: string;
    note?: string | undefined;
    at?: { lat: number; lng: number } | undefined;
  },
): Promise<void> {
  const where = await placeFor(db, actor, input.institutionId);
  const resource = { orgId: actor.orgId, place: where };
  // Attendant or driver: whoever is on the bus.
  const permission = await withTenant(db, actor.orgId, async (tx) =>
    (await permissions.can(tx, actor, 'transport.trip.attend', resource)).allowed
      ? 'transport.trip.attend'
      : 'transport.trip.drive',
  );
  await command(db, permissions, actor, { permission, resource }, async (tx) => {
    await runningTrip(tx, input.tripId, where.campusId);
    const note = input.note?.trim() || null;
    await tx.execute(sql`
      update transport_trip set sos_at = now(), sos_by_person_id = ${actor.personId}, sos_note = ${note}
      where org_id = app_current_org() and id = ${input.tripId}`);
    return {
      result: undefined,
      audit: {
        action: 'transport.trip.sos',
        entityType: 'transport_trip',
        entityId: input.tripId,
        dataClass: 'operational',
        detail: { note },
      },
      events: [
        {
          type: TRANSPORT_SOS,
          payload: {
            tripId: input.tripId,
            note,
            lat: input.at?.lat ?? null,
            lng: input.at?.lng ?? null,
          },
        },
      ],
    };
  });
}
