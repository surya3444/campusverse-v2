// Milestone 18 step 4: the driver starts the trip, shares positions, raises an SOS; never marks.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  endTrip,
  raiseSos,
  recordMark,
  recordPositions,
  startTrip,
  todayTrips,
  transportJobs,
  tripSheet,
} from '@campusverse/shared-transport';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let driver: Actor;
let attendant: Actor;
let incharge: Actor;
let viewer: Actor;
let routeId: string;
let tripId: string;

const actor = async (grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, grants),
});
const rows = <T extends Record<string, unknown>>(q: SQL) =>
  withTenant(db, t.orgId, (tx) => tx.execute<T>(q));
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

beforeAll(async () => {
  t = await seedTenant(db, 'Transport Driving');
  driver = await actor(['transport.trip.drive']);
  attendant = await actor(['transport.trip.read', 'transport.trip.attend']);
  incharge = await actor(['transport.trip.read', 'transport.route.manage']);
  viewer = await actor(['transport.trip.read']);
  routeId = (
    await rows<{ id: string }>(sql`select id::text from transport_route where name = 'Route 1'`)
  )[0]!.id;
});
afterAll(() => close());

describe('driving', () => {
  it("sees today's buses (no names), starts the trip, but never sees or marks children", async () => {
    const [bus] = await todayTrips(db, permissions, driver, t.institutionId);
    expect(bus).toMatchObject({ routeId, riders: 1, trip: null });
    await expect(
      tripSheet(db, permissions, [schoolPlacement], driver, {
        institutionId: t.institutionId,
        routeId,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    tripId = (
      await startTrip(db, permissions, driver, {
        institutionId: t.institutionId,
        routeId,
        overrideReason: 'Papers renewed, copies in the cabin',
      })
    ).id;
    await expect(
      recordMark(db, permissions, driver, {
        institutionId: t.institutionId,
        eventId: randomUUID(),
        deviceId: 'driver-phone',
        occurredAt: new Date().toISOString(),
        tripId,
        personId: t.studentId,
        kind: 'boarded',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('shares positions once each; drops points from before the trip; only the driver sends', async () => {
    const points = [
      { at: ago(20), lat: 17.385, lng: 78.4867, speedKmh: 28 },
      { at: ago(5), lat: 17.386, lng: 78.4871, speedKmh: 31 },
      { at: ago(3600), lat: 17.3, lng: 78.4 }, // an hour before the trip started
    ];
    const input = { institutionId: t.institutionId, tripId, points };
    expect(await recordPositions(db, permissions, driver, input)).toEqual({ saved: 2 });
    expect(await recordPositions(db, permissions, driver, input)).toEqual({ saved: 0 });
    await expect(recordPositions(db, permissions, viewer, input)).rejects.toBeInstanceOf(
      PermissionDenied,
    );

    const [bus] = await todayTrips(db, permissions, viewer, t.institutionId);
    expect(bus?.trip?.lastSeen).toMatchObject({ lat: 17.386, lng: 78.4871, minutesAgo: 0 });
  });

  it('deletes positions older than 30 days', async () => {
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into transport_position (org_id, trip_id, at, latitude, longitude)
        values (${t.orgId}, ${tripId}, now() - interval '31 days', 17, 78)`),
    );
    await recordPositions(db, permissions, driver, {
      institutionId: t.institutionId,
      tripId,
      points: [{ at: ago(1), lat: 17.387, lng: 78.4875 }],
    });
    const [old] = await rows<{ n: number }>(sql`
      select count(*)::int as n from transport_position where at < now() - interval '30 days'`);
    expect(old?.n).toBe(0);
  });

  it('raises an SOS that reaches the in-charge with the bus position', async () => {
    await expect(
      raiseSos(db, permissions, viewer, { institutionId: t.institutionId, tripId }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await raiseSos(db, permissions, driver, {
      institutionId: t.institutionId,
      tripId,
      note: 'Tyre burst near the flyover',
      at: { lat: 17.387, lng: 78.4875 },
    });
    const [bus] = await todayTrips(db, permissions, viewer, t.institutionId);
    expect(bus?.trip?.sos).toMatchObject({ note: 'Tyre burst near the flyover' });

    const [event] = await rows<{ id: string; payload: Record<string, unknown> }>(sql`
      select id::text, payload from ops.outbox where org_id = ${t.orgId} and type = 'transport.trip.sos.v1'`);
    const handle = transportJobs({ schedule: async () => {} }).consumers.find(
      (c) => c.name === 'transport.sos',
    )!.handle!;
    await withTenant(db, t.orgId, (tx) =>
      handle(tx, {
        id: event!.id,
        orgId: t.orgId,
        type: 'transport.trip.sos.v1',
        payload: event!.payload,
      } as never),
    );
    const [msg] = await rows<{ kind: string; body: string }>(sql`
      select kind, body from notification_message
      where recipient_person_id = ${incharge.personId} and title like 'SOS:%'`);
    expect(msg?.kind).toBe('urgent');
    expect(msg?.body).toMatch(/Tyre burst.*openstreetmap\.org\/\?mlat=17\.387/);
  });

  it('stops taking positions once the attendant ends the trip', async () => {
    await endTrip(db, permissions, attendant, {
      institutionId: t.institutionId,
      tripId,
      outcome: 'empty',
    });
    await expect(
      recordPositions(db, permissions, driver, {
        institutionId: t.institutionId,
        tripId,
        points: [{ at: ago(1), lat: 17.39, lng: 78.49 }],
      }),
    ).rejects.toMatchObject({ code: 'trip_ended' });
  });
});
