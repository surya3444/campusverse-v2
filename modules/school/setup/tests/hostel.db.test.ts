// The hostel across modules (docs/specs/HOSTEL.md): beds by gender and number, moves that keep
// history, the roll call with absent alerts, outpasses asked by parents and decided by the warden
// (never a restricted guardian), the parent's view, and residents as an audience.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import {
  grantPermission,
  seedAdmin,
  seedTenant,
  syntheticPhone,
  type SeededTenant,
} from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  OUTPASS_DECIDED,
  OUTPASS_LEFT,
  OUTPASS_RETURNED,
  ROLL_CALL_SUBMITTED,
  allocate,
  cancelOutpass,
  childHostel,
  decideOutpass,
  hostelAudience,
  hostelFigures,
  hostelJobs,
  issueOutpass,
  moveStudent,
  outpassBack,
  outpassLeft,
  requestOutpass,
  rollCallSheet,
  rooms,
  saveHostel,
  saveRollCall,
  saveRoom,
  vacate,
  type HostelDeps,
} from '@campusverse/shared-hostel';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: HostelDeps = {
  db,
  permissions: createPermissions(null),
  placements: [schoolPlacement],
};

let t: SeededTenant;
let warden: Actor;
let office: Actor;
let parent: Actor;
let today: string;
let tomorrow: string;
let hostelId: string;
let roomId: string;
let allocationId: string;
let restrictedPhone: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
const run = (type: string, payload: Record<string, unknown>) =>
  withTenant(db, t.orgId, async (tx) => {
    for (const job of hostelJobs().filter((j) => j.events.includes(type)))
      await job.handle?.(tx, {
        id: randomUUID(),
        orgId: t.orgId,
        type,
        payload,
        occurredAt: new Date().toISOString(),
      });
  });
const messages = (key: string) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute<{ to: string; title: string; body: string }>(sql`
      select recipient_person_id::text as to, title, body from notification_message
      where org_id = app_current_org() and dedupe_key like ${`${key}%`} order by created_at`),
  );
