// Milestone 18 step 6: the boarding log, monthly ridership, paper reminders and the Verse tool.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  boardingLog,
  recordMark,
  ridership,
  startTrip,
  transportJobs,
  transportTools,
} from '@campusverse/shared-transport';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let attendant: Actor;
let incharge: Actor;
let nobody: Actor;
let today: string;

const actor = async (grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, grants),
});
const rows = <T extends Record<string, unknown>>(q: SQL) =>
  withTenant(db, t.orgId, (tx) => tx.execute<T>(q));

beforeAll(async () => {
  t = await seedTenant(db, 'Transport Reports');
  attendant = await actor(['transport.trip.read', 'transport.trip.attend']);
  incharge = await actor(['transport.trip.read', 'transport.route.manage']);
  nobody = await actor(['people.student.read']);
  today = (await rows<{ d: string }>(sql`select app_today()::text as d`))[0]!.d;
  const routeId = (
    await rows<{ id: string }>(sql`select id::text from transport_route where name = 'Route 1'`)
  )[0]!.id;
  const { id: tripId } = await startTrip(db, permissions, attendant, {
    institutionId: t.institutionId,
    routeId,
    overrideReason: 'Insurance renewal in the post',
  });
  await recordMark(db, permissions, attendant, {
    institutionId: t.institutionId,
    eventId: randomUUID(),
    deviceId: 'phone',
    occurredAt: new Date().toISOString(),
    tripId,
    personId: t.studentId,
    kind: 'boarded',
  });
});
afterAll(() => close());

describe('transport reports', () => {
  it("lists the day's trips and every tap, with class and admission number", async () => {
    const log = await boardingLog(db, permissions, [schoolPlacement], incharge, {
      institutionId: t.institutionId,
      date: today,
    });
    expect(log.trips).toEqual([
      expect.objectContaining({
        route: 'Route 1',
        overrideReason: 'Insurance renewal in the post',
      }),
    ]);
    expect(log.marks).toEqual([
      expect.objectContaining({
        route: 'Route 1',
        personId: t.studentId,
        kind: 'boarded',
        stop: 'Synthetic Nagar',
      }),
    ]);
    expect(log.marks[0]?.label).toBeTruthy();
    expect(log.marks[0]?.by).toBe('Synthetic Admin');
  });

  it('counts a month per route; denies people without transport', async () => {
    const [r] = await ridership(db, permissions, incharge, {
      institutionId: t.institutionId,
      month: today.slice(0, 7),
    });
    expect(r).toMatchObject({
      route: 'Route 1',
      riders: 1,
      tripDays: 1,
      boarded: 1,
      notBoarded: 0,
    });
    await expect(
      ridership(db, permissions, nobody, { institutionId: t.institutionId, month: '2026-11' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      boardingLog(db, permissions, [schoolPlacement], nobody, {
        institutionId: t.institutionId,
        date: today,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('reminds the in-charge once about papers expiring within 30 days', async () => {
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        insert into transport_vehicle_document (org_id, vehicle_id, kind, valid_until, recorded_by_person_id)
        select org_id, id, 'insurance', app_today() + 5, ${incharge.personId}
        from transport_vehicle where registration = 'TS09AB1234'`),
    );
    const handle = transportJobs({ schedule: async () => {} }).consumers.find(
      (c) => c.name === 'transport.paper-reminders',
    )!.handle!;
    const event = () =>
      ({
        id: randomUUID(),
        orgId: t.orgId,
        type: 'transport.trip.started.v1',
        payload: { campusId: t.campusId },
      }) as never;
    await withTenant(db, t.orgId, (tx) => handle(tx, event()));
    await withTenant(db, t.orgId, (tx) => handle(tx, event()));
    const sent = await rows<{ title: string; kind: string }>(sql`
      select title, kind from notification_message
      where recipient_person_id = ${incharge.personId} and title like 'TS09AB1234:%'`);
    // Fitness is valid until March 2027: no reminder for it.
    expect(sent).toEqual([{ title: 'TS09AB1234: insurance expires in 5 days', kind: 'notice' }]);
  });

  it("answers Verse AI with today's buses as counts, no names", async () => {
    const tool = transportTools({ db, permissions }).find(
      (x) => x.name === 'transport.trips_today',
    )!;
    const out = await tool.handler({ actor: incharge, institutionId: t.institutionId, today }, {});
    const data = out.data as { buses: Record<string, unknown>[] };
    expect(data.buses[0]).toMatchObject({
      route: 'Route 1',
      state: 'running',
      riders: 1,
      onBoard: 1,
      papersMissing: ['permit'],
    });
    expect(JSON.stringify(out.data)).not.toContain('Synthetic Student');
  });
});
