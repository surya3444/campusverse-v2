// Transport set up in one place (docs/specs/CONNECTED_SCHOOL.md): a route's usual crew from the
// school's staff, each fare zone's fee published from Transport, and riders billed as they join.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant, type Tx } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { combineAudiences } from '@campusverse/shared-communications';
import { billStudent, groupFees, setGroupFee, type FinanceDeps } from '@campusverse/shared-finance';
import {
  assignRider,
  saveRoute,
  saveStop,
  transportAudience,
  transportSetup,
  type BillRider,
} from '@campusverse/shared-transport';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schoolAudience } from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);
const audience = combineAudiences(schoolAudience, transportAudience);
const finance: FinanceDeps = { db, permissions, audience, gateway: null };
const bill: BillRider = (tx, input) => billStudent(tx, audience, input);
const P = [schoolPlacement];

let t: SeededTenant;
let other: SeededTenant;
let office: Actor;
let incharge: Actor;

const actor = async (tenant: SeededTenant, grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: tenant.orgId,
  personId: await seedAdmin(db, tenant.orgId, grants),
});
const q = <T extends Record<string, unknown>>(orgId: string, f: (tx: Tx) => Promise<T[]>) =>
  withTenant(db, orgId, f);

beforeAll(async () => {
  t = await seedTenant(db, 'Connected Transport');
  other = await seedTenant(db, 'Connected Transport Other');
  const transport = [
    'transport.trip.read',
    'transport.route.manage',
    'transport.vehicle.manage',
    'transport.assignment.manage',
  ];
  incharge = await actor(t, transport);
  office = await actor(t, [
    ...transport,
    'finance.plan.manage',
    'finance.invoice.read',
    'finance.invoice.issue',
  ]);
});
afterAll(() => close());

describe("a route's usual crew", () => {
  it('takes staff of the school as driver and attendant, never a student or one person twice', async () => {
    const setup = await transportSetup(db, permissions, incharge, t.institutionId);
    const stopId = setup.stops[0]!.id;
    const teacher = setup.crew.find((m) => m.personId === t.teacherId);
    // The teacher is staff, but their roles don't let them drive or attend.
    expect(teacher).toMatchObject({ canDrive: false, canAttend: false });
    const base = {
      institutionId: t.institutionId,
      name: 'Crew Route',
      direction: 'drop' as const,
      active: true,
      stops: [{ stopId, plannedAt: '15:30' }],
    };
    const { id } = await saveRoute(db, permissions, incharge, {
      ...base,
      driverPersonId: null,
      attendantPersonId: t.teacherId,
    });
    const saved = (await transportSetup(db, permissions, incharge, t.institutionId)).routes.find(
      (r) => r.id === id,
    );
    expect(saved).toMatchObject({ driverPersonId: null, attendantPersonId: t.teacherId });

    await expect(
      saveRoute(db, permissions, incharge, { ...base, id, driverPersonId: t.studentId }),
    ).rejects.toMatchObject({ code: 'not_staff' });
    await expect(
      saveRoute(db, permissions, incharge, {
        ...base,
        id,
        driverPersonId: t.teacherId,
        attendantPersonId: t.teacherId,
      }),
    ).rejects.toMatchObject({ code: 'same_person' });
    // No child rides with a driver whose licence and medical fitness aren't on file.
    await expect(
      saveRoute(db, permissions, incharge, {
        ...base,
        id,
        driverPersonId: t.teacherId,
        attendantPersonId: null,
      }),
    ).rejects.toMatchObject({
      code: 'crew_checks',
      details: { crew: 'driver', checks: ['driving_licence', 'medical_fitness'] },
    });
    // Another school's staff member is not this school's staff.
    await expect(
      saveRoute(db, permissions, incharge, { ...base, id, driverPersonId: other.teacherId }),
    ).rejects.toThrow();
  });
});

