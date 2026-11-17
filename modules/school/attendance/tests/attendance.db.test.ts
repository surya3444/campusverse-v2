// Attendance against a real school: offline sync accepted once (the milestone exit check),
// leave, conflicts, corrections, alerts, holidays, shortage and who may do what.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  addMembership,
  addPhone,
  createPerson,
  ensureStudentProfile,
  linkGuardian,
} from '@campusverse/people-records';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import {
  assignRole,
  createPermissions,
  PermissionDenied,
  type Actor,
} from '@campusverse/platform-permissions';
import { enrol } from '@campusverse/school-enrolment';
import { applyStructure, provisionSchool } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptSyncEvents,
  assignSubstitute,
  attendanceDay,
  attendanceJobs,
  CONFIRMED,
  CORRECTED,
  correctAttendance,
  decideCondonation,
  decideLeave,
  declareHoliday,
  markingSheet,
  monthlyRegister,
  noticeProof,
  openCondonation,
  openConflicts,
  pendingLeave,
  previewHoliday,
  requestLeave,
  resolveConflict,
  sendAbsenceAlerts,
  sendShortageNotice,
  shortageReport,
  submitAttendance,
  type AttendanceDeps,
  type SyncEvent,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const deps: AttendanceDeps = { db, permissions };
afterAll(() => close());

const iso = (d: number) =>
  new Date(Date.now() + 330 * 60_000 + d * 864e5).toISOString().slice(0, 10);
