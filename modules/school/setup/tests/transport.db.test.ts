// Milestone 18 step 1: transport setup (vehicles, papers, stops, routes), allowed and denied.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { schoolAudience } from '@campusverse/school-setup';
import { combineAudiences } from '@campusverse/shared-communications';
import {
  addVehicleDocument,
  assignRider,
  commitRiderImport,
  endRider,
  listRiders,
  previewRiderImport,
  saveRoute,
  saveStop,
  saveVehicle,
  transportAudience,
  transportSetup,
} from '@campusverse/shared-transport';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let other: SeededTenant;
let incharge: Actor;
let viewer: Actor;
let nobody: Actor;

const actor = async (tenant: SeededTenant, grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: tenant.orgId,
  personId: await seedAdmin(db, tenant.orgId, grants),
});

beforeAll(async () => {
  t = await seedTenant(db, 'Transport');
  other = await seedTenant(db, 'Transport Other');
  incharge = await actor(t, [
    'transport.trip.read',
    'transport.route.manage',
    'transport.vehicle.manage',
    'transport.assignment.manage',
  ]);
  viewer = await actor(t, ['transport.trip.read']);
  nobody = await actor(t, ['people.student.read']);
});
afterAll(() => close());

describe('transport setup', () => {
  it('adds a vehicle, records papers, and blocks it while fitness, insurance or permit are missing', async () => {
    const { id } = await saveVehicle(db, permissions, incharge, {
      institutionId: t.institutionId,
      registration: 'ts 07 cd 4321',
      kind: 'van',
      seats: 14,
      ownedBy: 'contractor',
      contractorName: 'Sri Sai Travels',
      active: true,
    });
    let v = (await transportSetup(db, permissions, viewer, t.institutionId)).vehicles.find(
      (x) => x.id === id,
    );
    expect(v).toMatchObject({ registration: 'TS07CD4321', contractorName: 'Sri Sai Travels' });
    expect(v?.blocked).toEqual(['fitness', 'insurance', 'permit']);

    for (const kind of ['fitness', 'insurance', 'permit'] as const)
      await addVehicleDocument(db, permissions, incharge, {
        institutionId: t.institutionId,
        vehicleId: id,
        kind,
        validUntil: '2099-01-01',
      });
    v = (await transportSetup(db, permissions, viewer, t.institutionId)).vehicles.find(
      (x) => x.id === id,
    );
    expect(v?.blocked).toEqual([]);
    expect(v?.documents.fitness?.status).toBe('valid');

    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_event where entity_id = ${id} and action like 'transport.vehicle.%'`),
    );
    expect(audit?.n).toBe(4);
  });

  it('refuses a registration number already used in the organisation', async () => {
    await expect(
      saveVehicle(db, permissions, incharge, {
        institutionId: t.institutionId,
        registration: 'TS09AB1234', // the seeded bus
        kind: 'bus',
        seats: 40,
        ownedBy: 'school',
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'registration_taken' });
  });

  it('saves a route with stops in time order and replaces them on change', async () => {
    const a = await saveStop(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Gandhi Nagar',
      landmark: 'Near the temple',
      fareZone: 2,
      active: true,
    });
    const b = await saveStop(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Bus Stand',
      location: { lat: 17.385, lng: 78.4867 },
      active: true,
    });
    const route = {
      institutionId: t.institutionId,
      name: 'Route 7',
      direction: 'pickup' as const,
      active: true,
      stops: [
        { stopId: a.id, plannedAt: '07:05' },
        { stopId: b.id, plannedAt: '07:20' },
      ],
    };
    const { id } = await saveRoute(db, permissions, incharge, route);
    await saveRoute(db, permissions, incharge, {
      ...route,
      id,
      stops: [{ stopId: b.id, plannedAt: '07:10' }],
    });
    const saved = (await transportSetup(db, permissions, viewer, t.institutionId)).routes.find(
      (r) => r.id === id,
    );
    expect(saved?.stops).toEqual([{ seq: 1, stopId: b.id, plannedAt: '07:10' }]);

    await expect(
      saveRoute(db, permissions, incharge, { ...route, stops: [...route.stops].reverse() }),
    ).rejects.toMatchObject({ code: 'times_out_of_order' });
    await expect(
      saveStop(db, permissions, incharge, {
        institutionId: t.institutionId,
        name: 'gandhi nagar',
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'name_taken' });
  });

  it('denies reading without transport.trip.read and changes without manage', async () => {
    await expect(transportSetup(db, permissions, nobody, t.institutionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      saveStop(db, permissions, viewer, {
        institutionId: t.institutionId,
        name: 'Nope',
        active: true,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      saveVehicle(db, permissions, viewer, {
        institutionId: t.institutionId,
        registration: 'KA01ZZ0001',
        kind: 'bus',
        seats: 30,
        ownedBy: 'school',
        active: true,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("can't use another school's stop or vehicle on a route", async () => {
    const theirs = await withTenant(db, other.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from transport_stop limit 1`),
    );
    await expect(
      saveRoute(db, permissions, incharge, {
        institutionId: t.institutionId,
        name: 'Sneaky',
        direction: 'drop',
        active: true,
        stops: [{ stopId: theirs[0]!.id, plannedAt: '15:30' }],
      }),
    ).rejects.toMatchObject({ code: 'stop_not_found' });
  });
});

const P = [schoolPlacement];
const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
  (await withTenant(db, t.orgId, (tx) => tx.execute<T>(q)))[0]!;

