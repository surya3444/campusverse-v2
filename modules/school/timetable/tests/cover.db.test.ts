// Milestone 19 step 2: cover for a teacher who is away, ranked suggestions, assigning, telling.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  assignCover,
  cancelCover,
  childWeek,
  copyTimetable,
  coverDay,
  coverJobs,
  dayPlan,
  freeTeachers,
  publishTimetable,
  setSlot,
  timetableTools,
} from '@campusverse/school-timetable';
import { markDay } from '@campusverse/shared-staff-attendance';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let office: Actor;
let reader: Actor;
let monday: string;
let anita: string; // teaches English in 5-A on Tuesday: the best cover
let bala: string; // teaches 5-B in period 1 on Monday: busy
let chitra: string; // no lessons
let lesson: string; // the away teacher's Monday period 1
let balaLesson: string;

const actor = async (grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, grants),
});
const one = async <T extends Record<string, unknown>>(q: SQL) =>
  (await withTenant(db, t.orgId, (tx) => tx.execute<T>(q)))[0]!;
const staff = async (name: string) => {
  const { id } = await one<{ id: string }>(sql`
    insert into person (org_id, legal_name) values (${t.orgId}, ${name}) returning id::text`);
  await one(sql`
    insert into staff_profile (org_id, person_id, employee_code)
    values (${t.orgId}, ${id}, ${`EMP-${randomUUID().slice(0, 8)}`}) returning person_id`);
  await one(sql`
    insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
    values (${t.orgId}, ${id}, ${t.institutionId}, 'staff', daterange(app_today(), null)) returning id`);
  return id;
};