const mobile = () => `+919${randomInt(100_000_000, 999_999_999)}`;
// UUIDv7-shaped ids, as a device makes them.
const deviceEventId = () => {
  const hex = Date.now().toString(16).padStart(12, '0');
  const r = randomUUID().replaceAll('-', '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(13, 16)}-8${r.slice(17, 20)}-${r.slice(20, 32)}`;
};

let school: Awaited<ReturnType<typeof provisionSchool>>;
let admin: Actor;
let teacher: Actor;
let otherTeacher: Actor;
let parent: Actor;
let otherParent: Actor;
let sectionA: string;
let sectionB: string;
let students: string[];

async function newStudent(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  name: string,
  sectionId: string,
  roll: number,
) {
  const id = await createPerson(tx, { legalName: name, source: 'admission' });
  await ensureStudentProfile(tx, id);
  await addMembership(tx, {
    personId: id,
    institutionId: school.institutionId,
    kind: 'student',
    from: iso(-60),
    until: iso(301),
  });
  await enrol(tx, {
    personId: id,
    institutionId: school.institutionId,
    sectionId,
    admissionNumber: `ATT-${randomInt(1e7)}`,
    rollNumber: roll,
    from: iso(-60),
    until: iso(301),
  });
  return id;
}

async function newStaff(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  name: string,
  roleKey: string,
) {
  const id = await createPerson(tx, { legalName: name, source: 'signup' });
  await addPhone(tx, id, mobile());
  await assignRole(tx, {
    personId: id,
    roleKey,
    scope:
      roleKey === 'parent'
        ? { type: 'organisation', id: school.orgId }
        : { type: 'institution', id: school.institutionId },
  });
  return { accountId: randomUUID(), orgId: school.orgId, personId: id };
}

beforeAll(async () => {
  school = await provisionSchool(db, {
    schoolName: 'Synthetic Attendance School',
    group: null,
    board: 'CBSE',
    state: 'KA',
    owner: { name: 'Owner Attendance', phone: mobile().slice(3) },
  });
  admin = { accountId: school.ownerAccountId, orgId: school.orgId, personId: school.ownerPersonId };
  await applyStructure(db, permissions, admin, school.institutionId, {
    board: 'CBSE',
    yearLabel: '2026-27',
    starts: iso(-60),
    ends: iso(300),
    classes: [{ code: '4', sections: 2, capacity: 30 }],
  });
  await withTenant(db, school.orgId, async (tx) => {
    const rows = await tx.execute<{ name: string; id: string }>(sql`
      select name, id::text from school_section where org_id = app_current_org()`);
    const by = Object.fromEntries(rows.map((r) => [r.name, r.id]));
    sectionA = by.A!;
    sectionB = by.B!;
    students = [];
    for (const [i, n] of ['Asha', 'Bharat', 'Chitra', 'Dev'].entries()) {
      students.push(await newStudent(tx, `${n} Synthetic`, sectionA, i + 1));
    }
    await newStudent(tx, 'Esha Synthetic', sectionB, 1);
    teacher = await newStaff(tx, 'Class Teacher A', 'teacher');
    otherTeacher = await newStaff(tx, 'Class Teacher B', 'teacher');
    for (const [t, s] of [
      [teacher, sectionA],
      [otherTeacher, sectionB],
    ] as const) {
      await tx.execute(sql`
        insert into school_teacher_allocation (org_id, section_id, teacher_person_id, kind, valid_during)
        values (app_current_org(), ${s}, ${t.personId}, 'class_teacher', daterange(${iso(-60)}::date, null))`);
    }
    parent = await newStaff(tx, 'Mother Synthetic', 'parent');
    otherParent = await newStaff(tx, 'Stranger Synthetic', 'parent');
    for (const s of students) {
      await linkGuardian(tx, {
        guardianId: parent.personId,
        studentId: s,
        relationship: 'mother',
        primary: true,
      });
    }
    await tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address)
      values (app_current_org(), ${parent.personId}, 'sms', ${mobile()})`);
  });
});

const outbox = (type: string) =>
  withTenant(db, school.orgId, (tx) =>
    tx.execute<OutboxEvent>(sql`
      select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
      from ops.outbox where org_id = app_current_org() and type = ${type} order by id`),
  );
const count = (q: ReturnType<typeof sql>) =>
  withTenant(db, school.orgId, async (tx) => (await tx.execute<{ n: number }>(q))[0]?.n ?? 0);
const dayOf = (personId: string, onDate: string) =>
  withTenant(db, school.orgId, async (tx) => {
    const [r] = await tx.execute<{ status: string }>(sql`
      select status from school_attendance_day
      where org_id = app_current_org() and person_id = ${personId} and on_date = ${onDate}::date`);
    return r?.status ?? null;
  });

const sync = (
  onDate: string,
  marks: SyncEvent['payload']['marks'],
  actor = teacher,
): SyncEvent => ({
  eventId: deviceEventId(),
  deviceId: 'synthetic-phone',
  actorId: actor.personId,
  occurredAt: new Date().toISOString(),
  type: 'attendance.mark',
  payload: { sectionId: sectionA, onDate, marks },
});

describe('offline sync (exit check)', () => {
  it('marks taken offline are accepted once after reconnecting, however often they are resent', async () => {
    const onDate = iso(-10);
    const event = sync(onDate, [{ personId: students[1]!, status: 'absent' }]);

    expect(await acceptSyncEvents(deps, teacher, [event])).toEqual([
      { eventId: event.eventId, outcome: 'accepted' },
    ]);
    // The phone didn't hear the answer and sends again; then twice at once.
    expect((await acceptSyncEvents(deps, teacher, [event]))[0]?.outcome).toBe('duplicate');
    const both = await Promise.all([
      acceptSyncEvents(deps, teacher, [event]),
      acceptSyncEvents(deps, teacher, [event]),
    ]);
    expect(both.map((r) => r[0]?.outcome)).toEqual(['duplicate', 'duplicate']);

    expect(
      await count(sql`select count(*)::int as n from school_attendance_event
        where org_id = app_current_org() and event_id = ${event.eventId}`),
    ).toBe(1);
    expect(
      await count(sql`select count(*)::int as n from school_attendance_day
        where org_id = app_current_org() and section_id = ${sectionA} and on_date = ${onDate}::date`),
    ).toBe(4);
    expect(await dayOf(students[1]!, onDate)).toBe('absent');
    expect(await dayOf(students[0]!, onDate)).toBe('present');
    const confirmed = (await outbox(CONFIRMED)).filter((e) => e.payload.onDate === onDate);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.payload.personIds).toEqual([students[1]]);
  });

  it('a brand-new event sent from two connections at once is still accepted once', async () => {
    const event = sync(iso(-11), []);
    const results = await Promise.all([
      submitAttendance(deps, teacher, { ...event, ...event.payload }),
      submitAttendance(deps, teacher, { ...event, ...event.payload }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['accepted', 'duplicate']);
  });

  it("rejects, without retrying, an event from someone else's queue, a future day and another section", async () => {
    const theirs = sync(iso(-12), [], otherTeacher);
    const future = sync(iso(3), []);
    const results = await acceptSyncEvents(deps, teacher, [theirs, future]);
    expect(results.map((r) => [r.outcome, r.code])).toEqual([
      ['rejected', 'other_actor'],
      ['rejected', 'future_date'],
    ]);
    const notMine = sync(iso(-12), [], otherTeacher);
    expect((await acceptSyncEvents(deps, otherTeacher, [notMine]))[0]).toMatchObject({
      outcome: 'rejected',
      code: 'forbidden',
    });
  });
});

describe('marking', () => {
  it('everyone starts present and students on approved leave appear as on leave', async () => {
    const onDate = iso(-20);
    const { id } = await requestLeave(deps, parent, {
      studentId: students[2]!,
      kind: 'medical',
      from: onDate,
      to: iso(-19),
      reason: 'Fever, doctor advised rest',
    });
    expect((await pendingLeave(deps, teacher, school.institutionId)).map((l) => l.id)).toContain(
      id,
    );
    await decideLeave(deps, teacher, { leaveId: id, approve: true });

    const sheet = await markingSheet(deps, teacher, { sectionId: sectionA, onDate });
    expect(sheet.canMark).toBe(true);
    expect(sheet.session).toBeNull();
    expect(sheet.students.map((s) => s.status)).toEqual([null, null, 'medical_leave', null]);

    await submitAttendance(deps, teacher, {
      ...sync(onDate, []),
      ...sync(onDate, []).payload,
      eventId: deviceEventId(),
    });
    expect(await dayOf(students[2]!, onDate)).toBe('medical_leave');
    expect(await dayOf(students[0]!, onDate)).toBe('present');
  });

  it('a second submission that disagrees becomes a conflict for review, never an overwrite', async () => {
    const onDate = iso(-21);
    await submitAttendance(deps, teacher, { ...sync(onDate, []), ...sync(onDate, []).payload });
    await assignSubstitute(deps, admin, {
      sectionId: sectionA,
      onDate,
      personId: otherTeacher.personId,
    });
    const second = sync(onDate, [{ personId: students[0]!, status: 'absent' }], otherTeacher);
    expect(await submitAttendance(deps, otherTeacher, { ...second, ...second.payload })).toEqual({
      outcome: 'conflict',
      conflicts: 1,
    });
    expect(await dayOf(students[0]!, onDate)).toBe('present');

    const open = (await openConflicts(deps, admin, school.institutionId)).filter(
      (c) => c.onDate === onDate,
    );
    expect(open).toMatchObject([{ personId: students[0], current: 'present', incoming: 'absent' }]);
    await expect(
      resolveConflict(deps, teacher, { conflictId: open[0]!.id, apply: true }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await resolveConflict(deps, admin, { conflictId: open[0]!.id, apply: true });
    expect(await dayOf(students[0]!, onDate)).toBe('absent');
  });

  it('only the class teacher, a substitute for that day, or a coordinator may mark a section', async () => {
    const onDate = iso(-22);
    const e = sync(onDate, [], otherTeacher);
    await expect(
      submitAttendance(deps, otherTeacher, { ...e, ...e.payload }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const p = sync(onDate, [], parent);
    await expect(submitAttendance(deps, parent, { ...p, ...p.payload })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(
      markingSheet(deps, parent, { sectionId: sectionA, onDate }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const day = await attendanceDay(deps, teacher, { institutionId: school.institutionId, onDate });
    expect(day.seesAll).toBe(false);
    expect(day.sections.map((s) => s.sectionId)).toEqual([sectionA]);
    const all = await attendanceDay(deps, admin, { institutionId: school.institutionId, onDate });
    expect(all.sections.map((s) => s.state)).toEqual(['not_taken', 'not_taken']);
  });
});

describe('corrections and parent alerts', () => {
  it('parents of absentees are told once, after the delay; a late arrival sends a correction', async () => {
    const onDate = iso(-30);
    const e = sync(onDate, [
      { personId: students[0]!, status: 'absent' },
      { personId: students[3]!, status: 'absent' },
    ]);
    await submitAttendance(deps, teacher, { ...e, ...e.payload });

    // Student 3 arrives before the delay: corrected, so never alerted.
    await expect(
      correctAttendance(deps, teacher, {
        personId: students[3]!,
        onDate,
        status: 'late',
        reason: '',
      }),
    ).rejects.toThrow(/reason_required/);
    await correctAttendance(deps, teacher, {
      personId: students[3]!,
      onDate,
      status: 'late',
      reason: 'Came in at 9:20',
    });

    const data = {
      orgId: school.orgId,
      sectionId: sectionA,
      onDate,
      personIds: [students[0]!, students[3]!],
    };
    await sendAbsenceAlerts(db, data);
    await sendAbsenceAlerts(db, data); // a retry of the task
    const absenceMessages = (student: string) =>
      count(sql`select count(*)::int as n from notification_message
        where org_id = app_current_org() and kind = 'absence' and dedupe_key like ${`absence:${student}:${onDate}%`}`);
    expect(await absenceMessages(students[0]!)).toBe(1);
    expect(await absenceMessages(students[3]!)).toBe(0);

    // Student 0 was in fact present: the original stays, the correction shows its editor and reason.
    await correctAttendance(deps, teacher, {
      personId: students[0]!,
      onDate,
      status: 'present',
      reason: 'Was in the library during roll call',
    });
    expect(await dayOf(students[0]!, onDate)).toBe('present');
    expect(
      await count(sql`select count(*)::int as n from school_attendance_event
        where org_id = app_current_org() and section_id = ${sectionA} and on_date = ${onDate}::date`),
    ).toBe(3);
    const corrected = (await outbox(CORRECTED)).filter((x) => x.payload.onDate === onDate);
    expect(corrected).toHaveLength(1);
    const jobs = attendanceJobs({ schedule: async () => undefined });
    const consumer = jobs.consumers.find((c) => c.name === 'school.attendance.correction-notice')!;
    await runConsumer(db, consumer, corrected[0]!);
    expect(await runConsumer(db, consumer, corrected[0]!)).toBe('duplicate');
    expect(
      await count(sql`select count(*)::int as n from notification_message
        where org_id = app_current_org() and dedupe_key like ${`absence-correction:${corrected[0]!.id}%`}`),
    ).toBe(1);
  });

  it('the alert consumer schedules the task after the school delay', async () => {
    const scheduled: { delay: number }[] = [];
    const jobs = attendanceJobs({
      schedule: async (_t, _d, delay) => void scheduled.push({ delay }),
    });
    const consumer = jobs.consumers.find((c) => c.name === 'school.attendance.schedule-alerts')!;
    const [event] = await outbox(CONFIRMED);
    await runConsumer(db, consumer, event!);
    expect(scheduled).toEqual([{ delay: 30 * 60_000 }]);
  });
});

describe('leave', () => {
  it('a parent asks only for their own child; approval turns marked absences into leave', async () => {
    const onDate = iso(-40);
    const e = sync(onDate, [{ personId: students[1]!, status: 'absent' }]);
    await submitAttendance(deps, teacher, { ...e, ...e.payload });
    await expect(
      requestLeave(deps, otherParent, {
        studentId: students[1]!,
        kind: 'leave',
        from: onDate,
        to: onDate,
        reason: 'Wedding',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    const { id } = await requestLeave(deps, parent, {
      studentId: students[1]!,
      kind: 'leave',
      from: onDate,
      to: onDate,
      reason: 'Family wedding',
    });
    await expect(
      decideLeave(deps, otherTeacher, { leaveId: id, approve: true }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(decideLeave(deps, teacher, { leaveId: id, approve: false })).rejects.toThrow(
      /note_required/,
    );
    await decideLeave(deps, teacher, { leaveId: id, approve: true });
    expect(await dayOf(students[1]!, onDate)).toBe('approved_leave');
  });
});

describe('holidays', () => {
  it('previews counts, then declares: parents are told and the day cannot be marked', async () => {
    const onDate = iso(5);
    const preview = await previewHoliday(deps, admin, {
      institutionId: school.institutionId,
      onDate,
      name: 'Rain holiday',
    });
    expect(preview).toMatchObject({ sections: 2, students: 5, alreadyMarked: 0 });
    await expect(
      declareHoliday(deps, teacher, {
        institutionId: school.institutionId,
        onDate,
        name: 'Rain holiday',
      }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await declareHoliday(deps, admin, {
      institutionId: school.institutionId,
      onDate,
      name: 'Rain holiday',
    });
    await expect(
      declareHoliday(deps, admin, {
        institutionId: school.institutionId,
        onDate,
        name: 'Rain holiday',
      }),
    ).rejects.toThrow(/already_holiday/);
    const day = await attendanceDay(deps, admin, { institutionId: school.institutionId, onDate });
    expect(day.holiday).toBe('Rain holiday');
    expect(day.sections.every((s) => s.state === 'holiday')).toBe(true);
  });
});

describe('shortage and condonation', () => {
  it('lists students below the board threshold; a notice keeps its delivery proof; a case is decided with a note', async () => {
    // Student 3 is absent on six more days: well below 75%.
    for (let d = 41; d <= 46; d++) {
      const e = sync(iso(-d), [{ personId: students[3]!, status: 'absent' }]);
      await submitAttendance(deps, teacher, { ...e, ...e.payload });
    }
    const report = await shortageReport(deps, admin, school.institutionId);
    expect(report.rule?.minimumPercent).toBe('75.00');
    const row = report.students.find((s) => s.personId === students[3]);
    expect(row?.standing).toBe('short');
    await expect(shortageReport(deps, teacher, school.institutionId)).rejects.toBeInstanceOf(
      PermissionDenied,
    );

    const notice = await sendShortageNotice(deps, admin, { personId: students[3]! });
    expect(notice.messages).toBe(1);
    const proof = await noticeProof(deps, admin, notice.id);
    expect(proof.messages).toHaveLength(1);
    expect(proof.messages[0]?.recipientPersonId).toBe(parent.personId);

    const deadline = iso(20);
    const { id } = await openCondonation(deps, admin, {
      personId: students[3]!,
      reason: 'Hospitalised in July',
      deadline,
    });
    await expect(
      openCondonation(deps, admin, { personId: students[3]!, reason: 'Again', deadline }),
    ).rejects.toThrow(/case_already_open/);
    await expect(
      decideCondonation(deps, teacher, { caseId: id, grant: true, note: 'Looks fine' }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await decideCondonation(deps, admin, {
      caseId: id,
      grant: true,
      note: 'Medical certificate verified',
    });
    const after = await shortageReport(deps, admin, school.institutionId);
    expect(after.students.find((s) => s.personId === students[3])?.condonation?.status).toBe(
      'granted',
    );
  });

  it('the monthly register shows each day and holiday', async () => {
    const month = iso(-10).slice(0, 7);
    const reg = await monthlyRegister(deps, teacher, { sectionId: sectionA, month });
    expect(reg.dates[0]).toBe(`${month}-01`);
    expect(reg.students).toHaveLength(4);
    expect(reg.students[1]?.days[iso(-10)]).toBe('absent');
    await expect(
      monthlyRegister(deps, otherTeacher, { sectionId: sectionA, month }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