describe('zone fees and billing riders', () => {
  it('publishes a zone fee from Transport, versions it, and refuses others', async () => {
    const zone = (await transportSetup(db, permissions, office, t.institutionId)).zones[0]!;
    const input = {
      institutionId: t.institutionId,
      groupId: zone.id,
      name: '',
      head: { code: 'TRANSPORT', name: 'Transport', rteExempt: false },
      amountPaise: 1_200_000,
      instalments: [{ label: 'Annual', dueOn: '2026-06-10', shareBp: 10_000 }],
    };
    // Managing routes isn't managing fees.
    await expect(setGroupFee(finance, incharge, input)).rejects.toBeInstanceOf(PermissionDenied);
    // Another organisation's zone isn't one of this school's groups.
    const otherZone = (
      await transportSetup(
        db,
        permissions,
        await actor(other, ['transport.trip.read']),
        other.institutionId,
      )
    ).zones[0]!;
    await expect(
      setGroupFee(finance, office, { ...input, groupId: otherZone.id }),
    ).rejects.toMatchObject({ code: 'group_not_found' });

    const first = await setGroupFee(finance, office, input);
    expect(first.version).toBe(1);
    const head = await q(t.orgId, (tx) =>
      tx.execute<{ rte: boolean }>(sql`
        select rte_exempt as rte from fee_head where code = 'TRANSPORT' and institution_id = ${t.institutionId}`),
    );
    expect(head[0]?.rte).toBe(false);
    const second = await setGroupFee(finance, office, { ...input, amountPaise: 1_500_000 });
    expect(second.version).toBe(2);
    const fees = await groupFees(finance, office, t.institutionId, [zone.id]);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({
      planId: second.planId,
      name: 'Transport zone 1',
      totalPaise: 1_500_000,
      version: 2,
    });
    const states = await q(t.orgId, (tx) =>
      tx.execute<{ id: string; state: string }>(sql`
        select id::text, state from fee_plan where id in (${first.planId}, ${second.planId})`),
    );
    expect(states.find((s) => s.id === first.planId)?.state).toBe('retired');
  });

  it('bills a new rider in the same transaction, from their first day, once', async () => {
    const today = (
      await q(t.orgId, (tx) => tx.execute<{ d: string }>(sql`select app_today()::text as d`))
    )[0]!.d;
    const later = (
      await q(t.orgId, (tx) => tx.execute<{ d: string }>(sql`select (app_today() + 40)::text as d`))
    )[0]!.d;
    const stop = await saveStop(db, permissions, office, {
      institutionId: t.institutionId,
      name: 'Zone Two Circle',
      fareZone: 2,
      active: true,
    });
    const route = await saveRoute(db, permissions, office, {
      institutionId: t.institutionId,
      name: 'Zone Two Route',
      direction: 'pickup',
      active: true,
      stops: [{ stopId: stop.id, plannedAt: '07:40' }],
    });
    const zone = (await transportSetup(db, permissions, office, t.institutionId)).zones.find(
      (z) => z.number === 2,
    )!;
    // One instalment already due before the rider's first day, one after.
    const { planId } = await setGroupFee(finance, office, {
      institutionId: t.institutionId,
      groupId: zone.id,
      name: '',
      head: { code: 'TRANSPORT', name: 'Transport', rteExempt: false },
      amountPaise: 1_000_000,
      instalments: [
        { label: 'Term 1', dueOn: today, shareBp: 5000 },
        { label: 'Term 2', dueOn: '2027-03-25', shareBp: 5000 },
      ],
    });
    const r = await assignRider(
      db,
      permissions,
      P,
      office,
      {
        institutionId: t.institutionId,
        personId: t.studentId,
        routeId: route.id,
        stopId: stop.id,
        from: later,
      },
      bill,
    );
    // From then on they ride the morning bus only: one way pays half (₹2,500 of Term 2's ₹5,000).
    expect(r).toMatchObject({ invoices: 1, totalPaise: 250_000 });
    const invoices = await q(t.orgId, (tx) =>
      tx.execute<{ label: string; total: number }>(sql`
        select label, total_paise::int as total from fee_invoice
        where student_person_id = ${t.studentId} and plan_id = ${planId}`),
    );
    expect(invoices).toEqual([{ label: 'Term 2', total: 250_000 }]);
    const audit = await q(t.orgId, (tx) =>
      tx.execute<{ detail: { invoices: number } }>(sql`
        select detail from audit_event where action = 'transport.assignment.create'
        and entity_id = ${t.studentId} order by occurred_at desc limit 1`),
    );
    expect(audit[0]?.detail.invoices).toBe(1);

    // Put on the route again: nobody is billed twice.
    const again = await assignRider(
      db,
      permissions,
      P,
      office,
      {
        institutionId: t.institutionId,
        personId: t.studentId,
        routeId: route.id,
        stopId: stop.id,
        from: later,
      },
      bill,
    );
    expect(again.invoices).toBe(0);

    // An afternoon bus from a zone-3 stop: the morning stop still decides the zone (one fee, not
    // two), and with both trips they pay the whole zone fee.
    const far = await saveStop(db, permissions, office, {
      institutionId: t.institutionId,
      name: 'Zone Three Market',
      fareZone: 3,
      active: true,
    });
    const back = await saveRoute(db, permissions, office, {
      institutionId: t.institutionId,
      name: 'Zone Three Route',
      direction: 'drop',
      active: true,
      stops: [{ stopId: far.id, plannedAt: '16:10' }],
    });
    await assignRider(db, permissions, P, office, {
      institutionId: t.institutionId,
      personId: t.studentId,
      routeId: back.id,
      stopId: far.id,
      from: later,
    });
    const zones = (await transportSetup(db, permissions, office, t.institutionId)).zones;
    const three = zones.find((z) => z.number === 3)!;
    const seen = await q(t.orgId, async (tx) => [
      {
        two: await audience.students(tx, t.institutionId, [zone.id], later),
        three: await audience.students(tx, t.institutionId, [three.id], later),
        shares: [...(await audience.shares!(tx, t.institutionId, [zone.id], [t.studentId], later))],
      },
    ]);
    expect(seen[0]?.two).toContain(t.studentId);
    expect(seen[0]?.three).not.toContain(t.studentId);
    expect(seen[0]?.shares).toEqual([]);
  });
});
