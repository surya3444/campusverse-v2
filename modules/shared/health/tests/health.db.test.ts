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
  HEALTH_BREAK_GLASS_OPENED,
  HEALTH_VISIT_RECORDED,
  healthJobs,
  healthRecord,
  healthTotals,
  openBreakGlass,
  recordVisit,
  saveHealthRecord,
  visitsToday,
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
let clerk: Actor;
let dpoId: string;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const at = () => ({ institutionId: t.institutionId, studentId: t.studentId });

beforeAll(async () => {
  t = await seedTenant(db, 'Health');
  nurse = actor(
    await seedAdmin(db, t.orgId, [
      'health.record.read',
      'health.record.update',
      'health.visit.record',
      'health.report.read',
      'health.emergency.open',
    ]),
  );
  principal = actor(await seedAdmin(db, t.orgId, ['health.report.read', 'health.emergency.open']));
  clerk = actor(await seedAdmin(db, t.orgId, ['people.student.read']));
  dpoId = await seedAdmin(db, t.orgId, ['platform.privacy.manage']);
});
afterAll(() => close());

describe('health vault', () => {
  it('the nurse writes and reads a sealed record; the database holds no plain text', async () => {
    await saveHealthRecord(deps, nurse, {
      ...at(),
      vault: {
        bloodGroup: 'B+',
        allergies: 'Peanuts',
        conditions: 'Asthma',
        medicines: 'Salbutamol inhaler',
        responderNotes: 'Inhaler in the front pocket of the bag.',
      },
    });
    const r = await healthRecord(deps, nurse, at());
    expect(r.vault).toMatchObject({ bloodGroup: 'B+', allergies: 'Peanuts', conditions: 'Asthma' });
    expect(r.recorded).toBe(true);

    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ vault: Buffer; hasAllergies: boolean }>(sql`
        select vault, has_allergies as "hasAllergies" from health_record
        where student_person_id = ${t.studentId}`),
    );
    expect(row!.vault.includes(Buffer.from('Peanuts'))).toBe(false);
    expect(row!.hasAllergies).toBe(true);

    // Sealed with the health keys: the field keys can't open it.
    const plain = { ...deps, keys: parseFieldKeys(env.FIELD_KEYS) };
    await expect(healthRecord(plain, nurse, at())).rejects.toThrow();

    const [read] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from audit_event where action = 'health.record.read'
          and entity_id = ${t.studentId} and data_class = 'sensitive'`),
    );
    expect(read!.n).toBe(1);
  });

  it('sick-room visits are sealed; others learn only the outcome', async () => {
    await recordVisit(deps, nurse, {
      ...at(),
      notes: { complaint: 'Wheezing after games', care: 'Inhaler, rested 20 minutes' },
      outcome: 'sent_home',
      parentTold: true,
    });
    expect((await healthRecord(deps, nurse, at())).visits[0]).toMatchObject({
      outcome: 'sent_home',
      notes: { complaint: 'Wheezing after games' },
    });
    expect((await visitsToday(deps, nurse, t.institutionId))[0]).toMatchObject({
      studentId: t.studentId,
      outcome: 'sent_home',
    });
    const [e] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ payload: Record<string, unknown> }>(sql`
        select payload from ops.outbox where org_id = ${t.orgId} and type = ${HEALTH_VISIT_RECORDED}`),
    );
    expect(Object.keys(e!.payload).sort()).toEqual([
      'institutionId',
      'outcome',
      'studentId',
      'visitId',
    ]);
  });

  it('management sees totals, never names; small counts are hidden', async () => {
    const totals = await healthTotals(deps, principal, t.institutionId);
    // One student with a record: fewer than 5, so hidden.
    expect(totals.records).toBeNull();
    expect(totals.allergies).toBeNull();
    expect(JSON.stringify(totals)).not.toContain(t.studentId);
    await expect(healthRecord(deps, principal, at())).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });

  it('break-glass shows life-saving details only, expires, is recorded and tells the DPO', async () => {
    await expect(openBreakGlass(deps, principal, { ...at(), reason: 'short' })).rejects.toThrow();
    const view = await openBreakGlass(deps, principal, {
      ...at(),
      reason: 'Student collapsed on the playground',
    });
    expect(view).toMatchObject({ bloodGroup: 'B+', allergies: 'Peanuts' });
    expect(view).not.toHaveProperty('conditions');
    expect(view).not.toHaveProperty('medicines');
    expect(new Date(view.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ events: number; reason: string }>(sql`
        select
          (select count(*)::int from ops.outbox where org_id = ${t.orgId} and type = ${HEALTH_BREAK_GLASS_OPENED}) as events,
          (select reason from audit_event where action = 'health.emergency.open' order by occurred_at desc limit 1) as reason`),
    );
    expect(row).toEqual({ events: 1, reason: 'Student collapsed on the playground' });
    expect((await healthTotals(deps, principal, t.institutionId)).breakGlassThisMonth).toBe(1);

    // The Data Protection Officer hears at once: who, whom, when, why; no health detail.
    const [event] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<OutboxEvent>(sql`
        select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
        from ops.outbox where org_id = ${t.orgId} and type = ${HEALTH_BREAK_GLASS_OPENED}`),
    );
    const [job] = healthJobs();
    expect(await runConsumer(db, job!, event!)).toBe('processed');
    const [msg] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ kind: string; body: string }>(sql`
        select kind, body from notification_message where recipient_person_id = ${dpoId}`),
    );
    expect(msg!.kind).toBe('urgent');
    expect(msg!.body).toContain('Student collapsed on the playground');
    expect(msg!.body).not.toContain('Peanuts');
  });

  it('staff without health permissions are refused everything', async () => {
    await expect(healthRecord(deps, clerk, at())).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    await expect(healthTotals(deps, clerk, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    await expect(
      openBreakGlass(deps, clerk, { ...at(), reason: 'Student collapsed on the playground' }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      saveHealthRecord(deps, clerk, {
        ...at(),
        vault: {
          bloodGroup: null,
          allergies: '',
          conditions: '',
          medicines: '',
          responderNotes: '',
        },
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
  });
});
