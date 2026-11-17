// Milestone 19 step 4: teaching groups (sections that split by subject in a period) and exam days.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  copyTimetable,
  coverDay,
  dayPlan,
  deleteGroup,
  generation,
  generationJobs,
  placeGeneration,
  requestGeneration,
  publishTimetable,
  saveGroup,
  setGroupSlot,
  setSlot,
  timetableDetail,
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
let draft: string;
let sectionA: string;
let sectionB: string;
let hindi: string;
let kannada: string;
let english: string;
let anita: string;
let bala: string;
let chitra: string;
let tuesday: string;

const one = async <T extends Record<string, unknown>>(q: SQL) =>
  (await withTenant(db, t.orgId, (tx) => tx.execute<T>(q)))[0]!;
const id = async (q: SQL) => (await one<{ id: string }>(q)).id;
const staff = async (name: string) => {
  const p = await id(sql`
    insert into person (org_id, legal_name) values (${t.orgId}, ${name}) returning id::text`);
  await one(sql`
    insert into staff_profile (org_id, person_id, employee_code)
    values (${t.orgId}, ${p}, ${`EMP-${randomUUID().slice(0, 8)}`}) returning person_id`);
  await one(sql`
    insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
    values (${t.orgId}, ${p}, ${t.institutionId}, 'staff', daterange(app_today(), null)) returning id`);
  return p;
};
const subject = async (code: string, name: string) => {
  const s = await id(sql`
    insert into school_subject (org_id, institution_id, code, name, kind)
    values (${t.orgId}, ${t.institutionId}, ${code}, ${name}, 'language') returning id::text`);
  await one(sql`
    insert into school_subject_offering (org_id, year_id, class_id, subject_id)
    select org_id, year_id, class_id, ${s} from school_section where id = ${sectionA} returning subject_id`);
  return s;
};
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await seedTenant(db, 'Groups');
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'school.timetable.read',
      'school.timetable.manage',
      'school.cover.manage',
      'staff.attendance.manage',
    ]),
  };
  reader = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['school.timetable.read']),
  };
  sectionA = await id(sql`select id::text from school_section where name = 'A'`);
  sectionB = await id(sql`
    insert into school_section (org_id, year_id, class_id, name, capacity)
    select org_id, year_id, class_id, 'B', 40 from school_section where id = ${sectionA} returning id::text`);
  english = await id(sql`select id::text from school_subject where code = 'ENG'`);
  hindi = await subject('HIN', 'Hindi');
  kannada = await subject('KAN', 'Kannada');
  anita = await staff('Anita Rao');
  bala = await staff('Bala Krishnan');
  chitra = await staff('Chitra Menon');
  const term1 = await id(sql`select id::text from school_timetable where name = 'Term 1'`);
  draft = (await copyTimetable(db, permissions, office, { timetableId: term1, name: 'Term 2' })).id;
  const today = (await one<{ d: string }>(sql`select app_today()::text as d`)).d;
  tuesday = addDays(today, 1);
  while (new Date(`${tuesday}T00:00:00Z`).getUTCDay() !== 2) tuesday = addDays(tuesday, 1);
});
afterAll(() => close());

