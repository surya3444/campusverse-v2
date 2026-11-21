import { loadEnv } from '@campusverse/config';
import { deriveKeys, parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HEALTH_SOS_RAISED,
  closeIncident,
  discardStock,
  dispense,
  emergencyPartners,
  healthJobs,
  incidentReport,
  incidents,
  medicineDetail,
  medicines,
  raiseSos,
  receiveStock,
  saveHealthRecord,
  saveMedicine,
  savePartner,
  type HealthDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: HealthDeps = {
  db,
  permissions: createPermissions(null),
  keys: deriveKeys(parseFieldKeys(env.FIELD_KEYS), 'health'),
};

let t: SeededTenant;
let nurse: Actor;
let principal: Actor;
let teacher: Actor;
let clerk: Actor;
let principalPersonId: string;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const inst = () => ({ institutionId: t.institutionId });
const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await seedTenant(db, 'Health stock');
  nurse = actor(
    await seedAdmin(db, t.orgId, [
      'health.record.update',
      'health.stock.manage',
      'health.emergency.manage',
    ]),
  );
  principalPersonId = await seedAdmin(db, t.orgId, ['health.emergency.manage']);
  principal = actor(principalPersonId);
  teacher = actor(await seedAdmin(db, t.orgId, ['health.emergency.raise']));
  clerk = actor(await seedAdmin(db, t.orgId, ['people.student.read']));
});
afterAll(() => close());

describe('medicines and stock', () => {
  it('receives batches, gives earliest expiry first, logs every move and flags low stock', async () => {
    const { id } = await saveMedicine(deps, nurse, {
      ...inst(),
      name: 'Cetirizine 10 mg',
      unit: 'tablet',
      reorderLevel: 5,
      active: true,
    });
    await expect(
      saveMedicine(deps, nurse, {
        ...inst(),
        name: ' cetirizine 10 MG ',
        unit: 'tablet',
        reorderLevel: 0,
        active: true,
      }),
    ).rejects.toMatchObject({ code: 'duplicate_medicine' });
    await expect(
      receiveStock(deps, nurse, { ...inst(), medicineId: id, quantity: 4, expiresOn: iso(-1) }),
    ).rejects.toMatchObject({ code: 'already_expired' });

    const late = await receiveStock(deps, nurse, {
      ...inst(),
      medicineId: id,
      quantity: 10,
      expiresOn: iso(300),
    });
    await receiveStock(deps, nurse, { ...inst(), medicineId: id, quantity: 3, expiresOn: iso(10) });

    await dispense(deps, nurse, { ...inst(), medicineId: id, quantity: 5 });
    const d = await medicineDetail(deps, nurse, { ...inst(), medicineId: id });
    // The batch expiring in 10 days is used up first.
    expect(d.batches.map((b) => b.remaining)).toEqual([8]);
    expect(
      d.moves
        .filter((m) => m.kind === 'dispense')
        .map((m) => m.quantity)
        .sort(),
    ).toEqual([2, 3]);

    await expect(
      dispense(deps, nurse, { ...inst(), medicineId: id, quantity: 9 }),
    ).rejects.toMatchObject({
      code: 'not_enough_stock',
    });
    await discardStock(deps, nurse, {
      ...inst(),
      batchId: late.batchId,
      quantity: 4,
      reason: 'Strip damaged',
    });

    const row = (await medicines(deps, nurse, t.institutionId)).find((m) => m.id === id);
    expect(row).toMatchObject({ inStock: 4, low: true, expiringSoon: 0 });

    // The log can't be rewritten.
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update health_medicine_move set quantity = 1`),
      ),
    ).rejects.toThrow();
  });

  it('only the medical role keeps stock', async () => {
    await expect(medicines(deps, principal, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});

describe('emergencies', () => {
  it('an SOS shows the life-saving card, lists partners, tells leaders and the family', async () => {
    await saveHealthRecord(deps, nurse, {
      institutionId: t.institutionId,
      studentId: t.studentId,
      vault: {
        bloodGroup: 'O+',
        allergies: 'Penicillin',
        conditions: 'Type 1 diabetes',
        medicines: 'Insulin',
        responderNotes: 'Glucose tablets in the bag.',
      },
    });
    await savePartner(deps, principal, {
      ...inst(),
      name: 'Synthetic Care Hospital',
      kind: 'hospital',
      phone: '0000000001',
      address: null,
      sort: 0,
      active: true,
    });

    const sos = await raiseSos(deps, teacher, {
      ...inst(),
      studentId: t.studentId,
      kind: 'medical',
      location: 'Science lab, first floor',
    });
    expect(sos.emergency).toMatchObject({ bloodGroup: 'O+', allergies: 'Penicillin' });
    expect(sos.emergency).not.toHaveProperty('conditions');
    expect(sos.partners.map((p) => p.name)).toContain('Synthetic Care Hospital');
    expect((await emergencyPartners(deps, teacher, t.institutionId)).length).toBeGreaterThan(0);

    const [event] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<OutboxEvent>(sql`
        select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
        from ops.outbox where org_id = ${t.orgId} and type = ${HEALTH_SOS_RAISED}`),
    );
    const job = healthJobs().find((j) => j.name === 'health.sos-alert');
    expect(await runConsumer(db, job!, event!)).toBe('processed');
    const msgs = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ to: string; body: string }>(sql`
        select recipient_person_id::text as to, body from notification_message
        where dedupe_key like ${`health-sos%${sos.incidentId}%`}`),
    );
    expect(msgs.some((m) => m.to === principalPersonId)).toBe(true);
    const family = msgs.find((m) => m.to === t.guardianId);
    expect(family?.body).toContain('being handled at school');
    // No health detail ever reaches a message.
    expect(msgs.every((m) => !m.body.includes('Penicillin') && !m.body.includes('diabetes'))).toBe(
      true,
    );
  });

  it('leaders close an incident with a sealed report; it closes once', async () => {
    const open = (await incidents(deps, principal, t.institutionId)).find(
      (i) => i.location === 'Science lab, first floor',
    );
    expect(open?.closedAt).toBeNull();
    await closeIncident(deps, principal, {
      ...inst(),
      incidentId: open!.id,
      outcome: 'sent_home',
      report: 'Low sugar; given glucose, parent collected at 11:40.',
    });
    await expect(
      closeIncident(deps, principal, {
        ...inst(),
        incidentId: open!.id,
        outcome: 'hospital',
        report: 'Again and again',
      }),
    ).rejects.toMatchObject({ code: 'incident_closed' });
    expect(
      (await incidentReport(deps, principal, { ...inst(), incidentId: open!.id })).report,
    ).toContain('glucose');
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ report: Buffer }>(
        sql`select report from health_incident where id = ${open!.id}`,
      ),
    );
    expect(row!.report.includes(Buffer.from('glucose'))).toBe(false);
  });

  it('staff without the SOS permission are refused; the SOS raiser cannot read incidents', async () => {
    await expect(
      raiseSos(deps, clerk, { ...inst(), kind: 'fire', location: 'Canteen' }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(incidents(deps, teacher, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});