const setGender = (g: string) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      update student_profile set gender = ${g} where org_id = app_current_org() and person_id = ${t.studentId}`),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Hostel');
  warden = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'hostel.resident.read',
      'hostel.room.manage',
      'hostel.rollcall.mark',
      'hostel.outpass.decide',
    ]),
  };
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['hostel.resident.read']),
  };
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  await grantPermission(db, t.orgId, 'parent', 'hostel.resident.read', 'guardian');
  await grantPermission(db, t.orgId, 'parent', 'hostel.outpass.request', 'guardian');
  restrictedPhone = syntheticPhone();
  ({ today, tomorrow } = await withTenant(db, t.orgId, async (tx) => {
    // A restricted second guardian, with a phone on record; and the guardian's own messages off.
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (${t.orgId}, 'Synthetic Restricted Father') returning id::text`);
    await tx.execute(sql`
      insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship, restricted_at,
        restriction_reason)
      values (${t.orgId}, ${p?.id}, ${t.studentId}, 'father', now(), 'Court order')`);
    await tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address)
      values (${t.orgId}, ${p?.id}, 'sms', ${restrictedPhone})`);
    await tx.execute(sql`
      update guardian_link set academic_messages = false
      where org_id = app_current_org() and guardian_person_id = ${t.guardianId}`);
    const [d] = await tx.execute<{ today: string; tomorrow: string }>(sql`
      select app_today()::text as today, (app_today() + 1)::text as tomorrow`);
    return d ?? { today: '', tomorrow: '' };
  }));
});
afterAll(() => close());

describe('rooms and beds', () => {
  it('moves a student only into the right hostel and a real, free bed, keeping history', async () => {
    hostelId = (
      await saveHostel(deps, warden, {
        institutionId: t.institutionId,
        id: null,
        name: 'Synthetic Boys Hostel',
        kind: 'boys',
        active: true,
      })
    ).id;
    expect(
      await code(
        saveHostel(deps, warden, {
          institutionId: t.institutionId,
          id: null,
          name: ' synthetic boys hostel',
          kind: 'boys',
          active: true,
        }),
      ),
    ).toBe('hostel_exists');
    expect(
      await code(
        saveHostel(deps, office, {
          institutionId: t.institutionId,
          id: null,
          name: 'Nope',
          kind: 'girls',
          active: true,
        }),
      ),
    ).toBe('denied');
    roomId = (
      await saveRoom(deps, warden, {
        institutionId: t.institutionId,
        hostelId,
        id: null,
        number: 'B-12',
        floor: '1',
        beds: 2,
        active: true,
      })
    ).id;

    // The seed already has the student in the seed's hostel: a second bed is refused, a move works.
    expect(
      await code(
        allocate(deps, warden, {
          institutionId: t.institutionId,
          roomId,
          bedNo: 1,
          studentId: t.studentId,
        }),
      ),
    ).toBe('already_allocated');
    expect(
      await code(
        allocate(deps, warden, {
          institutionId: t.institutionId,
          roomId,
          bedNo: 1,
          studentId: t.teacherId,
        }),
      ),
    ).toBe('not_a_student');
    const [seeded] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ id: string }>(sql`
        select id::text from hostel_allocation where org_id = app_current_org() and student_person_id = ${t.studentId}`),
    );
    await setGender('female');
    const move = (bedNo: number, id = seeded?.id ?? '') =>
      moveStudent(deps, warden, {
        institutionId: t.institutionId,
        allocationId: id,
        roomId,
        bedNo,
      });
    expect(await code(move(2))).toBe('wrong_hostel');
    await setGender('male');
    expect(await code(move(3))).toBe('no_such_bed');
    allocationId = (await move(2)).allocationId;
    // The old bed's record keeps its dates; the new one starts today.
    const history = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ upper: string | null }>(sql`
        select upper(valid_during)::text as upper from hostel_allocation
        where org_id = app_current_org() and student_person_id = ${t.studentId} order by lower(valid_during)`),
    );
    expect(history.map((h) => h.upper)).toEqual([today, null]);
    const [room] = await rooms(deps, office, { institutionId: t.institutionId, hostelId });
    expect(room?.occupants.map((b) => b.studentId)).toEqual([null, t.studentId]);
    expect(room?.occupants[1]?.label).toBe('Class 5-A');
    // A room can't lose a bed someone sleeps in.
    expect(
      await code(
        saveRoom(deps, warden, {
          institutionId: t.institutionId,
          hostelId,
          id: roomId,
          number: 'B-12',
          floor: '1',
          beds: 1,
          active: true,
        }),
      ),
    ).toBe('bed_in_use');
  });
});

describe('roll call', () => {
  it('needs every resident marked, and tells the guardians of an absent child', async () => {
    const sheet = await rollCallSheet(deps, warden, {
      institutionId: t.institutionId,
      hostelId,
      session: 'night',
    });
    expect(sheet.lines).toEqual([
      expect.objectContaining({ studentId: t.studentId, room: 'B-12', bedNo: 2, status: null }),
    ]);
    expect(
      await code(
        saveRollCall(deps, warden, {
          institutionId: t.institutionId,
          hostelId,
          session: 'night',
          marks: [],
        }),
      ),
    ).toBe('marks_incomplete');
    expect(
      await code(
        saveRollCall(deps, office, {
          institutionId: t.institutionId,
          hostelId,
          session: 'night',
          marks: [{ studentId: t.studentId, status: 'present' }],
        }),
      ),
    ).toBe('denied');
    const { rollCallId, absent } = await saveRollCall(deps, warden, {
      institutionId: t.institutionId,
      hostelId,
      session: 'night',
      marks: [{ studentId: t.studentId, status: 'absent' }],
    });
    expect(absent).toBe(1);
    await run(ROLL_CALL_SUBMITTED, { rollCallId, hostelId });
    // Only the unrestricted guardian, even with academic messages off.
    const sent = await messages(`hostel-absent:${rollCallId}`);
    expect(sent.map((m) => m.to)).toEqual([t.guardianId]);
    expect(sent[0]?.body).toMatch(/wasn't at the hostel's night roll call/);
    expect(await hostelFigures(deps, office, t.institutionId)).toMatchObject({
      absentLastRollCall: 1,
    });
  });
});

describe('outpasses', () => {
  it('a parent asks; never with a restricted guardian; the warden decides; out and back', async () => {
    const ask = {
      studentId: t.studentId,
      leavesOn: today,
      backBy: tomorrow,
      reason: 'Family function',
      collector: { guardianId: t.guardianId },
    };
    expect(await code(requestOutpass(deps, parent, { ...ask, leavesOn: '2020-01-01' }))).toBe(
      'past_date',
    );
    expect(await code(requestOutpass(deps, parent, { ...ask, backBy: '2020-01-01' }))).toBe(
      'back_before_leaving',
    );
    expect(
      await code(
        requestOutpass(deps, parent, {
          ...ask,
          collector: { name: 'Synthetic Uncle', relation: 'Uncle', phone: restrictedPhone },
        }),
      ),
    ).toBe('collector_restricted');
    // Not someone else's child.
    expect(await code(requestOutpass(deps, parent, { ...ask, studentId: t.teacherId }))).toBe(
      'denied',
    );
    const { outpassId } = await requestOutpass(deps, parent, ask);

    expect(
      await code(
        decideOutpass(deps, warden, {
          institutionId: t.institutionId,
          outpassId,
          approve: false,
          note: '',
        }),
      ),
    ).toBe('note_needed');
    await decideOutpass(deps, warden, {
      institutionId: t.institutionId,
      outpassId,
      approve: true,
      note: '',
    });
    await run(OUTPASS_DECIDED, { outpassId });
    expect((await messages(`hostel-outpass-decided:${outpassId}`)).map((m) => m.to)).toEqual([
      t.guardianId,
    ]);

    expect(
      await code(outpassLeft(deps, office, { institutionId: t.institutionId, outpassId })),
    ).toBe('denied');
    await outpassLeft(deps, warden, { institutionId: t.institutionId, outpassId });
    await run(OUTPASS_LEFT, { outpassId });
    // Out on a pass: tonight's roll call starts them on leave.
    const sheet = await rollCallSheet(deps, warden, {
      institutionId: t.institutionId,
      hostelId,
      session: 'morning',
    });
    expect(sheet.lines[0]).toMatchObject({ status: 'on_leave', outOnPass: true });
    expect(await hostelFigures(deps, office, t.institutionId)).toMatchObject({
      out: 1,
      overdue: 0,
    });
    await outpassBack(deps, warden, { institutionId: t.institutionId, outpassId });
    await run(OUTPASS_RETURNED, { outpassId });
    const told = await messages(`hostel-outpass-`);
    expect(told.map((m) => m.title)).toEqual([
      expect.stringMatching(/^Outpass approved/),
      expect.stringMatching(/left the hostel$/),
      expect.stringMatching(/is back at the hostel$/),
    ]);
    expect(
      await code(outpassBack(deps, warden, { institutionId: t.institutionId, outpassId })),
    ).toBe('wrong_state');
  });

  it('a warden-issued pass: not before its day, and only the warden cancels it', async () => {
    const { outpassId } = await issueOutpass(deps, warden, {
      institutionId: t.institutionId,
      studentId: t.studentId,
      leavesOn: tomorrow,
      backBy: tomorrow,
      reason: 'Dentist',
      collector: { guardianId: t.guardianId },
    });
    expect(
      await code(outpassLeft(deps, warden, { institutionId: t.institutionId, outpassId })),
    ).toBe('not_yet');
    expect(await code(cancelOutpass(deps, parent, { outpassId }))).toBe('outpass_not_found');
    await cancelOutpass(deps, warden, { outpassId });
  });

  it('shows a parent their own child only, and vacating frees the bed', async () => {
    const mine = await childHostel(deps, parent, t.studentId);
    expect(mine.stay).toMatchObject({ hostel: 'Synthetic Boys Hostel', room: 'B-12', bedNo: 2 });
    expect(mine.roll[0]?.status).toBeDefined();
    expect(mine.outpasses.map((o) => o.state)).toContain('returned');
    // The restricted guardian is never offered as a collector.
    expect(mine.collectors.map((c) => c.personId)).toEqual([t.guardianId]);
    expect(await code(childHostel(deps, parent, t.teacherId))).toBe('denied');

    expect(
      (
        await withTenant(db, t.orgId, (tx) =>
          hostelAudience.students(tx, t.institutionId, [hostelId], today),
        )
      ).includes(t.studentId),
    ).toBe(true);
    await vacate(deps, warden, {
      institutionId: t.institutionId,
      allocationId,
      reason: 'Left school',
    });
    // They came to this bed today, so the bed is free from tomorrow (spec decision 2).
    const [ended] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ upper: string; reason: string }>(sql`
        select upper(valid_during)::text as upper, ended_reason as reason from hostel_allocation
        where org_id = app_current_org() and id = ${allocationId}`),
    );
    expect(ended).toEqual({ upper: tomorrow, reason: 'Left school' });
  });
});