describe('riders', () => {
  it('lists the seeded rider with their class and admission number', async () => {
    const riders = await listRiders(db, permissions, P, viewer, t.institutionId);
    const r = riders.find((x) => x.personId === t.studentId);
    expect(r).toMatchObject({ direction: 'pickup', from: '2026-06-01', until: null });
    expect(r?.label).toMatch(/Class/);
    expect(r?.reference).toMatch(/^ADM-/);
  });

  it('moves a rider to another route; the old one ends the day before', async () => {
    const stop = await saveStop(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Rider Nagar',
      fareZone: 3,
      active: true,
    });
    const route = await saveRoute(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Route 9',
      direction: 'pickup',
      active: true,
      stops: [{ stopId: stop.id, plannedAt: '07:00' }],
    });
    const today = (await one<{ d: string }>(sql`select app_today()::text as d`)).d;
    await assignRider(db, permissions, P, incharge, {
      institutionId: t.institutionId,
      personId: t.studentId,
      routeId: route.id,
      stopId: stop.id,
      from: today,
    });
    const now = (await listRiders(db, permissions, P, viewer, t.institutionId)).filter(
      (x) => x.personId === t.studentId,
    );
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ routeId: route.id, stopId: stop.id, from: today });
    const old = await one<{ until: string }>(sql`
      select (upper(valid_during) - 1)::text as until from transport_assignment
      where person_id = ${t.studentId} and lower(valid_during) = '2026-06-01'`);
    expect(old.until < today).toBe(true);

    // Riders keep their stop: removing it from the route is refused.
    const other = await saveStop(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Other Nagar',
      active: true,
    });
    await expect(
      saveRoute(db, permissions, incharge, {
        institutionId: t.institutionId,
        id: route.id,
        name: 'Route 9',
        direction: 'pickup',
        active: true,
        stops: [{ stopId: other.id, plannedAt: '07:00' }],
      }),
    ).rejects.toMatchObject({ code: 'stop_has_riders' });

    // Fare zone 3 and Route 9 are audiences for fees and notices, kept to this school's students.
    const audience = combineAudiences(schoolAudience, transportAudience);
    const groups = await withTenant(db, t.orgId, (tx) =>
      audience.groups(tx, t.institutionId, today),
    );
    const zone = groups.find((g) => g.label === 'Transport zone 3');
    expect(zone).toBeDefined();
    expect(groups.some((g) => g.id === route.id)).toBe(true);
    const zoneRiders = await withTenant(db, t.orgId, (tx) =>
      audience.students(tx, t.institutionId, [zone!.id], today),
    );
    expect(zoneRiders).toEqual([t.studentId]);

    // Taken off the route after today.
    await endRider(db, permissions, incharge, {
      institutionId: t.institutionId,
      assignmentId: now[0]!.assignmentId,
      lastDay: today,
    });
    const after = await one<{ until: string }>(sql`
      select (upper(valid_during) - 1)::text as until from transport_assignment
      where id = ${now[0]!.assignmentId}`);
    expect(after.until).toBe(today);
  });

  it('refuses staff, stops off the route, and people without the permission', async () => {
    const seeded = await one<{ routeId: string; stopId: string }>(sql`
      select route_id::text as "routeId", stop_id::text as "stopId" from transport_route_stop limit 1`);
    const from = '2026-12-01';
    await expect(
      assignRider(db, permissions, P, incharge, {
        institutionId: t.institutionId,
        personId: t.teacherId,
        ...seeded,
        from,
      }),
    ).rejects.toMatchObject({ code: 'not_a_student' });
    const loose = await saveStop(db, permissions, incharge, {
      institutionId: t.institutionId,
      name: 'Loose Stop',
      active: true,
    });
    await expect(
      assignRider(db, permissions, P, incharge, {
        institutionId: t.institutionId,
        personId: t.studentId,
        routeId: seeded.routeId,
        stopId: loose.id,
        from,
      }),
    ).rejects.toMatchObject({ code: 'stop_not_on_route' });
    await expect(
      assignRider(db, permissions, P, viewer, {
        institutionId: t.institutionId,
        personId: t.studentId,
        ...seeded,
        from,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('imports riders: preview row by row, then commit the clean rows', async () => {
    const adm = (
      await one<{ n: string }>(sql`
        select admission_number as n from school_enrolment where person_id = ${t.studentId}`)
    ).n;
    const input = {
      institutionId: t.institutionId,
      from: '2027-01-04',
      rows: [
        {
          reference: adm.toLowerCase(),
          route: 'route 1',
          direction: 'pickup' as const,
          stop: 'Synthetic Nagar',
        },
        {
          reference: 'NOPE-1',
          route: 'Route 1',
          direction: 'pickup' as const,
          stop: 'Synthetic Nagar',
        },
        { reference: adm, route: 'Route 404', direction: 'drop' as const, stop: 'Synthetic Nagar' },
      ],
    };
    const plan = await previewRiderImport(db, permissions, P, incharge, input);
    expect(plan.lines.map((l) => l.problem)).toEqual([
      null,
      'student_not_found',
      'route_not_found',
    ]);
    expect(plan.lines[0]?.name).toMatch(/Synthetic Student/);
    expect(plan.ready).toBe(1);
    const done = await commitRiderImport(db, permissions, P, incharge, input);
    expect(done).toMatchObject({ assigned: 1, skipped: 2 });
    const r = await one<{ n: number }>(sql`
      select count(*)::int as n from transport_assignment where import_batch_id = ${done.batchId}`);
    expect(r.n).toBe(1);
    await expect(previewRiderImport(db, permissions, P, viewer, input)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});
