// Milestone 18 step 3: today's trips, the attendant's marks, the empty-bus check and the alerts.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  acceptMarks,
  checkCleared,
  endTrip,
  notBoarded,
  recordMark,
  startTrip,
  todayTrips,
  transportJobs,
  tripSheet,
  type MarkKind,
} from '@campusverse/shared-transport';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);
const P = [schoolPlacement];

let t: SeededTenant;
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
const mark = (who: Actor, personId: string, kind: MarkKind, eventId = randomUUID()) =>
  recordMark(db, permissions, who, {
    institutionId: t.institutionId,
    eventId,
    deviceId: 'test-phone',
    occurredAt: new Date().toISOString(),
    tripId,
    personId,
    kind,
  });

beforeAll(async () => {
  t = await seedTenant(db, 'Transport Trips');
  attendant = await actor(['transport.trip.read', 'transport.trip.attend']);
  incharge = await actor(['transport.trip.read', 'transport.route.manage']);
  viewer = await actor(['transport.trip.read']);
  routeId = (
    await rows<{ id: string }>(sql`select id::text from transport_route where name = 'Route 1'`)
  )[0]!.id;
});
afterAll(() => close());

describe('trips', () => {
  it("lists today's buses: riders, papers, no trip yet", async () => {
    const [r] = await todayTrips(db, permissions, viewer, t.institutionId);
    expect(r).toMatchObject({
      routeId,
      riders: 1,
      trip: null,
      blocked: ['insurance', 'permit'],
      counts: { expected: 1 },
    });
  });

  it('starts only with a reason while papers are missing, once a day, never by a viewer', async () => {
    const input = { institutionId: t.institutionId, routeId };
    await expect(startTrip(db, permissions, viewer, input)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(startTrip(db, permissions, attendant, input)).rejects.toMatchObject({
      code: 'vehicle_not_ready',
    });
    const reason = { ...input, overrideReason: 'Insurance renewed, paper copy on the bus' };
    tripId = (await startTrip(db, permissions, attendant, reason)).id;
    expect((await startTrip(db, permissions, attendant, reason)).id).toBe(tripId);

    const [audit] = await rows<{ detail: { overrideReason: string } }>(sql`
      select detail from audit_event where entity_id = ${tripId} and action = 'transport.trip.start'`);
    expect(audit?.detail.overrideReason).toMatch(/Insurance renewed/);
    const [event] = await rows<{ payload: { checkInMs: number } }>(sql`
      select payload from ops.outbox where org_id = ${t.orgId} and type = 'transport.trip.started.v1'`);
    expect(event?.payload.checkInMs).toBeGreaterThan(0);
  });

  it('accepts each tap once; refuses marks that do not fit the trip', async () => {
    const id = randomUUID();
    expect(await mark(attendant, t.studentId, 'boarded', id)).toEqual({ outcome: 'accepted' });
    expect(await mark(attendant, t.studentId, 'boarded', id)).toEqual({ outcome: 'duplicate' });
    await expect(mark(attendant, t.studentId, 'dropped')).rejects.toMatchObject({
      code: 'wrong_mark',
    });
    await expect(mark(attendant, t.teacherId, 'boarded')).rejects.toMatchObject({
      code: 'not_on_route',
    });
    await expect(mark(viewer, t.studentId, 'boarded')).rejects.toBeInstanceOf(PermissionDenied);

    const sheet = await tripSheet(db, permissions, P, attendant, {
      institutionId: t.institutionId,
      routeId,
    });
    expect(sheet.stops[0]?.riders[0]).toMatchObject({ personId: t.studentId, state: 'on_board' });
  });

  it('takes queued taps from the offline sync and answers each one', async () => {
    const base = { deviceId: 'phone', occurredAt: new Date().toISOString() };
    const payload = {
      institutionId: t.institutionId,
      tripId,
      personId: t.studentId,
      kind: 'boarded' as const,
    };
    const results = await acceptMarks(db, permissions, attendant, [
      { ...base, eventId: randomUUID(), actorId: attendant.personId, payload },
      { ...base, eventId: randomUUID(), actorId: viewer.personId, payload },
      {
        ...base,
        eventId: randomUUID(),
        actorId: attendant.personId,
        payload: { ...payload, kind: 'dropped' },
      },
    ]);
    expect(results.map((r) => r.code ?? r.outcome)).toEqual([
      'accepted',
      'other_actor',
      'wrong_mark',
    ]);
  });

  it("can't be cleared as empty while a child is on board, then ends after the hand-over", async () => {
    const end = { institutionId: t.institutionId, tripId, outcome: 'empty' as const };
    await expect(endTrip(db, permissions, attendant, end)).rejects.toMatchObject({
      code: 'riders_on_board',
    });
    await mark(attendant, t.studentId, 'handed_to_school');
    await endTrip(db, permissions, attendant, end);
    await expect(endTrip(db, permissions, attendant, end)).rejects.toMatchObject({
      code: 'trip_ended',
    });
    // A tap made after the trip ended (by the device's clock) is refused.
    await expect(
      recordMark(db, permissions, attendant, {
        institutionId: t.institutionId,
        eventId: randomUUID(),
        deviceId: 'test-phone',
        occurredAt: new Date(Date.now() + 60_000).toISOString(),
        tripId,
        personId: t.studentId,
        kind: 'boarded',
      }),
    ).rejects.toMatchObject({ code: 'trip_ended' });
    const [r] = await todayTrips(db, permissions, viewer, t.institutionId);
    expect(r?.trip).toMatchObject({ checkOutcome: 'empty', overridden: true });
    expect(r?.counts.at_school).toBe(1);
  });

  it('tells the guardian once if the child is still marked "didn\'t come" after the wait', async () => {
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
    // The latest mark is "handed to school": nothing goes out.
    await notBoarded(db, data);
    expect(await sent()).toBe(0);

    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into transport_boarding_event (org_id, id, trip_id, person_id, kind, occurred_at,
          by_person_id, device_id)
        values (${t.orgId}, uuidv7(), ${tripId}, ${t.studentId}, 'not_boarded',
          now() + interval '1 minute', ${attendant.personId}, 'test')`),
    );
    await notBoarded(db, data);
    await notBoarded(db, data);
    expect(await sent()).toBe(1);
  });

  it('sends boarded and dropped alerts to guardians, and "child found" to the in-charge', async () => {
    const jobs = transportJobs({ schedule: async () => {} });
    const handle = (name: string) => jobs.consumers.find((c) => c.name === name)!.handle!;
    const [ev] = await rows<{ id: string }>(sql`
      select id::text from transport_boarding_event where trip_id = ${tripId} and kind = 'boarded'
      order by occurred_at limit 1`);
    await withTenant(db, t.orgId, async (tx) => {
      const e = (type: string, payload: Record<string, unknown>) =>
        ({ id: randomUUID(), orgId: t.orgId, type, payload }) as never;
      await handle('transport.mark-alerts')(
        tx,
        e('transport.student.marked.v1', {
          eventId: ev!.id,
          tripId,
          personId: t.studentId,
          kind: 'boarded',
        }),
      );
      await handle('transport.child-found')(
        tx,
        e('transport.trip.ended.v1', { tripId, outcome: 'child_found', note: 'Asleep, row 6' }),
      );
    });
    const [g] = await rows<{ kind: string; body: string }>(sql`
      select kind, body from notification_message
      where recipient_person_id = ${t.guardianId} and title = 'On the bus'`);
    expect(g).toMatchObject({ kind: 'transport' });
    expect(g?.body).toMatch(/boarded the bus at Synthetic Nagar at \d/);
    const [s] = await rows<{ kind: string; body: string }>(sql`
      select kind, body from notification_message
      where recipient_person_id = ${incharge.personId} and title like '%child found%'`);
    expect(s).toMatchObject({ kind: 'urgent' });
    expect(s?.body).toMatch(/Asleep, row 6/);
  });

  it('alerts the in-charge once when a trip is still open past its time, never after it ended', async () => {
    await checkCleared(db, { orgId: t.orgId, tripId });
    const count = () =>
      rows<{ n: number }>(sql`
        select count(*)::int as n from notification_message
        where recipient_person_id = ${incharge.personId} and title like '%has not been cleared'`);
    expect((await count())[0]?.n).toBe(0);

    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update transport_trip set ended_at = null, ended_by_person_id = null, check_outcome = null
        where id = ${tripId}`),
    );
    await checkCleared(db, { orgId: t.orgId, tripId });
    await checkCleared(db, { orgId: t.orgId, tripId });
    expect((await count())[0]?.n).toBe(1);
  });
});