describe('teaching groups', () => {
  let languages: string;

  it('brings sections together in a period, split by subject, with the usual clash rules', async () => {
    languages = (
      await saveGroup(db, permissions, office, {
        timetableId: draft,
        name: 'Second language',
        sectionIds: [sectionA, sectionB],
      })
    ).id;
    const cell = { timetableId: draft, groupId: languages, weekday: 2, period: 1 };
    await setGroupSlot(db, permissions, office, {
      ...cell,
      lessons: [
        { subjectId: hindi, teacherPersonId: anita, room: 'Room 1' },
        { subjectId: kannada, teacherPersonId: bala, room: 'Room 2' },
      ],
    });
    const d = await timetableDetail(db, permissions, office, draft);
    expect(d.groups.find((g) => g.id === languages)?.sectionIds.sort()).toEqual(
      [sectionA, sectionB].sort(),
    );
    // Hindi counts for 5-B's periods per week.
    expect(d.targets[sectionB]).toEqual(
      expect.arrayContaining([{ subjectId: hindi, placed: 1, target: null }]),
    );

    // 5-B is with the group then; Anita is teaching Hindi then.
    await expect(
      setSlot(db, permissions, office, {
        timetableId: draft,
        sectionId: sectionB,
        weekday: 2,
        period: 1,
        subjectId: english,
      }),
    ).rejects.toMatchObject({ code: 'section_busy', details: { other: 'Second language' } });
    await setSlot(db, permissions, office, {
      timetableId: draft,
      sectionId: sectionB,
      weekday: 2,
      period: 2,
      subjectId: english,
      teacherPersonId: chitra,
    });
    await expect(
      setGroupSlot(db, permissions, office, {
        ...cell,
        period: 2,
        lessons: [{ subjectId: hindi, teacherPersonId: anita }],
      }),
    ).rejects.toMatchObject({ code: 'section_busy', details: { other: 'Class 5-B' } });

    // A group of 5-B alone, on Monday period 1 when the seeded teacher teaches 5-A.
    const electives = (
      await saveGroup(db, permissions, office, {
        timetableId: draft,
        name: 'Electives',
        sectionIds: [sectionB],
      })
    ).id;
    const mon = { timetableId: draft, groupId: electives, weekday: 1, period: 1 };
    await expect(
      setGroupSlot(db, permissions, office, {
        ...mon,
        lessons: [{ subjectId: hindi, teacherPersonId: t.teacherId }],
      }),
    ).rejects.toMatchObject({ code: 'teacher_busy', details: { other: 'Class 5-A' } });
    await expect(
      setGroupSlot(db, permissions, office, {
        ...mon,
        lessons: [{ subjectId: hindi }, { subjectId: hindi }],
      }),
    ).rejects.toMatchObject({ code: 'duplicate_subject' });
    await expect(
      setGroupSlot(db, permissions, office, {
        ...mon,
        lessons: [
          { subjectId: hindi, teacherPersonId: chitra },
          { subjectId: kannada, teacherPersonId: chitra },
        ],
      }),
    ).rejects.toMatchObject({ code: 'teacher_busy' });
    await setGroupSlot(db, permissions, office, { ...mon, lessons: [{ subjectId: hindi }] });
    // 5-A can't join Electives: it has its own lesson on Monday period 1.
    await expect(
      saveGroup(db, permissions, office, {
        timetableId: draft,
        groupId: electives,
        name: 'Electives',
        sectionIds: [sectionA, sectionB],
      }),
    ).rejects.toMatchObject({ code: 'section_busy', details: { other: 'Class 5-A' } });
    await deleteGroup(db, permissions, office, { timetableId: draft, groupId: electives });
    await expect(
      saveGroup(db, permissions, reader, { timetableId: draft, name: 'X', sectionIds: [sectionA] }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });

  it("shows the group's lessons on the day, and an exam day replaces the class's lessons", async () => {
    await publishTimetable(db, permissions, office, { timetableId: draft, effectiveFrom: tuesday });
    await expect(
      saveGroup(db, permissions, office, {
        timetableId: draft,
        name: 'Late',
        sectionIds: [sectionA],
      }),
    ).rejects.toMatchObject({ code: 'not_draft' });
    let day = await dayPlan(db, permissions, reader, {
      institutionId: t.institutionId,
      date: tuesday,
    });
    expect(day.lessons.filter((l) => l.period === 1)).toEqual([
      expect.objectContaining({
        groupId: languages,
        section: 'Second language (Class 5-A, Class 5-B)',
        subject: 'Hindi',
        teacher: 'Anita Rao',
      }),
      expect.objectContaining({ subject: 'Kannada', room: 'Room 2' }),
    ]);

    // Anita is away that Tuesday: her group lesson needs cover.
    await markDay(db, permissions, office, {
      institutionId: t.institutionId,
      onDate: tuesday,
      personId: anita,
      status: 'on_leave',
    });
    let cover = await coverDay(db, permissions, office, {
      institutionId: t.institutionId,
      date: tuesday,
    });
    expect(cover.open).toBe(1);
    expect(cover.away[0]?.lessons[0]?.section).toBe('Second language (Class 5-A, Class 5-B)');

    // Class 5 sits English that Tuesday at 08:00, invigilated by Chitra.
    const exam = await id(sql`
      insert into school_exam (org_id, institution_id, year_id, name, class_ids, created_by_person_id)
      select org_id, ${t.institutionId}, year_id, 'Half yearly', array[class_id], ${t.principalId}
      from school_section where id = ${sectionA} returning id::text`);
    await one(sql`
      insert into school_exam_paper (org_id, exam_id, class_id, subject_id, max_marks, on_date, starts_at,
        duration_minutes, invigilator_person_id)
      select org_id, ${exam}, class_id, ${english}, 80, ${tuesday}, '08:00', 90, ${chitra}
      from school_section where id = ${sectionA} returning id`);
    day = await dayPlan(db, permissions, reader, { institutionId: t.institutionId, date: tuesday });
    expect(day.lessons).toEqual([]);
    expect(day.exams).toEqual([
      expect.objectContaining({
        exam: 'Half yearly',
        subject: 'English',
        startsAt: '08:00',
        endsAt: '09:30',
        invigilator: 'Chitra Menon',
      }),
    ]);
    // Nothing to cover: the class is sitting the exam.
    cover = await coverDay(db, permissions, office, {
      institutionId: t.institutionId,
      date: tuesday,
    });
    expect(cover.open).toBe(0);
  });
});

describe('generating a draft', () => {
  const rules = {
    mode: 'fill' as const,
    maxSamePerDay: 1,
    teacherMaxPerDay: 6,
    teacherMaxInARow: 3,
    subjects: {},
    teachers: {} as Record<string, { offDays?: number[] }>,
  };
  const work = async (generationId: string) => {
    const handle = generationJobs()[0]!.handle!;
    await withTenant(db, t.orgId, (tx) =>
      handle(tx, {
        id: randomUUID(),
        orgId: t.orgId,
        type: 'school.timetable.generate_requested.v1',
        payload: { generationId },
      } as never),
    );
  };

  it('generates under the rules in the worker, previews, and places exactly the preview', async () => {
    const term1 = await id(sql`select id::text from school_timetable where name = 'Term 1'`);
    const next = (
      await copyTimetable(db, permissions, office, { timetableId: term1, name: 'Term 3' })
    ).id;
    // English four a week in class 5; Bala teaches it in 5-B and isn't in on Saturdays.
    await one(sql`
      update school_subject_offering set periods_per_week = 4 where subject_id = ${english} returning subject_id`);
    await one(sql`
      insert into school_teacher_allocation (org_id, section_id, subject_id, teacher_person_id, kind)
      values (${t.orgId}, ${sectionB}, ${english}, ${bala}, 'subject_teacher') returning id`);
    // English needs Room 9; Bala isn't available in period 1.
    const mine = {
      ...rules,
      subjects: { [english]: { rooms: ['Room 9'] } },
      teachers: { [bala]: { offDays: [6], offPeriods: [1] } },
    };
    await expect(
      requestGeneration(db, permissions, reader, { timetableId: next, rules: mine }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const { id: runId } = await requestGeneration(db, permissions, office, {
      timetableId: next,
      rules: mine,
    });
    const ask = { timetableId: next, generationId: runId };
    expect((await generation(db, permissions, office, ask)).state).toBe('working');
    await work(runId);
    const run = await generation(db, permissions, office, ask);
    expect(run).toMatchObject({
      state: 'ready',
      stale: false,
      rules: { teachers: { [bala]: { offDays: [6] } } },
    });
    const placed = run.result!.placed;
    expect(run.result!.complete).toBe(true);
    // 5-A has English on Monday and in the languages group on Wednesday: two more, other days.
    const a = placed.filter((p) => p.sectionId === sectionA);
    expect(a).toHaveLength(2);
    expect(a.some((p) => p.weekday === 1 || p.weekday === 3)).toBe(false);
    const b = placed.filter((p) => p.sectionId === sectionB);
    expect(b).toHaveLength(4);
    expect(b.every((p) => p.teacherPersonId === bala && p.weekday !== 6)).toBe(true);
    expect(new Set(b.map((p) => p.weekday)).size).toBe(4);
    expect(b.some((p) => p.period === 1)).toBe(false);
    // One Room 9, so never two English lessons at once; the room goes into the draft.
    expect(placed.every((p) => p.room === 'Room 9')).toBe(true);
    expect(new Set(placed.map((p) => `${p.weekday}:${p.period}`)).size).toBe(placed.length);

    await expect(placeGeneration(db, permissions, office, ask)).resolves.toEqual({ placed: 6 });
    const d = await timetableDetail(db, permissions, office, next);
    expect(d.targets[sectionB]).toEqual(
      expect.arrayContaining([{ subjectId: english, placed: 4, target: 4 }]),
    );
    expect(d.slots.filter((x) => x.room === 'Room 9')).toHaveLength(6);
    await expect(placeGeneration(db, permissions, office, ask)).rejects.toMatchObject({
      code: 'changed',
    });

    // A run goes stale when the draft is edited meanwhile.
    const stale = (await requestGeneration(db, permissions, office, { timetableId: next })).id;
    await work(stale);
    await setSlot(db, permissions, office, {
      timetableId: next,
      sectionId: sectionA,
      weekday: 5,
      period: 2,
      subjectId: hindi,
    });
    const s2 = { timetableId: next, generationId: stale };
    expect((await generation(db, permissions, office, s2)).stale).toBe(true);
    await expect(placeGeneration(db, permissions, office, s2)).rejects.toMatchObject({
      code: 'changed',
    });

    // Rebuild: every section lesson made again (the group stays).
    const again = (
      await requestGeneration(db, permissions, office, {
        timetableId: next,
        rules: { ...mine, mode: 'rebuild' },
      })
    ).id;
    await work(again);
    const r3 = await generation(db, permissions, office, {
      timetableId: next,
      generationId: again,
    });
    expect(r3.result).toMatchObject({ mode: 'rebuild', complete: true, replaces: 8 });
    await placeGeneration(db, permissions, office, { timetableId: next, generationId: again });
    const after = await timetableDetail(db, permissions, office, next);
    expect(after.slots.filter((x) => x.groupId)).toHaveLength(1);
    expect(after.targets[sectionA]).toEqual(
      expect.arrayContaining([{ subjectId: english, placed: 4, target: 4 }]),
    );
  });
});
