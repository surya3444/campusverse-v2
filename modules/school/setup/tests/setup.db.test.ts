// Milestone 7 exit check: a generated school goes from signup to first attendance in one sitting,
// through the real use cases on Postgres. Plus import problems, undo and its refusal.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { runConsumer, type Consumer, type OutboxEvent } from '@campusverse/platform-events';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { generateSchool, STUDENT_HEADER, toXlsx } from '@campusverse/test-data';
import { sql } from 'drizzle-orm';
import { zipSync } from 'fflate';
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyStructure,
  assertYearOpen,
  classesOverview,
  closeYear,
  reopenYear,
  yearsOf,
  commitImport,
  getImport,
  importCommitConsumer,
  invitesConsumer,
  previewImport,
  previewInvites,
  provisionSchool,
  readWorkbook,
  sendInvites,
  setUpNextYear,
  setupReadiness,
  undoImport,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);

afterAll(() => close());

const iso = (offsetDays: number) =>
  new Date(Date.now() + 330 * 60_000 + offsetDays * 864e5).toISOString().slice(0, 10);
const randomMobile = () => `9${randomInt(100_000_000, 999_999_999)}`;

/** Plays the worker: runs pending outbox events of one tenant through a consumer. */
async function drain(orgId: string, consumer: Consumer) {
  const events = await db.execute<OutboxEvent>(sql`
    select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
    from ops.outbox where org_id = ${orgId} and published_at is null
      and type in (${sql.join(
        consumer.events.map((t) => sql`${t}`),
        sql`, `,
      )})
    order by id`);
  for (const e of events) {
    await runConsumer(db, consumer, e);
    await db.execute(sql`update ops.outbox set published_at = now() where id = ${e.id}`);
  }
}

async function newSchool() {
  const owner = { name: 'Lakshmi Synthetic Owner', phone: randomMobile() };
  const school = await provisionSchool(db, {
    schoolName: 'Synthetic Setup Public School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner,
  });
  const admin: Actor = {
    accountId: school.ownerAccountId,
    orgId: school.orgId,
    personId: school.ownerPersonId,
  };
  await applyStructure(db, permissions, admin, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-30), // a year that is running today
    ends: iso(300),
    classes: [
      { code: '1', sections: 2, capacity: 30 },
      { code: '5', sections: 1, capacity: 30 },
    ],
  });
  return { school, admin, owner };
}

async function importFile(
  admin: Actor,
  institutionId: string,
  kind: 'students' | 'staff',
  bytes: Buffer,
) {
  const preview = await previewImport(db, permissions, admin, {
    institutionId,
    kind,
    fileName: `${kind}.xlsx`,
    bytes,
  });
  await commitImport(db, permissions, admin, preview.batchId);
  await drain(admin.orgId, importCommitConsumer);
  return { preview, batch: await getImport(db, permissions, admin, preview.batchId) };
}

