// Milestone 18 step 5: a parent sees their own child's bus (position only while the trip runs)
// and can say "not taking the bus today"; the attendant sees it and no "not on the bus" alert goes.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  childBus,
  endTrip,
  notBoarded,
  recordMark,
  recordPositions,
  skipRide,
  startTrip,
  tripSheet,
} from '@campusverse/shared-transport';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);
const P = [schoolPlacement];

let t: SeededTenant;
let parent: Actor;
let attendant: Actor;
let driver: Actor;
let stranger: Actor;
let routeId: string;
let tripId: string;
let today: string;

const actor = async (grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, grants),
});
const rows = <T extends Record<string, unknown>>(q: SQL) =>
  withTenant(db, t.orgId, (tx) => tx.execute<T>(q));
const bus = async () => (await childBus(db, permissions, P, parent, t.studentId))[0];

beforeAll(async () => {
  t = await seedTenant(db, 'Transport Parents');
  await grantPermission(db, t.orgId, 'parent', 'transport.trip.read', 'guardian');
  await grantPermission(db, t.orgId, 'parent', 'transport.ride.skip', 'guardian');
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  attendant = await actor(['transport.trip.read', 'transport.trip.attend']);
  driver = await actor(['transport.trip.drive']);
  stranger = await actor(['people.student.read']);
  routeId = (
    await rows<{ id: string }>(sql`select id::text from transport_route where name = 'Route 1'`)
  )[0]!.id;
  today = (await rows<{ d: string }>(sql`select app_today()::text as d`))[0]!.d;
});
afterAll(() => close());

describe("a parent's view of the bus", () => {
  it('shows the route, stop and time before the trip, and only for their own child', async () => {
    expect(await bus()).toMatchObject({
      direction: 'pickup',
      route: 'Route 1',
      stop: 'Synthetic Nagar',
      stopAt: '07:30',
      skipping: false,
      trip: null,
      mark: null,
      bus: null,
    });
    await expect(childBus(db, permissions, P, parent, t.teacherId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(childBus(db, permissions, P, stranger, t.studentId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('shows the running bus, its position and an ETA until the child boards', async () => {
    tripId = (
      await startTrip(db, permissions, attendant, {
        institutionId: t.institutionId,
        routeId,
        overrideReason: 'Papers renewed',
      })
    ).id;
    await recordPositions(db, permissions, driver, {
      institutionId: t.institutionId,
      tripId,
      points: [{ at: new Date(Date.now() - 2000).toISOString(), lat: 17.385, lng: 78.4867 }],
    });
    const b = await bus();
    expect(b?.trip).toMatchObject({ running: true });
    expect(b?.bus).toMatchObject({ lat: 17.385, lng: 78.4867, minutesAgo: 0 });
    expect(typeof b?.etaMin).toBe('number');

    await recordMark(db, permissions, attendant, {
      institutionId: t.institutionId,
      eventId: randomUUID(),
      deviceId: 'phone',
      occurredAt: new Date().toISOString(),
      tripId,
      personId: t.studentId,
      kind: 'boarded',
    });
    expect(await bus()).toMatchObject({ mark: { kind: 'boarded' }, etaMin: null });
  });

  it('takes "not taking the bus today" once, shows it to the attendant, and can undo it', async () => {
    const skip = { studentId: t.studentId, date: today };
    await skipRide(db, permissions, P, parent, skip);
    await skipRide(db, permissions, P, parent, skip);
    expect((await bus())?.skipping).toBe(true);
    const [n] = await rows<{ n: number }>(sql`
      select count(*)::int as n from transport_skip where person_id = ${t.studentId}
        and trip_date = ${today}::date and cancelled_at is null`);
    expect(n?.n).toBe(1);
    const sheet = await tripSheet(db, permissions, P, attendant, {
      institutionId: t.institutionId,
      routeId,
    });
    expect(sheet.stops[0]?.riders[0]?.skipping).toBe(true);

    await expect(skipRide(db, permissions, P, stranger, skip)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      skipRide(db, permissions, P, parent, { ...skip, date: '2020-01-01' }),
    ).rejects.toMatchObject({ code: 'bad_date' });
  });

  it('sends no "not on the bus" alert when the parent already said so', async () => {
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into transport_boarding_event (org_id, id, trip_id, person_id, kind, occurred_at,
          by_person_id, device_id)
        values (${t.orgId}, uuidv7(), ${tripId}, ${t.studentId}, 'not_boarded',
          now() + interval '1 minute', ${attendant.personId}, 'test')`),
    );
    const data = {
      orgId: t.orgId,
      eventId: randomUUID(),
      tripId,
      personId: t.studentId,
      kind: 'not_boarded' as const,
    };
    const sent = async () =>
      (
        await rows<{ n: number }>(sql`
          select count(*)::int as n from notification_message
          where recipient_person_id = ${t.guardianId} and title = 'Not on the bus today'`)
      )[0]?.n;
    await notBoarded(db, data);
    expect(await sent()).toBe(0);

    // Undone: the alert goes as usual.
    await skipRide(db, permissions, P, parent, {
      studentId: t.studentId,
      date: today,
      cancel: true,
    });
    expect((await bus())?.skipping).toBe(false);
    await notBoarded(db, data);
    expect(await sent()).toBe(1);
  });

  it('hides the position once the trip ends', async () => {
    await endTrip(db, permissions, attendant, {
      institutionId: t.institutionId,
      tripId,
      outcome: 'empty',
    });
    expect(await bus()).toMatchObject({ trip: { running: false }, bus: null, etaMin: null });
  });
});
