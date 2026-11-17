// Milestone 20 across modules: creating staff, the full record with sealed numbers, documents
// with versions, and staff attendance (check-ins, the office register, settings).
import { loadEnv } from '@campusverse/config';
import { parseFieldKeys } from '@campusverse/crypto';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import {
  addDocument,
  checkDocument,
  createStaff,
  listDocuments,
  staffDetails,
  updateStaffDetails,
  verhoeffDigit,
} from '@campusverse/people-records';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  checkIn,
  markDay,
  myDay,
  register,
  updateAttendanceSettings,
} from '@campusverse/shared-staff-attendance';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const people = { db, permissions, keys: parseFieldKeys(env.FIELD_KEYS), placements: [] };

let t: SeededTenant;
let hr: Actor;
let principal: Actor;
let teacher: Actor;
let today: string;
const GATE = { lat: 12.971599, lng: 77.594566 };

const fileFor = (name: string) =>
  withTenant(db, t.orgId, async (tx) => {
    const [f] = await tx.execute<{ id: string }>(sql`
      insert into stored_file (org_id, purpose, file_name, content_type, size_bytes, storage_key, scan_status)
      values (app_current_org(), 'document', ${name}, 'application/pdf', 2000, ${`${t.orgId}/test/${randomUUID()}`}, 'clean')
      returning id::text`);
    return f!.id;
  });

