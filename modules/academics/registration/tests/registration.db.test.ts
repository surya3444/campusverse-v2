import {
  addBatch,
  addProgram,
  advanceTerm,
  batchView,
  draftRegulation,
  enrolStudent,
  publishRegulation,
  setCurriculumCourse,
} from '@campusverse/academics-structure';
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REGISTRATION_APPROVED,
  decideRegistration,
  register,
  registrationBoard,
  saveWindow,
  type RegistrationDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: RegistrationDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let dean: Actor;
let office: Actor;
let teacher: Actor;
let batchId: string;
const students: string[] = [];
const ids: Record<string, string> = {};
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const OPEN = { opensOn: '2020-01-01', closesOn: '2099-12-31' };

beforeAll(async () => {
  t = await seedTenant(db, 'Registration');
  const collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'affiliated_college', 'VTU', 'Synthetic Arts College'
      from institution where org_id = app_current_org() and id = ${t.institutionId}
      returning id::text`);
    return r!.id;
  });
  dean = actor(
    await seedAdmin(db, t.orgId, [
      'academics.structure.read',
      'academics.structure.manage',
      'academics.enrolment.manage',
      'academics.registration.manage',
      'academics.registration.approve',
    ]),
  );
  office = actor(
    await seedAdmin(db, t.orgId, ['academics.structure.read', 'academics.registration.manage']),
  );
  teacher = actor(await seedAdmin(db, t.orgId, ['academics.structure.read']));

  const programId = await addProgram(deps, dean, {
    institutionId: collegeId,
    code: 'BA-ECO',
    name: 'B.A. Economics',
    level: 'ug',
    termKind: 'semester',
    terms: 2,
    framework: null,
  });
  const regulationId = await draftRegulation(deps, dean, {
    programId,
    code: 'R26',
    effectiveFrom: '2026-06-01',
    minCredits: null,
  });
  for (const [code, termNumber, kind, credits] of [
    ['EC101', 1, 'core', 4],
    ['EC191', 1, 'lab', 2],
    ['EC151', 1, 'elective', 3],
    ['EC152', 1, 'elective', 3],
    ['HS101', 1, 'open_elective', 2],
    ['EC201', 2, 'core', 4],
  ] as const) {
    ids[code] = await setCurriculumCourse(deps, dean, {
      regulationId,
      code,
      title: `Course ${code}`,
      termNumber,
      kind,
      lecture: credits,
      tutorial: 0,
      practical: 0,
      credits,
    });
  }
  await publishRegulation(deps, dean, regulationId);
  batchId = await addBatch(deps, dean, {
    programId,
    regulationId,
    startYear: 2026,
    label: null,
    intake: null,
    sections: ['A'],
    capacity: 60,
    startsOn: '2026-07-01',
    endsOn: '2026-11-30',
  });
  const sectionId = (await batchView(deps, dean, batchId)).sectionList[0]!.id;
  for (const n of ['One', 'Two', 'Three'])
    students.push(
      await enrolStudent(deps, dean, {
        batchId,
        sectionId,
        name: `Synthetic Student ${n}`,
        dateOfBirth: null,
        registerNumber: `26EC00${students.length + 1}`,
      }),
    );
});
afterAll(() => close());

describe('course registration', () => {
  it('offers only the batch’s current term, with default limits, before any window', async () => {
    const b = await registrationBoard(deps, teacher, batchId);
    expect(b.window).toBeNull();
    expect(b.batch).toMatchObject({ currentTerm: 1, parity: 'odd' });
    expect(b.courses.map((c) => c.code)).toEqual(['EC101', 'EC151', 'EC152', 'EC191', 'HS101']);
    expect(b.defaults).toMatchObject({ min: 6, max: 14 });
    await expect(
      register(deps, office, { batchId, studentId: students[0]!, electiveIds: [] }),
    ).rejects.toMatchObject({ code: 'no_window' });
  });

  it('checks credit limits, seat caps and the term on every registration', async () => {
    await saveWindow(deps, dean, {
      batchId,
      ...OPEN,
      minCredits: 9,
      maxCredits: 12,
      caps: [
        { courseId: ids.EC151!, seats: 1 },
        { courseId: ids.EC201!, seats: 5 },
      ],
    });
    const [s1, s2, s3] = students as [string, string, string];
    await register(deps, office, { batchId, studentId: s1, electiveIds: [ids.EC151!] });
    await expect(
      register(deps, office, { batchId, studentId: s2, electiveIds: [ids.EC151!] }),
    ).rejects.toMatchObject({ code: 'selection', details: [{ kind: 'full', code: 'EC151' }] });
    await register(deps, office, {
      batchId,
      studentId: s2,
      electiveIds: [ids.EC152!, ids.HS101!],
    });
    // Another semester's course can't be chosen: the wrong-parity defect, designed out.
    await expect(
      register(deps, office, { batchId, studentId: s3, electiveIds: [ids.EC201!, ids.EC152!] }),
    ).rejects.toMatchObject({
      code: 'selection',
      details: [{ kind: 'not_offered', courseId: ids.EC201 }],
    });
    await expect(
      register(deps, office, {
        batchId,
        studentId: s3,
        electiveIds: [ids.EC151!, ids.EC152!, ids.HS101!],
      }),
    ).rejects.toMatchObject({ code: 'selection' });
    await expect(
      register(deps, office, { batchId, studentId: s3, electiveIds: [] }),
    ).rejects.toMatchObject({ details: [{ kind: 'below_min', credits: 6, min: 9 }] });

    const b = await registrationBoard(deps, dean, batchId);
    expect(b.courses.find((c) => c.code === 'EC151')).toMatchObject({ seats: 1, taken: 1 });
    // The cap on a core course was ignored.
    expect(b.courses.find((c) => c.code === 'EC101')?.seats).toBeNull();
    expect(b.students.map((s) => s.registration?.credits ?? null)).toEqual([9, 11, null]);
  });

  it('an approver confirms or returns, never their own entry; returns free the seat', async () => {
    const b = await registrationBoard(deps, dean, batchId);
    const [r1, r2] = b.students.map((s) => s.registration!) as [
      NonNullable<(typeof b.students)[number]['registration']>,
      NonNullable<(typeof b.students)[number]['registration']>,
    ];
    await expect(
      decideRegistration(deps, office, { registrationId: r1.id, decision: 'approve', note: null }),
    ).rejects.toMatchObject({ name: 'ApprovalError', code: 'own_request' });
    await expect(
      decideRegistration(deps, teacher, { registrationId: r1.id, decision: 'approve', note: null }),
    ).rejects.toMatchObject({ code: 'not_your_step' });
    await decideRegistration(deps, dean, {
      registrationId: r1.id,
      decision: 'approve',
      note: null,
    });
    await expect(
      decideRegistration(deps, dean, { registrationId: r1.id, decision: 'approve', note: null }),
    ).rejects.toMatchObject({ code: 'already_decided' });
    await expect(
      decideRegistration(deps, dean, { registrationId: r2.id, decision: 'return', note: ' ' }),
    ).rejects.toMatchObject({ code: 'note_required' });
    await decideRegistration(deps, dean, {
      registrationId: r2.id,
      decision: 'return',
      note: 'Take EC151 instead of the open elective',
    });

    const [e] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ payload: { courseIds: string[]; term: number } }>(sql`
        select payload from ops.outbox where org_id = ${t.orgId} and type = ${REGISTRATION_APPROVED}`),
    );
    expect(e!.payload.term).toBe(1);
    expect(e!.payload.courseIds.sort()).toEqual([ids.EC101, ids.EC191, ids.EC151].sort());

    // The dean enters one and can't approve it.
    const r3 = await register(deps, dean, {
      batchId,
      studentId: students[2]!,
      electiveIds: [ids.EC152!],
    });
    await expect(
      decideRegistration(deps, dean, { registrationId: r3, decision: 'approve', note: null }),
    ).rejects.toMatchObject({ code: 'own_request' });

    const after = await registrationBoard(deps, dean, batchId);
    expect(after.students.map((s) => s.registration?.status)).toEqual([
      'approved',
      'returned',
      'submitted',
    ]);
    // A changed approved registration goes back for approval.
    await register(deps, office, { batchId, studentId: students[0]!, electiveIds: [ids.EC152!] });
    expect((await registrationBoard(deps, dean, batchId)).students[0]!.registration).toMatchObject({
      status: 'submitted',
    });
  });

  it('a closed window refuses; the next term starts with no window', async () => {
    await saveWindow(deps, dean, {
      batchId,
      opensOn: '2020-01-01',
      closesOn: '2020-01-31',
      minCredits: 9,
      maxCredits: 12,
      caps: [],
    });
    await expect(
      register(deps, office, { batchId, studentId: students[2]!, electiveIds: [ids.EC151!] }),
    ).rejects.toMatchObject({ code: 'window_closed' });
    await advanceTerm(deps, dean, {
      batchId,
      fromTerm: 1,
      next: { startsOn: '2027-01-04', endsOn: '2027-05-29' },
    });
    const b = await registrationBoard(deps, dean, batchId);
    expect(b.window).toBeNull();
    expect(b.batch.parity).toBe('even');
    expect(b.courses.map((c) => c.code)).toEqual(['EC201']);
  });

  it('readers can’t register; others see nothing', async () => {
    await expect(
      register(deps, teacher, { batchId, studentId: students[0]!, electiveIds: [] }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    const stranger = actor(await seedAdmin(db, t.orgId, ['people.student.read']));
    await expect(registrationBoard(deps, stranger, batchId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});