beforeAll(async () => {
  t = await seedTenant(db, 'Cover');
  office = await actor([
    'school.timetable.read',
    'school.timetable.manage',
    'school.cover.manage',
    'staff.attendance.manage',
  ]);
  reader = await actor(['school.timetable.read']);
  anita = await staff('Anita Rao');
  bala = await staff('Bala Krishnan');
  chitra = await staff('Chitra Menon');
  const today = (await one<{ d: string }>(sql`select app_today()::text as d`)).d;
  monday = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1)
    monday = new Date(Date.parse(`${monday}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

  // From next Monday: Term 1 plus Anita's English in 5-A and Bala's in 5-B.
  const term1 = (
    await one<{ id: string }>(sql`select id::text from school_timetable where name = 'Term 1'`)
  ).id;
  const sectionA = (
    await one<{ id: string }>(sql`select id::text from school_section where name = 'A'`)
  ).id;
  const english = (
    await one<{ id: string }>(sql`select id::text from school_subject where code = 'ENG'`)
  ).id;
  const sectionB = (
    await one<{ id: string }>(sql`
      insert into school_section (org_id, year_id, class_id, name, capacity)
      select org_id, year_id, class_id, 'B', 40 from school_section where id = ${sectionA} returning id::text`)
  ).id;
  const { id: next } = await copyTimetable(db, permissions, office, {
    timetableId: term1,
    name: 'Term 2',
  });
  const base = { timetableId: next, subjectId: english };
  await setSlot(db, permissions, office, {
    ...base,
    sectionId: sectionA,
    weekday: 2,
    period: 2,
    teacherPersonId: anita,
  });
  await setSlot(db, permissions, office, {
    ...base,
    sectionId: sectionB,
    weekday: 1,
    period: 1,
    teacherPersonId: bala,
  });
  await publishTimetable(db, permissions, office, { timetableId: next, effectiveFrom: monday });
  lesson = (
    await one<{ id: string }>(sql`
      select id::text from school_timetable_slot where timetable_id = ${next} and section_id = ${sectionA}
        and weekday = 1 and period = 1`)
  ).id;
  balaLesson = (
    await one<{ id: string }>(sql`
      select id::text from school_timetable_slot where timetable_id = ${next} and section_id = ${sectionB}`)
  ).id;
  // The office marks the teacher on leave for Monday.
  await markDay(db, permissions, office, {
    institutionId: t.institutionId,
    onDate: monday,
    personId: t.teacherId,
    status: 'on_leave',
    reason: 'Family function',
  });
});
afterAll(() => close());

describe('cover', () => {
  it("lists the away teacher's lessons with free teachers, best first", async () => {
    const day = await coverDay(db, permissions, office, {
      institutionId: t.institutionId,
      date: monday,
    });
    expect(day.open).toBe(1);
    expect(day.away).toEqual([
      expect.objectContaining({
        personId: t.teacherId,
        status: 'on_leave',
        reason: 'Family function',
      }),
    ]);
    const l = day.away[0]!.lessons[0]!;
    expect(l).toMatchObject({
      slotId: lesson,
      ordinal: 1,
      section: 'Class 5-A',
      subject: 'English',
      cover: null,
    });
    // Bala teaches then; Anita teaches English to 5-A; Chitra is free with nothing in common.
    expect(l.suggestions.map((s) => s.name)).toEqual(['Anita Rao', 'Chitra Menon']);
    expect(l.suggestions[0]).toMatchObject({ teachesSubject: true, teachesSection: true });
    // Teaching on Monday and not away (Anita's lesson is on Tuesday).
    expect(day.teaching.map((x) => x.name)).toEqual(['Bala Krishnan']);
    await expect(
      coverDay(db, permissions, reader, { institutionId: t.institutionId, date: monday }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('refuses a busy teacher and a teacher who is not away', async () => {
    const base = { institutionId: t.institutionId, date: monday, kind: 'teacher' as const };
    await expect(
      assignCover(db, permissions, office, { ...base, slotId: lesson, coveringPersonId: bala }),
    ).rejects.toMatchObject({ code: 'teacher_busy' });
    await expect(
      assignCover(db, permissions, office, {
        ...base,
        slotId: balaLesson,
        coveringPersonId: chitra,
      }),
    ).rejects.toMatchObject({ code: 'teacher_not_away' });
    await expect(
      assignCover(db, permissions, office, {
        ...base,
        date: '2020-01-06',
        slotId: lesson,
        coveringPersonId: anita,
      }),
    ).rejects.toMatchObject({ code: 'bad_date' });
    await expect(
      assignCover(db, permissions, reader, { ...base, slotId: lesson, coveringPersonId: anita }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("assigns, shows it in the day's lessons, tells the teacher, and keeps the history on change", async () => {
    const base = {
      institutionId: t.institutionId,
      date: monday,
      slotId: lesson,
      kind: 'teacher' as const,
    };
    await assignCover(db, permissions, office, { ...base, coveringPersonId: anita });
    const { id } = await assignCover(db, permissions, office, {
      ...base,
      coveringPersonId: chitra,
      note: 'Chapter 4 worksheet on the desk',
    });
    const day = await coverDay(db, permissions, office, {
      institutionId: t.institutionId,
      date: monday,
    });
    expect(day.open).toBe(0);
    expect(day.away[0]?.lessons[0]?.cover).toMatchObject({ kind: 'teacher', name: 'Chitra Menon' });
    const plan = await dayPlan(db, permissions, reader, {
      institutionId: t.institutionId,
      date: monday,
    });
    expect(plan.lessons.find((l) => l.slotId === lesson)?.cover).toMatchObject({
      personId: chitra,
    });

    const rows = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ live: boolean }>(sql`
        select cancelled_at is null as live from school_cover where slot_id = ${lesson} and cover_date = ${monday}::date`),
    );
    expect(rows.map((r) => r.live).sort()).toEqual([false, true]);

    const handle = coverJobs()[0]!.handle!;
    await withTenant(db, t.orgId, (tx) =>
      handle(tx, {
        id: randomUUID(),
        orgId: t.orgId,
        type: 'school.cover.assigned.v1',
        payload: { coverId: id },
      } as never),
    );
    const msg = await one<{ title: string; body: string }>(sql`
      select title, body from notification_message where recipient_person_id = ${chitra}`);
    expect(msg.title).toBe('Cover: Class 5-A English, period 1');
    expect(msg.body).toMatch(/Chapter 4 worksheet/);
  });

  it('can combine the class instead, and take the cover back', async () => {
    const { id } = await assignCover(db, permissions, office, {
      institutionId: t.institutionId,
      date: monday,
      slotId: lesson,
      kind: 'combined',
      note: 'With 5-B in the hall',
    });
    let day = await coverDay(db, permissions, office, {
      institutionId: t.institutionId,
      date: monday,
    });
    expect(day.away[0]?.lessons[0]?.cover).toMatchObject({ kind: 'combined', personId: null });
    await cancelCover(db, permissions, office, { institutionId: t.institutionId, coverId: id });
    day = await coverDay(db, permissions, office, { institutionId: t.institutionId, date: monday });
    expect(day.open).toBe(1);
  });

  it('says who is free in a period, and the Verse AI tools give counts only', async () => {
    const r = await freeTeachers(db, permissions, office, {
      institutionId: t.institutionId,
      date: monday,
      ordinal: 1,
    });
    expect(r.period).toMatchObject({ ordinal: 1, startsAt: '08:00' });
    expect(r.free.map((f) => f.name)).toEqual(['Anita Rao', 'Chitra Menon']);
    await expect(
      freeTeachers(db, permissions, reader, { institutionId: t.institutionId, ordinal: 1 }),
    ).rejects.toBeInstanceOf(PermissionDenied);

    const ctx = { actor: office, institutionId: t.institutionId, today: monday };
    const tool = (name: string) =>
      timetableTools({ db, permissions }).find((x) => x.name === name)!;
    const free = await tool('timetable.free_teachers').handler(ctx, { period: 1 });
    expect(free.data).toMatchObject({ free: 2, period: { number: 1, time: '08:00-08:40' } });
    expect(JSON.stringify(free.data)).not.toMatch(/Anita|Chitra/);
    const day = await tool('timetable.today').handler(ctx, {});
    expect(day.data).toMatchObject({ myLessons: [], school: { lessons: 2, covered: 0 } });
  });
});

describe("a parent's view of the child's timetable", () => {
  it('shows the coming school days of their own child only', async () => {
    await grantPermission(db, t.orgId, 'parent', 'school.timetable.read', 'guardian');
    const parent: Actor = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
    const week = await childWeek(db, permissions, parent, t.studentId);
    expect(week.section).toBe('Class 5-A');
    // Seven days always hold one Monday, with English in period 1 (Term 1 or Term 2).
    const mon = week.days.find((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1);
    expect(mon?.lessons[0]).toMatchObject({ ordinal: 1, subject: 'English' });
    expect(week.days.every((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() !== 0)).toBe(true);
    await expect(childWeek(db, permissions, parent, t.teacherId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(childWeek(db, permissions, reader, t.studentId)).resolves.toMatchObject({
      section: 'Class 5-A',
    });
  });
});