beforeAll(async () => {
  t = await seedTenant(db, 'Staff');
  hr = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'people.staff.create',
      'people.staff.read',
      'people.staff.update',
      'people.staff.documents',
      'staff.attendance.read',
      'staff.attendance.manage',
    ]),
  };
  principal = { accountId: randomUUID(), orgId: t.orgId, personId: t.principalId };
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
  // The teacher checks themselves in at this school; the campus gate has a location.
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (app_current_org(), 'teacher', 'Teacher') returning id::text`);
    await tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      values (app_current_org(), ${r!.id}, 'staff.attendance.check_in', 'self')`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (app_current_org(), ${t.teacherId}, ${r!.id}, 'institution', ${t.institutionId})`);
    await tx.execute(sql`
      update campus set latitude = ${GATE.lat}, longitude = ${GATE.lng}, geofence_metres = 200
      where org_id = app_current_org() and id = (select campus_id from institution where id = ${t.institutionId})`);
    const [d] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    today = d!.d;
  });
});

afterAll(() => close());

describe('staff records', () => {
  let personId: string;

  it('creates a staff member with the next free employee code', async () => {
    personId = await createStaff(people, hr, {
      institutionId: t.institutionId,
      name: 'Synthetic Kavitha Teacher',
      phone: '+919811100001',
      designation: 'PRT',
      department: 'Primary',
      employmentType: 'permanent',
      joinedOn: '2026-06-01',
    });
    const [s] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ code: string; dept: string }>(sql`
        select employee_code as code, department as dept from staff_profile where org_id = app_current_org() and person_id = ${personId}`),
    );
    expect(s).toMatchObject({ code: expect.stringMatching(/^EMP-\d{4,}$/), dept: 'Primary' });
  });

  it('refuses the same person twice, and anyone without the right to create staff', async () => {
    await expect(
      createStaff(people, hr, {
        institutionId: t.institutionId,
        name: 'synthetic kavitha teacher',
        phone: '+919811100001',
        joinedOn: '2026-06-01',
      }),
    ).rejects.toMatchObject({ code: 'already_staff' });
    await expect(
      createStaff(people, principal, {
        institutionId: t.institutionId,
        name: 'Synthetic Nobody',
        phone: '+919811100009',
        joinedOn: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('seals Aadhaar and the bank account, showing only the last four', async () => {
    const aadhaar = `23412341234${verhoeffDigit('23412341234')}`;
    await updateStaffDetails(people, hr, personId, {
      aadhaar,
      bankAccount: '0011 2233 4455 66',
      bankIfsc: 'SBIN0001234',
      qualifications: 'B.Ed., M.A. English',
    });
    const d = await staffDetails(people, hr, personId);
    expect(d).toMatchObject({
      aadhaar: `XXXX XXXX ${aadhaar.slice(-4)}`,
      bankAccount: 'XXXX XXXX 5566',
      bankIfsc: 'SBIN0001234',
      qualifications: 'B.Ed., M.A. English',
    });
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ sealed: boolean; cls: string }>(sql`
        select s.bank_account_sealed is not null as sealed,
          (select data_class from audit_event where org_id = app_current_org() and entity_id = ${personId}
             and action = 'people.staff.update' order by occurred_at desc limit 1) as cls
        from staff_profile s where s.org_id = app_current_org() and s.person_id = ${personId}`),
    );
    expect(row).toEqual({ sealed: true, cls: 'restricted' });
    await expect(
      updateStaffDetails(people, hr, personId, { bankAccount: '12ab' }),
    ).rejects.toMatchObject({
      code: 'bad_bank_account',
    });
  });

  it('keeps every version of a document and checks it with a name and a reason', async () => {
    await addDocument(people, hr, personId, {
      folder: 'qualifications',
      kind: 'degree',
      title: 'B.Ed. certificate',
      fileId: await fileFor('a.pdf'),
    });
    const second = await addDocument(people, hr, personId, {
      folder: 'qualifications',
      kind: 'degree',
      title: 'B.Ed. certificate (clear copy)',
      fileId: await fileFor('b.pdf'),
    });
    await expect(checkDocument(people, hr, second, { status: 'rejected' })).rejects.toMatchObject({
      code: 'reason_required',
    });
    await checkDocument(people, hr, second, { status: 'verified' });
    const { documents } = await listDocuments(people, hr, personId);
    expect(documents.map((d) => [d.version, d.status])).toEqual([
      [2, 'verified'],
      [1, 'superseded'],
    ]);
    expect(documents[0]?.checkedBy).toBe(hr.personId);
  });

  it('keeps staff papers from people without the HR permission', async () => {
    await expect(listDocuments(people, principal, personId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });
});

describe('staff attendance', () => {
  const near = { lat: 12.9717, lng: 77.5946, accuracyMetres: 15 };
  const far = { lat: 12.99, lng: 77.62, accuracyMetres: 15 };

  it('records a check-in on campus, once even if the device sends it twice', async () => {
    const eventId = randomUUID();
    const tap = {
      institutionId: t.institutionId,
      direction: 'in' as const,
      eventId,
      source: 'web' as const,
      location: near,
    };
    const before = (await myDay(db, teacher, t.institutionId, today)).taps.length;
    expect(await checkIn(db, permissions, teacher, tap)).toMatchObject({ onCampus: true });
    await checkIn(db, permissions, teacher, tap);
    const mine = await myDay(db, teacher, t.institutionId, today);
    expect(mine.taps.length - before).toBe(1);
    expect(mine.day).toMatchObject({ status: 'present', source: 'checkin' });
  });

  it('flags a check-in off campus, and refuses it when the school requires being on campus', async () => {
    const res = await checkIn(db, permissions, teacher, {
      institutionId: t.institutionId,
      direction: 'out',
      eventId: randomUUID(),
      source: 'web',
      location: far,
    });
    expect(res.onCampus).toBe(false);
    expect(res.distance).toBeGreaterThan(2000);
    await updateAttendanceSettings(db, permissions, hr, t.institutionId, {
      startsAt: '08:30',
      endsAt: '15:30',
      lateAfterMinutes: 10,
      earlyBeforeMinutes: 10,
      fullDayMinutes: 300,
      requireOnCampus: true,
    });
    await expect(
      checkIn(db, permissions, teacher, {
        institutionId: t.institutionId,
        direction: 'out',
        eventId: randomUUID(),
        source: 'web',
        location: far,
      }),
    ).rejects.toMatchObject({ code: 'off_campus' });
  });

  it("never lets one person check in someone else's day", async () => {
    // A check-in is always the actor's own; staff who aren't on this school's staff are refused.
    await expect(
      checkIn(db, permissions, hr, {
        institutionId: t.institutionId,
        direction: 'in',
        eventId: randomUUID(),
        source: 'web',
        location: near,
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('lets the office mark the register, which then wins; a change needs a reason', async () => {
    await expect(
      markDay(db, permissions, hr, {
        institutionId: t.institutionId,
        onDate: today,
        personId: t.teacherId,
        status: 'on_duty',
      }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await markDay(db, permissions, hr, {
      institutionId: t.institutionId,
      onDate: today,
      personId: t.teacherId,
      status: 'on_duty',
      reason: 'Board exam duty',
    });
    await checkIn(db, permissions, teacher, {
      institutionId: t.institutionId,
      direction: 'out',
      eventId: randomUUID(),
      source: 'web',
      location: near,
    });
    const day = (await register(db, permissions, hr, t.institutionId, today)).staff.find(
      (s) => s.personId === t.teacherId,
    )?.day;
    expect(day).toMatchObject({
      status: 'on_duty',
      source: 'register',
      markedBy: hr.personId,
      reason: 'Board exam duty',
    });
  });

  it('keeps the register from people without staff attendance rights', async () => {
    await expect(
      register(db, permissions, principal, t.institutionId, today),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      markDay(db, permissions, principal, {
        institutionId: t.institutionId,
        onDate: today,
        personId: t.teacherId,
        status: 'absent',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
