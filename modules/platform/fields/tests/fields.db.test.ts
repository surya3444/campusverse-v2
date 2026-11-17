import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FieldError,
  defineField,
  listFields,
  retireField,
  saveValues,
  updateField,
  valuesOf,
} from '../contract.js';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let other: SeededTenant;
let owner: Actor;
let principal: Actor;

beforeAll(async () => {
  t = await seedTenant(db, 'Fields');
  other = await seedTenant(db, 'Fields other');
  owner = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['platform.fields.manage']),
  };
  // The seeded principal holds student read only: no field management.
  principal = { accountId: randomUUID(), orgId: t.orgId, personId: t.principalId };
});

afterAll(() => close());

const inTenant = <T>(work: Parameters<typeof withTenant<T>>[2]) => withTenant(db, t.orgId, work);

describe('defining fields', () => {
  it('lets an owner add a field, with a key made from the label', async () => {
    await defineField(db, permissions, owner, 'staff', {
      label: 'Blood group',
      type: 'choice',
      options: ['A+', 'B+', 'O+'],
    });
    const fields = await inTenant((tx) => listFields(tx, 'staff'));
    expect(fields.map((f) => [f.key, f.type, f.options])).toContainEqual([
      'blood_group',
      'choice',
      ['A+', 'B+', 'O+'],
    ]);
  });

  it('refuses anyone without platform.fields.manage, and writes nothing', async () => {
    await expect(
      defineField(db, permissions, principal, 'staff', { label: 'Sneaky', type: 'text' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const fields = await inTenant((tx) => listFields(tx, 'staff', { includeRetired: true }));
    expect(fields.some((f) => f.key === 'sneaky')).toBe(false);
  });

  it('refuses a choice field without options', async () => {
    await expect(
      defineField(db, permissions, owner, 'staff', { label: 'Shift', type: 'choice', options: [] }),
    ).rejects.toMatchObject({ code: 'options' });
  });

  it('gives a second field with the same label its own key', async () => {
    const first = await defineField(db, permissions, owner, 'campus', {
      label: 'Gate',
      type: 'text',
    });
    await retireField(db, permissions, owner, first, true);
    await defineField(db, permissions, owner, 'campus', { label: 'Gate', type: 'text' });
    const keys = (await inTenant((tx) => listFields(tx, 'campus', { includeRetired: true }))).map(
      (f) => f.key,
    );
    expect(keys).toEqual(expect.arrayContaining(['gate', 'gate_2']));
  });

  it('changes the label but never the key or type', async () => {
    const id = await defineField(db, permissions, owner, 'institution', {
      label: 'Trust no',
      type: 'text',
    });
    await updateField(db, permissions, owner, id, { label: 'Trust registration number' });
    const [f] = (await inTenant((tx) => listFields(tx, 'institution'))).filter((x) => x.id === id);
    expect(f).toMatchObject({ key: 'trust_no', label: 'Trust registration number', type: 'text' });
  });

  it('writes an audit row naming the field key and who did it', async () => {
    const id = await defineField(db, permissions, owner, 'organisation', {
      label: 'PAN of trust',
      type: 'text',
    });
    const [row] = await inTenant((tx) =>
      tx.execute<{ action: string; actor: string; detail: { key: string } }>(sqlAudit(id)),
    );
    expect(row).toMatchObject({ action: 'platform.fields.define', actor: owner.personId });
    expect(row?.detail.key).toBe('pan_of_trust');
  });
});

describe('values', () => {
  it('checks values against their fields and keeps only what changed', async () => {
    await defineField(db, permissions, owner, 'student', {
      label: 'Bus route',
      type: 'text',
      required: true,
    });
    await defineField(db, permissions, owner, 'student', {
      label: 'Allergies',
      type: 'multi_choice',
      options: ['Nuts', 'Dairy'],
    });
    const changed = await inTenant((tx) =>
      saveValues(tx, 'student', t.studentId, { bus_route: ' Route 4 ', allergies: ['Dairy'] }),
    );
    expect(changed).toEqual(expect.arrayContaining(['bus_route', 'allergies']));
    expect(await inTenant((tx) => valuesOf(tx, 'student', t.studentId))).toMatchObject({
      bus_route: 'Route 4',
      allergies: ['Dairy'],
    });
    const again = await inTenant((tx) =>
      saveValues(tx, 'student', t.studentId, { bus_route: 'Route 4' }),
    );
    expect(again).toEqual([]);
  });

  it('refuses a missing required value, a wrong option and an unknown key, all at once', async () => {
    const err = await inTenant((tx) =>
      saveValues(tx, 'student', t.guardianId, { allergies: ['Gluten'], shoe_size: '9' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FieldError);
    expect((err as FieldError).problems).toEqual({
      bus_route: 'required',
      allergies: 'not_an_option',
      shoe_size: 'invalid',
    });
  });

  it("never shows one school's fields or values to another", async () => {
    const fields = await withTenant(db, other.orgId, (tx) => listFields(tx, 'student'));
    expect(fields.map((f) => f.key)).not.toContain('bus_route');
    const values = await withTenant(db, other.orgId, (tx) => valuesOf(tx, 'student', t.studentId));
    expect(values).toEqual({});
  });
});

const sqlAudit = (id: string) => sql`
  select action, actor_person_id::text as actor, detail from audit_event
  where org_id = app_current_org() and entity_id = ${id} order by occurred_at desc limit 1`;
