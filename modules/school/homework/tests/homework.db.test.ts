// Homework and the class diary (docs/specs/HOMEWORK.md): who may set it where, guardians told
// once (and again when the date moves), the parent's view and done tick, attachments, the diary.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HOMEWORK_DUE_CHANGED,
  HOMEWORK_SET,
  childHomework,
  editDiary,
  editHomework,
  homeworkFile,
  homeworkJobs,
  homeworkTools,
  markDone,
  myClasses,
  sectionHomework,
  setHomework,
  withdrawHomework,
  writeDiary,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let teacher: Actor;
let other: Actor;
let principal: Actor;
let parent: Actor;
let sectionId: string;
let subjectId: string;
let fileId: string;
let today: string;
const plus = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
const input = (i: Partial<Parameters<typeof setHomework>[2]> = {}) => ({
  institutionId: t.institutionId,
  sectionIds: [sectionId],
  subjectId,
  title: 'Exercise 4.2, questions 1 to 10',
  details: 'Show working.',
  dueOn: plus(today, 2),
  fileIds: [],
  ...i,
});
/**
 * Runs the guardians' consumer as the worker would, and counts the messages for this homework and
 * its due date (a running dev worker may deliver the same event: the dedupe key keeps it to one).
 */
const tellGuardians = (homeworkId: string, type = HOMEWORK_SET) =>
  withTenant(db, t.orgId, async (tx) => {
    await homeworkJobs()[0]!.handle!(tx, {
      id: randomUUID(),
      orgId: t.orgId,
      type,
      payload: { homeworkId },
    } as never);
    const [n] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from notification_message m join school_homework h
        on h.org_id = m.org_id and h.id = ${homeworkId}
      where m.org_id = app_current_org() and m.kind = 'homework'
        and m.dedupe_key like 'homework:' || ${homeworkId} || ':' || h.due_on::text || ':%'`);
    return n?.n ?? 0;
  });

beforeAll(async () => {
  t = await seedTenant(db, 'Homework');
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
  principal = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'school.homework.read',
      'school.homework.set',
      'school.homework.manage',
    ]),
  };
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  await grantPermission(db, t.orgId, 'parent', 'school.homework.read', 'guardian');
  await grantPermission(db, t.orgId, 'parent', 'school.homework.done', 'guardian');
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (app_current_org(), 'teacher', 'Teacher') returning id::text`);
    for (const p of ['school.homework.read', 'school.homework.set'])
      await tx.execute(sql`
        insert into role_grant (org_id, role_id, permission) values (app_current_org(), ${r!.id}, ${p})`);
    // A second teacher who teaches nothing in this section.
    const [o] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Other Teacher') returning id::text`);
    for (const pid of [t.teacherId, o!.id])
      await tx.execute(sql`
        insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
        values (app_current_org(), ${pid}, ${r!.id}, 'institution', ${t.institutionId})`);
    other = { accountId: randomUUID(), orgId: t.orgId, personId: o!.id };
    const [s] = await tx.execute<{ sectionId: string; subjectId: string; d: string }>(sql`
      select hs.section_id::text as "sectionId", h.subject_id::text as "subjectId", app_today()::text as d
      from school_homework h join school_homework_section hs on hs.org_id = h.org_id and hs.homework_id = h.id
      where h.org_id = app_current_org() limit 1`);
    sectionId = s!.sectionId;
    subjectId = s!.subjectId;
    today = s!.d;
    const [f] = await tx.execute<{ id: string }>(sql`
      insert into stored_file (org_id, purpose, file_name, content_type, size_bytes, storage_key, scan_status)
      values (app_current_org(), 'homework', 'worksheet.pdf', 'application/pdf', 2000, ${`${t.orgId}/test/${randomUUID()}`}, 'clean')
      returning id::text`);
    fileId = f!.id;
  });
});
afterAll(() => close());

describe('setting homework', () => {
  it('lets the class teacher set it, tells each guardian once, and shows done counts', async () => {
    const r = await setHomework(deps, teacher, input({ fileIds: [fileId] }));
    expect(await tellGuardians(r.id)).toBe(1);
    // A second delivery of the same event queues nothing more.
    expect(await tellGuardians(r.id)).toBe(1);
    const view = await sectionHomework(deps, teacher, sectionId);
    const h = view.homework.find((x) => x.id === r.id);
    expect(h).toMatchObject({
      title: 'Exercise 4.2, questions 1 to 10',
      mine: true,
      sections: [{ sectionId, done: 0, of: 1 }],
      files: [{ fileId, fileName: 'worksheet.pdf', ready: true }],
    });
  });

  it('refuses a teacher who doesn’t teach the section, and bad dates', async () => {
    expect(await code(setHomework(deps, other, input()))).toBe('denied');
    expect(await code(setHomework(deps, teacher, input({ dueOn: plus(today, -1) })))).toBe(
      'due_in_past',
    );
    expect(await code(setHomework(deps, teacher, input({ dueOn: plus(today, 61) })))).toBe(
      'due_too_far',
    );
    // The principal sets it for any section.
    expect(await code(setHomework(deps, principal, input()))).toBe('ok');
    // My classes: the teacher's section with its subject; nothing for the other teacher.
    const mine = await myClasses(deps, teacher, t.institutionId);
    expect(mine.classes.map((c) => c.sectionId)).toEqual([sectionId]);
    expect((await myClasses(deps, other, t.institutionId)).classes).toEqual([]);
  });

  it('tells guardians again when the date moves; only its setter or a manager changes it', async () => {
    const r = await setHomework(deps, teacher, input({ title: 'Read chapter 5' }));
    await tellGuardians(r.id);
    const edit = { homeworkId: r.id, title: 'Read chapter 5', details: '', fileIds: [] };
    await editHomework(deps, teacher, { ...edit, dueOn: plus(today, 3) });
    expect(await tellGuardians(r.id, HOMEWORK_DUE_CHANGED)).toBe(1);
    expect(await code(editHomework(deps, other, { ...edit, dueOn: plus(today, 4) }))).toBe(
      'denied',
    );
    await withdrawHomework(deps, principal, r.id);
    expect(await code(withdrawHomework(deps, teacher, r.id))).toBe('withdrawn');
  });
});