describe('signup to first attendance', () => {
  it('a generated school is ready for attendance after setup, import and invites', async () => {
    const { school, admin, owner } = await newSchool();
    const shape = {
      classes: [
        { code: '1', sections: ['A', 'B'], studentsPerSection: 12 },
        { code: '5', sections: ['A'], studentsPerSection: 12 },
      ],
      seed: randomInt(1e6),
    };
    const files = await generateSchool(shape, { name: owner.name, phone: owner.phone });

    const staff = await importFile(admin, school.institutionId, 'staff', files.staff);
    expect(staff.preview.counts).toMatchObject({
      total: files.counts.staff,
      valid: files.counts.staff,
      invalid: 0,
    });
    expect(staff.batch?.status).toBe('committed');

    const students = await importFile(admin, school.institutionId, 'students', files.students);
    expect(students.preview.counts).toMatchObject({
      total: 36,
      valid: 36,
      invalid: 0,
      duplicate: 0,
    });
    expect(students.preview.landing).toEqual({ '1-A': 12, '1-B': 12, '5-A': 12 });
    expect(students.batch?.status).toBe('committed');

    // Before invites: everything is in place except the teachers' logins.
    const before = await setupReadiness(db, permissions, admin, school.institutionId);
    expect(before.ready).toBe(false);
    expect(before.checks.find((c) => c.key === 'teacher_logins')?.missing).toEqual([
      '1-A',
      '1-B',
      '5-A',
    ]);

    const invites = await previewInvites(db, permissions, admin, school.institutionId);
    expect(invites).toEqual({
      staff: 3,
      guardians: files.counts.guardians,
      alreadyInvited: 1,
      noPhone: 0,
    });
    await sendInvites(db, permissions, admin, school.institutionId);
    await drain(admin.orgId, invitesConsumer);

    const after = await setupReadiness(db, permissions, admin, school.institutionId);
    expect(after.checks.filter((c) => !c.ok)).toEqual([]);
    expect(after.ready).toBe(true);

    const [facts] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{
        enrolled: number;
        guardians: number;
        owners: number;
        principal: number;
        welcomes: number;
      }>(sql`
        select
          (select count(*)::int from school_enrolment) as enrolled,
          (select count(distinct guardian_person_id)::int from guardian_link) as guardians,
          (select count(*)::int from person where legal_name = ${owner.name}) as owners,
          (select count(*)::int from role_assignment ra join role r on r.id = ra.role_id
             where r.key = 'principal' and ra.person_id = ${admin.personId}) as principal,
          (select count(*)::int from notification_message where dedupe_key like 'invite:%') as welcomes`),
    );
    expect(facts).toEqual({
      enrolled: 36,
      guardians: files.counts.guardians, // siblings share their parent, never duplicated
      owners: 1, // the principal row in the staff file is the owner, not a new person
      principal: 1,
      welcomes: 3 + files.counts.guardians,
    });

    // Asking again sends nobody anything new.
    await sendInvites(db, permissions, admin, school.institutionId);
    await drain(admin.orgId, invitesConsumer);
    expect(await previewInvites(db, permissions, admin, school.institutionId)).toMatchObject({
      staff: 0,
      guardians: 0,
    });
  });
});

