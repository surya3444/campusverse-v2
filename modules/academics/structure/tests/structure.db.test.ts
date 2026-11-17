import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addBatch,
  addProgram,
  advanceTerm,
  batchView,
  coursesForBatchTerm,
  draftRegulation,
  enrolStudent,
  enrolFromFile,
  publishRegulation,
  regulationView,
  setCurriculumCourse,
  structureOverview,
  type StructureDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: StructureDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let collegeId: string;
let dean: Actor;
let teacher: Actor;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const course = (code: string, termNumber: number, credits: number) => ({
  code,
  title: `Course ${code}`,
  termNumber,
  kind: 'core' as const,
  lecture: credits,
  tutorial: 0,
  practical: 0,
  credits,
});

beforeAll(async () => {
  t = await seedTenant(db, 'Engine');
  collegeId = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, profile, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'college', 'autonomous_college', 'JNTUH', 'Synthetic Engineering College'
      from institution where org_id = app_current_org() and id = ${t.institutionId}
      returning id::text`);
    return r!.id;
  });
  dean = actor(
    await seedAdmin(db, t.orgId, [
      'academics.structure.read',
      'academics.structure.manage',
      'academics.enrolment.manage',
    ]),
  );
  teacher = actor(await seedAdmin(db, t.orgId, ['academics.structure.read']));
});
afterAll(() => close());

describe('academic engine', () => {
  let programId: string;
  let r1: string;
  let batchId: string;

  it('a program and a regulation drafted course by course, checked against UGC credits', async () => {
    programId = await addProgram(deps, dean, {
      institutionId: collegeId,
      code: 'BSC-CS',
      name: 'B.Sc. Computer Science',
      level: 'ug',
      termKind: 'semester',
      terms: 6,
      framework: 'UGC_UG3',
    });
    r1 = await draftRegulation(deps, dean, {
      programId,
      code: 'R25',
      effectiveFrom: '2025-06-01',
      minCredits: null,
    });
    for (let term = 1; term <= 6; term++) {
      await setCurriculumCourse(deps, dean, {
        regulationId: r1,
        ...course(`CS${term}01`, term, 12),
      });
      await setCurriculumCourse(deps, dean, {
        regulationId: r1,
        ...course(`CS${term}02`, term, 8),
      });
    }
    await expect(
      setCurriculumCourse(deps, dean, { regulationId: r1, ...course('CS701', 7, 4) }),
    ).rejects.toMatchObject({ code: 'term_out_of_range' });

    const v = await regulationView(deps, teacher, r1);
    expect(v.check).toMatchObject({ totalCredits: 120, blocking: [], warnings: [] });
    expect(v.framework?.totalCredits).toBe(120);
    expect(v.courses).toHaveLength(12);
  });

  it('a batch needs a published regulation; publishing freezes it, even for the database', async () => {
    const batch = {
      programId,
      regulationId: r1,
      startYear: 2025,
      label: null,
      intake: 120,
      sections: ['A', 'B'],
      capacity: 2,
      startsOn: '2025-07-01',
      endsOn: '2025-11-30',
    };
    await expect(addBatch(deps, dean, batch)).rejects.toMatchObject({
      code: 'regulation_not_published',
    });
    await publishRegulation(deps, dean, r1);
    await expect(
      setCurriculumCourse(deps, dean, { regulationId: r1, ...course('CS101', 1, 4) }),
    ).rejects.toMatchObject({ code: 'regulation_published' });
    await expect(
      withTenant(db, t.orgId, (tx) =>
        tx.execute(sql`update academic_curriculum set credits = 1 where regulation_id = ${r1}`),
      ),
    ).rejects.toThrow();

    batchId = await addBatch(deps, dean, batch);
    const o = await structureOverview(deps, teacher, collegeId);
    expect(o.profile).toBe('autonomous_college');
    expect(o.batches[0]).toMatchObject({
      label: '2025–28',
      regulation: 'R25 v1',
      currentTerm: 1,
      parity: 'odd',
      sections: 2,
    });
  });

  it('a second version copies the first; the batch keeps v1', async () => {
    const r2 = await draftRegulation(deps, dean, {
      programId,
      code: 'R25',
      effectiveFrom: '2026-06-01',
      minCredits: null,
    });
    await expect(
      draftRegulation(deps, dean, {
        programId,
        code: 'R25',
        effectiveFrom: '2026-06-01',
        minCredits: null,
      }),
    ).rejects.toMatchObject({ code: 'draft_exists' });
    await setCurriculumCourse(deps, dean, { regulationId: r2, ...course('CS101', 1, 10) });
    const v2 = await regulationView(deps, dean, r2);
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    expect(v2.courses).toHaveLength(12);
    expect(v2.check.termCredits[0]).toBe(18);
    expect((await regulationView(deps, dean, r1)).check.termCredits[0]).toBe(20);
    expect((await batchView(deps, dean, batchId)).regulation).toBe('R25 v1');
  });

  it('students enrol into sections up to capacity, as lifelong learner records', async () => {
    const b = await batchView(deps, dean, batchId);
    const a = b.sectionList.find((s) => s.name === 'A')!;
    const asha = await enrolStudent(deps, dean, {
      batchId,
      sectionId: a.id,
      name: 'Synthetic Asha Rao',
      dateOfBirth: '2007-03-14',
      registerNumber: '25CS001',
    });
    await enrolStudent(deps, dean, {
      batchId,
      sectionId: a.id,
      name: 'Synthetic Ravi Kumar',
      dateOfBirth: null,
      registerNumber: '25CS002',
    });
    await expect(
      enrolStudent(deps, dean, {
        batchId,
        sectionId: a.id,
        name: 'Synthetic Third',
        dateOfBirth: null,
        registerNumber: null,
      }),
    ).rejects.toMatchObject({ code: 'section_full' });
    const roster = (await batchView(deps, teacher, batchId)).roster;
    expect(roster.map((r) => r.registerNumber)).toEqual(['25CS001', '25CS002']);
    const [m] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ kind: string; from: string }>(sql`
        select kind, lower(valid_during)::text as from from institution_membership
        where person_id = ${asha} and institution_id = ${collegeId}`),
    );
    expect(m).toEqual({ kind: 'student', from: '2025-07-01' });
  });

  it('enrols a batch from a file: every row checked, only ready rows enrolled', async () => {
    const csv = [
      'Name,Register number,Section,Date of birth',
      'Synthetic Bina Shah,25CS003,B,12/01/2007',
      'Synthetic Chetan Rao,25CS004,b,',
      'Synthetic Overflow,25CS005,B,',
      'Synthetic Late,25CS006,A,',
      'Synthetic Elsewhere,25CS007,C,',
      'Synthetic Again,25CS001,B,',
      'Z,25CS008,B,',
    ].join('\n');
    await expect(
      enrolFromFile(deps, teacher, { batchId, csv, apply: false }),
    ).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
    const check = await enrolFromFile(deps, dean, { batchId, csv, apply: false });
    expect(check.rows.map((r) => r.outcome)).toEqual([
      'ready',
      'ready',
      'section_full',
      'section_full',
      'unknown_section',
      'register_taken',
      'name_missing',
    ]);
    expect(check).toMatchObject({ ready: 2, enrolled: 0 });
    expect((await batchView(deps, dean, batchId)).roster).toHaveLength(2);
    const done = await enrolFromFile(deps, dean, { batchId, csv, apply: true });
    expect(done.enrolled).toBe(2);
    const roster = (await batchView(deps, teacher, batchId)).roster;
    expect(roster.map((r) => r.registerNumber).sort()).toEqual([
      '25CS001',
      '25CS002',
      '25CS003',
      '25CS004',
    ]);
    await expect(
      enrolFromFile(deps, dean, { batchId, csv: 'Register,Section\n1,A', apply: false }),
    ).rejects.toMatchObject({ code: 'file_columns' });
  });

  it('a batch advances by terms, never by copying; this term’s courses follow its parity', async () => {
    const term1 = await withTenant(db, t.orgId, (tx) => coursesForBatchTerm(tx, batchId));
    expect(term1).toMatchObject({ term: 1, parity: 'odd' });
    expect(term1!.courses.map((c) => c.code)).toEqual(['CS101', 'CS102']);

    await expect(
      advanceTerm(deps, dean, {
        batchId,
        fromTerm: 1,
        next: { startsOn: '2025-11-01', endsOn: '2026-04-30' },
      }),
    ).rejects.toMatchObject({ code: 'term_dates' });
    const next = { startsOn: '2026-01-02', endsOn: '2026-05-31' };
    expect(await advanceTerm(deps, dean, { batchId, fromTerm: 1, next })).toEqual({
      term: 2,
      completed: false,
    });
    // A second click on the same screen does nothing.
    await expect(advanceTerm(deps, dean, { batchId, fromTerm: 1, next })).rejects.toMatchObject({
      code: 'term_changed',
    });
    const b = await batchView(deps, dean, batchId);
    expect(b).toMatchObject({ currentTerm: 2, parity: 'even', students: 4 });
    expect(b.thisTerm.map((c) => c.code)).toEqual(['CS201', 'CS202']);
    expect(b.termHistory.map((x) => [x.number, x.status])).toEqual([
      [1, 'closed'],
      [2, 'open'],
    ]);

    // Through to the end: the batch completes and its enrolments end as completed.
    const terms: [string, string][] = [
      ['2026-07-01', '2026-11-30'],
      ['2027-01-02', '2027-05-31'],
      ['2027-07-01', '2027-11-30'],
      ['2028-01-02', '2028-05-31'],
    ];
    for (const [i, [startsOn, endsOn]] of terms.entries())
      await advanceTerm(deps, dean, { batchId, fromTerm: i + 2, next: { startsOn, endsOn } });
    expect(await advanceTerm(deps, dean, { batchId, fromTerm: 6, next: null })).toEqual({
      term: null,
      completed: true,
    });
    const done = await batchView(deps, dean, batchId);
    expect(done).toMatchObject({ status: 'completed', students: 0 });
    const [n] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from academic_enrolment
        where batch_id = ${batchId} and ended_reason = 'completed' and until_term = 6`),
    );
    expect(n!.n).toBe(4);
  });

  it('schools keep classes; readers can’t write; others see nothing', async () => {
    await expect(
      addProgram(deps, dean, {
        institutionId: t.institutionId,
        code: 'BCOM',
        name: 'B.Com.',
        level: 'ug',
        termKind: 'semester',
        terms: 6,
        framework: null,
      }),
    ).rejects.toMatchObject({ code: 'school_uses_classes' });
    await expect(
      draftRegulation(deps, teacher, {
        programId,
        code: 'R27',
        effectiveFrom: '2027-06-01',
        minCredits: null,
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    const stranger = actor(await seedAdmin(db, t.orgId, ['people.student.read']));
    await expect(structureOverview(deps, stranger, collegeId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});