describe("a parent's view", () => {
  it('shows the child’s open homework, takes a done tick, and opens attachments', async () => {
    const r = await setHomework(deps, teacher, input({ title: 'Draw a map', fileIds: [fileId] }));
    const view = await childHomework(deps, parent, t.studentId);
    const h = view.homework.find((x) => x.id === r.id);
    expect(h).toMatchObject({ done: false, files: [{ fileId }] });
    expect(view.diary.length).toBeGreaterThan(0);
    await markDone(deps, parent, { homeworkId: r.id, studentId: t.studentId, done: true });
    expect(
      (await childHomework(deps, parent, t.studentId)).homework.find((x) => x.id === r.id)?.done,
    ).toBe(true);
    const counts = (await sectionHomework(deps, teacher, sectionId)).homework.find(
      (x) => x.id === r.id,
    );
    expect(counts?.sections[0]).toMatchObject({ done: 1, of: 1 });
    expect(
      await homeworkFile(deps, parent, { homeworkId: r.id, fileId, studentId: t.studentId }),
    ).toBe(fileId);
    // Withdrawn: gone for parents, and its file with it.
    await withdrawHomework(deps, teacher, r.id);
    expect(
      (await childHomework(deps, parent, t.studentId)).homework.some((x) => x.id === r.id),
    ).toBe(false);
    expect(
      await code(homeworkFile(deps, parent, { homeworkId: r.id, fileId, studentId: t.studentId })),
    ).toBe('file_not_found');
  });

  it('keeps other children’s homework and staff screens from parents', async () => {
    // A child who isn't theirs.
    const stranger = await withTenant(db, t.orgId, async (tx) => {
      const [p] = await tx.execute<{ id: string }>(sql`
        insert into person (org_id, legal_name) values (app_current_org(), 'Synthetic Other Child') returning id::text`);
      return p!.id;
    });
    await expect(childHomework(deps, parent, stranger)).rejects.toBeInstanceOf(PermissionDenied);
    await expect(sectionHomework(deps, parent, sectionId)).rejects.toBeInstanceOf(PermissionDenied);
    const r = await setHomework(deps, teacher, input());
    await expect(
      markDone(deps, teacher, { homeworkId: r.id, studentId: t.studentId, done: true }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('the class diary', () => {
  it('takes entries from the section’s teachers, editable the same day by their writer', async () => {
    // No diary on Sundays: on a Sunday the entry is for Saturday, which its writer can't edit today.
    const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0;
    const day = sunday ? plus(today, -1) : today;
    const { id } = await writeDiary(deps, teacher, {
      sectionId,
      onDate: day,
      subjectId: null,
      body: sunday
        ? 'Sports day practice after lunch. Bring shoes.'
        : 'Sports day practice after lunch.',
    });
    if (sunday)
      expect(await code(editDiary(deps, teacher, { entryId: id, body: 'x' }))).toBe('not_editable');
    else
      await editDiary(deps, teacher, {
        entryId: id,
        body: 'Sports day practice after lunch. Bring shoes.',
      });
    expect(await code(editDiary(deps, other, { entryId: id, body: 'x' }))).toBe('not_editable');
    expect(
      await code(writeDiary(deps, other, { sectionId, onDate: day, subjectId, body: 'Not mine' })),
    ).toBe('denied');
    expect(
      await code(
        writeDiary(deps, teacher, {
          sectionId,
          onDate: plus(today, 1),
          subjectId,
          body: 'Tomorrow',
        }),
      ),
    ).toBe('diary_date');
    const view = await childHomework(deps, parent, t.studentId);
    expect(view.diary.map((d) => d.body)).toContain(
      'Sports day practice after lunch. Bring shoes.',
    );
  });
});

describe('Verse AI', () => {
  it('counts homework by class without names, for staff only', async () => {
    const tool = homeworkTools(deps).find((x) => x.name === 'homework.summary')!;
    const r = await tool.handler({ actor: teacher, institutionId: t.institutionId, today }, {});
    expect(r.data).toMatchObject({ to: today, classesWithNone: 0 });
    const data = r.data as { homeworkSet: number; byClass: { class: string; set: number }[] };
    expect(data.homeworkSet).toBeGreaterThan(0);
    expect(data.byClass[0]?.class).toBe('Class 5-A');
    expect(JSON.stringify(r.data)).not.toMatch(/Synthetic/);
    await expect(
      tool.handler({ actor: parent, institutionId: t.institutionId, today }, {}),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