describe('imports', () => {
  let ctx: Awaited<ReturnType<typeof newSchool>>;
  beforeAll(async () => {
    ctx = await newSchool();
  });

  const row = (
    adm: string,
    name: string,
    cls: string,
    sec: string,
    roll: number | null,
    phone: string,
  ) => [
    adm,
    name,
    '20/06/2019',
    cls,
    sec,
    roll,
    'Meena Synthetic',
    'Mother',
    phone,
    null,
    null,
    null,
  ];

  it('previews problems row by row, then commits only the valid rows', async () => {
    const bytes = await toXlsx([
      STUDENT_HEADER,
      row('P-1', 'Good One', '1', 'A', 1, randomMobile()),
      row('P-2', 'Bad Phone', '1', 'A', 2, '12345'),
      row('P-3', 'No Such Section', '1', 'Z', 3, randomMobile()),
    ]);
    const { preview, batch } = await importFile(
      ctx.admin,
      ctx.school.institutionId,
      'students',
      bytes,
    );
    expect(preview.counts).toMatchObject({ total: 3, valid: 1, invalid: 2 });
    expect(preview.flagged.map((f) => [f.rowNumber, f.problems.map((p) => p.code)])).toEqual([
      [3, ['bad_phone']],
      [4, ['unknown_section']],
    ]);
    expect(batch?.status).toBe('committed');
    const [n] = await withTenant(db, ctx.school.orgId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from school_enrolment where admission_number like 'P-%'`,
      ),
    );
    expect(n?.n).toBe(1);
  });

  it('nothing is created before commit, and the preview data is cleared after it', async () => {
    const bytes = await toXlsx([
      STUDENT_HEADER,
      row('Q-1', 'Waiting', '1', 'B', null, randomMobile()),
    ]);
    const preview = await previewImport(db, permissions, ctx.admin, {
      institutionId: ctx.school.institutionId,
      kind: 'students',
      fileName: 'q.xlsx',
      bytes,
    });
    const count = () =>
      withTenant(db, ctx.school.orgId, (tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from school_enrolment where admission_number = 'Q-1'`,
        ),
      ).then((r) => r[0]?.n);
    expect(await count()).toBe(0);
    await commitImport(db, permissions, ctx.admin, preview.batchId);
    await drain(ctx.admin.orgId, importCommitConsumer);
    expect(await count()).toBe(1);
    const [data] = await withTenant(db, ctx.school.orgId, (tx) =>
      tx.execute<{ data: unknown }>(
        sql`select data from import_row where batch_id = ${preview.batchId}`,
      ),
    );
    expect(data?.data).toEqual({ purged: true });
  });

  it('undo removes exactly what the batch created, and is refused once the data is in use', async () => {
    const shared = randomMobile();
    const first = await importFile(
      ctx.admin,
      ctx.school.institutionId,
      'students',
      await toXlsx([STUDENT_HEADER, row('U-1', 'Elder Sibling', '5', 'A', null, shared)]),
    );
    const second = await importFile(
      ctx.admin,
      ctx.school.institutionId,
      'students',
      await toXlsx([STUDENT_HEADER, row('U-2', 'Younger Sibling', '1', 'B', null, shared)]),
    );
    const counts = () =>
      withTenant(db, ctx.school.orgId, (tx) =>
        tx.execute<{ students: number; mothers: number; links: number }>(sql`
          select (select count(*)::int from school_enrolment where admission_number like 'U-%') as students,
            (select count(*)::int from person_contact where address = ${`+91${shared}`} and channel = 'sms') as mothers,
            (select count(*)::int from guardian_link g join person_contact c on c.person_id = g.guardian_person_id
               where c.address = ${`+91${shared}`} and c.channel = 'sms') as links`),
      ).then((r) => r[0]);
    expect(await counts()).toEqual({ students: 2, mothers: 1, links: 2 });

    await undoImport(db, permissions, ctx.admin, second.preview.batchId);
    // The younger sibling and their link are gone; the mother came from the first batch and stays.
    expect(await counts()).toEqual({ students: 1, mothers: 1, links: 1 });
    expect((await getImport(db, permissions, ctx.admin, second.preview.batchId))?.status).toBe(
      'undone',
    );

    // Once the mother has a login, the first batch is in use and can't be undone.
    await sendInvites(db, permissions, ctx.admin, ctx.school.institutionId);
    await drain(ctx.admin.orgId, invitesConsumer);
    await expect(
      undoImport(db, permissions, ctx.admin, first.preview.batchId),
    ).rejects.toMatchObject({
      name: 'SetupError',
      code: 'import_in_use',
    });
    expect(await counts()).toEqual({ students: 1, mothers: 1, links: 1 });
  });

  it('a batch that clashes with something committed since its preview fails whole', async () => {
    const make = (adm: string) =>
      toXlsx([STUDENT_HEADER, row(adm, `Roll Clash ${adm}`, '1', 'A', 29, randomMobile())]);
    const a = await previewImport(db, permissions, ctx.admin, {
      institutionId: ctx.school.institutionId,
      kind: 'students',
      fileName: 'a.xlsx',
      bytes: await make('R-1'),
    });
    const b = await previewImport(db, permissions, ctx.admin, {
      institutionId: ctx.school.institutionId,
      kind: 'students',
      fileName: 'b.xlsx',
      bytes: await make('R-2'),
    });
    await commitImport(db, permissions, ctx.admin, a.batchId);
    await commitImport(db, permissions, ctx.admin, b.batchId);
    await drain(ctx.admin.orgId, importCommitConsumer);
    expect((await getImport(db, permissions, ctx.admin, a.batchId))?.status).toBe('committed');
    expect(await getImport(db, permissions, ctx.admin, b.batchId)).toMatchObject({
      status: 'failed',
      failure: 'conflict_since_preview',
    });
  });

  it('refuses files that are not spreadsheets, unpack too large, or miss columns', async () => {
    await expect(readWorkbook(new TextEncoder().encode('name,class\nA,1'))).rejects.toMatchObject({
      code: 'not_xlsx',
    });
    const bomb = zipSync({ 'xl/sheet1.xml': new Uint8Array(70 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(readWorkbook(bomb)).rejects.toMatchObject({ code: 'file_too_large' });
    await expect(
      previewImport(db, permissions, ctx.admin, {
        institutionId: ctx.school.institutionId,
        kind: 'students',
        fileName: 'x.xlsx',
        bytes: await toXlsx([
          ['Student Name', 'Class'],
          ['A', '1'],
        ]),
      }),
    ).rejects.toMatchObject({ code: 'missing_columns' });
  });

  it('only school administrators can import', async () => {
    // A parent of this school: logged in, but not an administrator.
    const [parent] = await withTenant(db, ctx.school.orgId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select guardian_person_id::text as id from guardian_link limit 1`,
      ),
    );
    if (!parent) throw new Error('expected a guardian from the earlier imports');
    const stranger: Actor = { accountId: 'n/a', orgId: ctx.school.orgId, personId: parent.id };
    await expect(
      previewImport(db, permissions, stranger, {
        institutionId: ctx.school.institutionId,
        kind: 'students',
        fileName: 'x.xlsx',
        bytes: await toXlsx([STUDENT_HEADER]),
      }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
  });

  it('the app cannot delete people who were not imported, even directly', async () => {
    const [res] = await withTenant(db, ctx.school.orgId, async (tx) => [
      await tx.execute(sql`delete from person where id = ${ctx.admin.personId}`),
    ]);
    expect(res?.count).toBe(0);
  });
});

describe('next year', () => {
  it('starts the day this year ends, copies sections and subjects, and is not created twice', async () => {
    const { school, admin } = await newSchool();
    const next = await setUpNextYear(db, permissions, admin, school.institutionId);
    expect(next).toMatchObject({ label: '2027-28', starts: iso(301), sections: 3 }); // the day after it ends
    const [counts] = await withTenant(db, school.orgId, (tx) =>
      tx.execute<{ sections: number; offerings: number; was: number; status: string }>(sql`
        select
          (select count(*)::int from school_section where year_id = ${next.yearId}) as sections,
          (select count(*)::int from school_subject_offering where year_id = ${next.yearId}) as offerings,
          (select count(*)::int from school_subject_offering o join school_year y
            on y.org_id = o.org_id and y.id = o.year_id where y.label = '2026-27') as was,
          (select status from school_year where id = ${next.yearId}) as status`),
    );
    expect(counts).toMatchObject({ sections: 3, status: 'planned' });
    expect(counts?.offerings).toBe(counts?.was);
    await expect(setUpNextYear(db, permissions, admin, school.institutionId)).rejects.toMatchObject(
      { code: 'next_year_exists' },
    );
    const overview = await classesOverview(db, permissions, admin, school.institutionId);
    expect(overview.years.map((y) => [y.label, y.status, y.countedOn])).toEqual([
      ['2027-28', 'planned', iso(301)],
      ['2026-27', 'active', iso(0)],
    ]);
    expect(overview.years[1]?.classes.map((c) => c.sections.map((x) => x.label))).toEqual([
      ['Class 1-A', 'Class 1-B'],
      ['Class 5-A'],
    ]);
    expect(overview.years[1]?.classes[0]?.sections[0]).toMatchObject({ capacity: 30, students: 0 });
    const stranger: Actor = { accountId: 'n/a', orgId: school.orgId, personId: admin.accountId };
    await expect(
      setUpNextYear(db, permissions, stranger, school.institutionId),
    ).rejects.toBeTruthy();
  });
});

describe('closing a year', () => {
  it('locks an ended year, refuses a running one, and reopens only with a reason', async () => {
    const { school, admin } = await newSchool();
    await applyStructure(db, permissions, admin, school.institutionId, {
      board: 'CBSE',
      yearLabel: '2025-26',
      starts: iso(-400),
      ends: iso(-31),
      classes: [{ code: '1', sections: 1, capacity: 30 }],
    });
    const years = () => withTenant(db, school.orgId, (tx) => yearsOf(tx, school.institutionId));
    const [past, running] = await years();
    expect([past?.status, running?.status]).toEqual(['ended', 'active']);

    const close = (yearId: string) =>
      closeYear(db, permissions, admin, { institutionId: school.institutionId, yearId });
    await expect(close(running!.yearId)).rejects.toMatchObject({ code: 'year_not_ended' });
    await close(past!.yearId);
    expect((await years())[0]?.status).toBe('closed');
    await expect(close(past!.yearId)).rejects.toMatchObject({ code: 'year_closed' });
    await expect(
      withTenant(db, school.orgId, (tx) => assertYearOpen(tx, past!.yearId)),
    ).rejects.toMatchObject({ code: 'year_closed' });

    await expect(
      reopenYear(db, permissions, admin, {
        institutionId: school.institutionId,
        yearId: past!.yearId,
        reason: 'no',
      }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await reopenYear(db, permissions, admin, {
      institutionId: school.institutionId,
      yearId: past!.yearId,
      reason: 'Correct a Class 1 attendance entry',
    });
    expect((await years())[0]?.status).toBe('ended');
  });
});
