// Milestone 19 step 1: timetable versions, clash checks, publishing from a date, a day's lessons.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  copyTimetable,
  createTimetable,
  dayPlan,
  listTimetables,
  publishTimetable,
  setSlot,
  timetableDetail,
} from '@campusverse/school-timetable';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, close } = createDb(loadEnv().DATABASE_URL);
const permissions = createPermissions(null);

let t: SeededTenant;
let manager: Actor;
let reader: Actor;
let nobody: Actor;
let term1: string;
let draft: string;
let sectionA: string;
let sectionB: string;
let english: string;
let today: string;

const actor = async (grants: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId: t.orgId,
  personId: await seedAdmin(db, t.orgId, grants),
});
const one = async <T extends Record<string, unknown>>(q: SQL) =>
  (await withTenant(db, t.orgId, (tx) => tx.execute<T>(q)))[0]!;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** The first Monday after today. */
const nextMonday = (iso: string) => {
  let d = addDays(iso, 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  return d;
};
const slot = (who: Actor, over: Partial<Parameters<typeof setSlot>[3]> = {}) =>
  setSlot(db, permissions, who, {
    timetableId: draft,
    sectionId: sectionB,
    weekday: 1,
    period: 1,
    subjectId: english,
    teacherPersonId: null,
    ...over,
  });

beforeAll(async () => {
  t = await seedTenant(db, 'Timetable');
  manager = await actor(['school.timetable.read', 'school.timetable.manage']);
  reader = await actor(['school.timetable.read']);
  nobody = await actor(['people.student.read']);
  today = (await one<{ d: string }>(sql`select app_today()::text as d`)).d;
  term1 = (
    await one<{ id: string }>(sql`select id::text from school_timetable where name = 'Term 1'`)
  ).id;
  sectionA = (await one<{ id: string }>(sql`select id::text from school_section where name = 'A'`))
    .id;
  english = (await one<{ id: string }>(sql`select id::text from school_subject where code = 'ENG'`))
    .id;
  // A second section of Class 5, and a subject Class 5 doesn't take.
  sectionB = (
    await one<{ id: string }>(sql`
      insert into school_section (org_id, year_id, class_id, name, capacity)
      select org_id, year_id, class_id, 'B', 40 from school_section where id = ${sectionA}
      returning id::text`)
  ).id;
  await one(sql`
    insert into school_subject (org_id, institution_id, code, name)
    values (${t.orgId}, ${t.institutionId}, 'GER', 'German') returning id`);
});
afterAll(() => close());

describe('timetable', () => {
  it('lists versions with the published one current; denies people without the timetable', async () => {
    const list = await listTimetables(db, permissions, reader, t.institutionId);
    expect(list).toEqual([
      expect.objectContaining({ id: term1, name: 'Term 1', status: 'current', slots: 2 }),
    ]);
    await expect(listTimetables(db, permissions, nobody, t.institutionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('creates a draft with a bell schedule, refusing overlapping periods and readers', async () => {
    const input = {
      institutionId: t.institutionId,
      name: 'Exam week',
      days: [1, 2, 3],
      periods: [
        { startsAt: '08:00', endsAt: '08:45', kind: 'class' as const },
        { startsAt: '08:40', endsAt: '09:20', kind: 'class' as const },
      ],
    };
    await expect(createTimetable(db, permissions, manager, input)).rejects.toMatchObject({
      code: 'periods_overlap',
    });
    const fixed = {
      ...input,
      periods: [input.periods[0]!, { ...input.periods[1]!, startsAt: '08:45' }],
    };
    await expect(createTimetable(db, permissions, reader, fixed)).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const { id } = await createTimetable(db, permissions, manager, fixed);
    const d = await timetableDetail(db, permissions, reader, id);
    expect(d.version).toMatchObject({ state: 'draft', status: 'draft', days: [1, 2, 3] });
    expect(d.periods.map((p) => p.startsAt)).toEqual(['08:00', '08:45']);
  });

  it("never changes a published version: it's copied into a draft instead", async () => {
    await expect(
      setSlot(db, permissions, manager, {
        timetableId: term1,
        sectionId: sectionA,
        weekday: 2,
        period: 1,
        subjectId: english,
      }),
    ).rejects.toMatchObject({ code: 'not_draft' });
    draft = (await copyTimetable(db, permissions, manager, { timetableId: term1, name: 'Term 2' }))
      .id;
    const d = await timetableDetail(db, permissions, manager, draft);
    expect(d.slots).toEqual([
      expect.objectContaining({ sectionId: sectionA, weekday: 1, period: 1, room: 'Room 5' }),
      // The seeded languages group, copied under a new id.
      expect.objectContaining({ sectionId: null, groupId: d.groups[0]?.id, weekday: 3 }),
    ]);
    expect(d.groups).toEqual([
      { id: expect.any(String), name: 'Languages', sectionIds: [sectionA] },
    ]);
    // The group's lesson counts for its section too.
    expect(d.targets[sectionA]).toEqual([{ subjectId: english, placed: 2, target: null }]);
  });

  it('refuses a teacher or a room in two sections at once, naming the other section', async () => {
    await expect(slot(manager, { teacherPersonId: t.teacherId })).rejects.toMatchObject({
      code: 'teacher_busy',
      details: { other: 'Class 5-A' },
    });
    await expect(slot(manager, { room: 'room 5' })).rejects.toMatchObject({
      code: 'room_busy',
      details: { other: 'Class 5-A' },
    });
    const german = (
      await one<{ id: string }>(sql`select id::text from school_subject where code = 'GER'`)
    ).id;
    await expect(slot(manager, { subjectId: german })).rejects.toMatchObject({
      code: 'subject_not_offered',
    });
    await expect(slot(manager, { weekday: 6 })).rejects.toMatchObject({
      code: 'not_a_working_day',
    });
    await expect(slot(reader)).rejects.toBeInstanceOf(PermissionDenied);

    // Another period is fine; clearing a cell empties it.
    await slot(manager, { period: 2, teacherPersonId: t.teacherId, room: 'Room 6' });
    await slot(manager, { period: 2, subjectId: null });
    await slot(manager, { teacherPersonId: null, room: 'Lab 1' });
    expect((await timetableDetail(db, permissions, manager, draft)).slots).toHaveLength(3); // with the group lesson
  });

  it('refuses publishing while a shared teacher overlaps another school on the campus', async () => {
    // A second school on the same campus, whose timetable has the same teacher on Monday 08:10.
    const other = (
      await one<{ id: string }>(sql`
        insert into institution (org_id, campus_id, legal_entity_id, type, authority_code, name)
        values (${t.orgId}, ${t.campusId}, ${t.legalEntityId}, 'school', 'CBSE', 'Synthetic Junior School')
        returning id::text`)
    ).id;
    const year = (
      await one<{ id: string }>(sql`
        insert into school_year (org_id, institution_id, label, valid_during, status)
        values (${t.orgId}, ${other}, '2026-27', daterange('2026-04-01', '2027-04-01'), 'active') returning id::text`)
    ).id;
    const cls = (
      await one<{ id: string }>(sql`
        insert into school_class (org_id, institution_id, code, name, sequence)
        values (${t.orgId}, ${other}, '1', 'Class 1', 2) returning id::text`)
    ).id;
    const sec = (
      await one<{ id: string }>(sql`
        insert into school_section (org_id, year_id, class_id, name, capacity)
        values (${t.orgId}, ${year}, ${cls}, 'A', 30) returning id::text`)
    ).id;
    const subj = (
      await one<{ id: string }>(sql`
        insert into school_subject (org_id, institution_id, code, name)
        values (${t.orgId}, ${other}, 'EVS', 'EVS') returning id::text`)
    ).id;
    const tt = (
      await one<{ id: string }>(sql`
        insert into school_timetable (org_id, institution_id, year_id, name, days, created_by_person_id)
        values (${t.orgId}, ${other}, ${year}, 'Junior', '{1}', ${t.principalId}) returning id::text`)
    ).id;
    await one(sql`
      insert into school_timetable_period (org_id, timetable_id, number, starts_at, ends_at, kind)
      values (${t.orgId}, ${tt}, 1, '08:10', '08:50', 'class') returning number`);
    await one(sql`
      insert into school_timetable_slot (org_id, timetable_id, section_id, weekday, period, subject_id,
        teacher_person_id)
      values (${t.orgId}, ${tt}, ${sec}, 1, 1, ${subj}, ${t.teacherId}) returning id`);
    await one(sql`
      update school_timetable set state = 'published', effective_from = '2026-06-01', published_at = now(),
        published_by_person_id = ${t.principalId} where id = ${tt} returning id`);

    const from = nextMonday(today);
    await expect(
      publishTimetable(db, permissions, manager, { timetableId: draft, effectiveFrom: from }),
    ).rejects.toMatchObject({
      code: 'clash_elsewhere',
      details: {
        clashes: [
          {
            teacher: 'Synthetic Teacher Timetable',
            weekday: 1,
            period: 1,
            school: 'Synthetic Junior School',
          },
        ],
      },
    });

    // Moved to the other section's free period, the draft publishes.
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update school_timetable_slot set teacher_person_id = null
        where timetable_id = ${draft} and section_id = ${sectionA}`),
    );
    await expect(
      publishTimetable(db, permissions, manager, {
        timetableId: draft,
        effectiveFrom: addDays(today, -1),
      }),
    ).rejects.toMatchObject({ code: 'bad_date' });
    await publishTimetable(db, permissions, manager, { timetableId: draft, effectiveFrom: from });
    const list = await listTimetables(db, permissions, reader, t.institutionId);
    expect(list.find((v) => v.id === draft)?.status).toBe('scheduled');
    expect(list.find((v) => v.id === term1)?.status).toBe('current');
  });

  it("gives a day's lessons from the version in effect, and none on a holiday or a day off", async () => {
    const monday = nextMonday(today);
    const day = await dayPlan(db, permissions, reader, {
      institutionId: t.institutionId,
      date: monday,
    });
    expect(day.timetableId).toBe(draft);
    expect(day.lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'Class 5-B',
          subject: 'English',
          room: 'Lab 1',
          startsAt: '08:00',
        }),
        expect.objectContaining({ section: 'Class 5-A', subject: 'English', teacher: null }),
      ]),
    );
    // The Monday before it still runs on Term 1, with the teacher.
    const before = await dayPlan(db, permissions, reader, {
      institutionId: t.institutionId,
      date: addDays(monday, -7),
    });
    expect(before.timetableId).toBe(term1);
    expect(before.lessons[0]).toMatchObject({
      teacher: 'Synthetic Teacher Timetable',
      room: 'Room 5',
    });

    expect(
      (
        await dayPlan(db, permissions, reader, {
          institutionId: t.institutionId,
          date: addDays(monday, 6),
        })
      ).lessons,
    ).toEqual([]);
    await one(sql`
      insert into school_holiday (org_id, institution_id, on_date, name, declared_by_person_id)
      values (${t.orgId}, ${t.institutionId}, ${monday}, 'Kanakadasa Jayanti', ${t.principalId}) returning id`);
    expect(
      await dayPlan(db, permissions, reader, { institutionId: t.institutionId, date: monday }),
    ).toMatchObject({ holiday: 'Kanakadasa Jayanti', lessons: [] });
  });
});
