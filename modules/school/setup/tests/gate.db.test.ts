// Visitors and gate across modules (docs/specs/VISITORS_GATE.md): check in and out with the host
// told, barred visitors, expected visits, and gate passes that never hand a child to a restricted
// guardian, with every guardian told when the child leaves. Classes come from school enrolment.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, syntheticPhone, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  PASS_LEFT,
  VISIT_CHECKED_IN,
  barVisitor,
  cancelExpected,
  checkIn,
  checkOut,
  expectVisitor,
  findPeople,
  gateJobs,
  gateToday,
  issuePass,
  liftBar,
  myExpected,
  passLeft,
  pickupOptions,
  visitHistory,
  visitorByPhone,
  type CheckInInput,
  type GateDeps,
} from '@campusverse/shared-gate';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: GateDeps = { db, permissions: createPermissions(null), placements: [schoolPlacement] };

let t: SeededTenant;
let guard: Actor;
let office: Actor;
let principal: Actor;
let expector: Actor;
let otherStaff: Actor;
let restrictedId: string;
const restrictedPhone = syntheticPhone();
const actorFor = async (orgId: string, perms: string[]): Promise<Actor> => ({
  accountId: randomUUID(),
  orgId,
  personId: await seedAdmin(db, orgId, perms),
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );
/** Runs the worker's handler for an event, as the worker would. */
const run = (type: string, payload: Record<string, unknown>) =>
  withTenant(db, t.orgId, async (tx) => {
    const job = gateJobs().find((j) => j.events.includes(type));
    await job?.handle?.(tx, {
      id: randomUUID(),
      orgId: t.orgId,
      type,
      payload,
      occurredAt: new Date().toISOString(),
    });
  });
const messages = (key: string) =>
  withTenant(db, t.orgId, (tx) =>
    tx.execute<{ to: string; body: string; kind: string }>(sql`
      select recipient_person_id::text as to, body, kind from notification_message
      where org_id = app_current_org() and dedupe_key like ${`${key}%`}`),
  );
const walkIn = (phone: string, more: Partial<CheckInInput> = {}): CheckInInput => ({
  institutionId: t.institutionId,
  visitId: null,
  phone,
  name: 'Synthetic Ramesh',
  purpose: 'parent_meeting',
  note: '',
  hostPersonId: null,
  partySize: 1,
  vehicleNo: '',
  badgeNo: '',
  ...more,
});

beforeAll(async () => {
  t = await seedTenant(db, 'Gate');
  guard = await actorFor(t.orgId, ['gate.visitor.read', 'gate.visitor.manage']);
  office = await actorFor(t.orgId, ['gate.visitor.read', 'gate.pass.issue']);
  principal = await actorFor(t.orgId, ['gate.visitor.read', 'gate.visitor.bar']);
  expector = await actorFor(t.orgId, ['gate.visit.expect']);
  otherStaff = await actorFor(t.orgId, ['gate.visit.expect']);
  // A second guardian, restricted (as for a court order), with a phone on record.
  restrictedId = await withTenant(db, t.orgId, async (tx) => {
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (${t.orgId}, 'Synthetic Restricted Parent') returning id::text`);
    const id = p?.id ?? '';
    await tx.execute(sql`
      insert into guardian_link (org_id, guardian_person_id, student_person_id, relationship, restricted_at,
        restriction_reason)
      values (${t.orgId}, ${id}, ${t.studentId}, 'father', now(), 'Court order')`);
    await tx.execute(sql`
      insert into person_contact (org_id, person_id, channel, address) values (${t.orgId}, ${id}, 'sms', ${restrictedPhone})`);
    return id;
  });
});
afterAll(() => close());

describe('visits', () => {
  it('checks a walk-in in to see a teacher, tells the teacher, remembers them, checks them out', async () => {
    const phone = syntheticPhone();
    const { visitId } = await checkIn(
      deps,
      guard,
      walkIn(phone, { hostPersonId: t.teacherId, partySize: 2, vehicleNo: 'ka01ab1234' }),
    );
    await run(VISIT_CHECKED_IN, { visitId, institutionId: t.institutionId });
    expect(await messages(`gate-visit:${visitId}`)).toEqual([
      {
        to: t.teacherId,
        kind: 'gate',
        body: 'Synthetic Ramesh and 1 more are at the gate to see you.',
      },
    ]);
    const day = await gateToday(deps, guard, t.institutionId);
    expect(day.inside.find((v) => v.visitId === visitId)).toMatchObject({
      host: expect.stringContaining('Synthetic Teacher'),
      vehicleNo: 'KA01AB1234',
      state: 'in',
    });
    // The seed's visitor is inside too: 2 visits, 3 people.
    expect(day.figures).toMatchObject({ insideNow: 2, peopleInside: 3, passesToday: 1 });

    // The phone brings the name back next time.
    expect(
      await visitorByPhone(deps, guard, { institutionId: t.institutionId, phone }),
    ).toMatchObject({ name: 'Synthetic Ramesh', barredReason: null });
    await checkOut(deps, guard, { institutionId: t.institutionId, visitId });
    expect(await code(checkOut(deps, guard, { institutionId: t.institutionId, visitId }))).toBe(
      'not_inside',
    );
    const history = await visitHistory(deps, guard, {
      institutionId: t.institutionId,
      on: day.today,
      search: phone.slice(-6),
    });
    expect(history.visits.map((v) => v.state)).toEqual(['out']);
  });

  it('refuses a host who is not staff, and anyone who does not keep the gate', async () => {
    expect(
      await code(checkIn(deps, guard, walkIn(syntheticPhone(), { hostPersonId: t.studentId }))),
    ).toBe('host_not_staff');
    expect(await code(checkIn(deps, expector, walkIn(syntheticPhone())))).toBe('denied');
    expect(await code(gateToday(deps, expector, t.institutionId))).toBe('denied');
  });
});

describe('barred visitors', () => {
  it('only the principal bars; a barred visitor is refused at the gate until the bar is lifted', async () => {
    const phone = syntheticPhone();
    const bar = {
      institutionId: t.institutionId,
      phone,
      name: 'Synthetic Trouble',
      reason: 'Threatened staff',
    };
    expect(await code(barVisitor(deps, guard, bar))).toBe('denied');
    const { visitorId } = await barVisitor(deps, principal, bar);
    expect(await code(barVisitor(deps, principal, bar))).toBe('already_barred');
    await expect(checkIn(deps, guard, walkIn(phone))).rejects.toMatchObject({
      code: 'visitor_barred',
      details: { reason: 'Threatened staff' },
    });
    await liftBar(deps, principal, {
      institutionId: t.institutionId,
      visitorId,
      reason: 'Apologised in writing',
    });
    expect(await code(checkIn(deps, guard, walkIn(phone)))).toBe('ok');
  });
});

describe('expected visits', () => {
  it('a staff member expects a visitor; the gate checks them in with one tap, once', async () => {
    const phone = syntheticPhone();
    const day = (await gateToday(deps, guard, t.institutionId)).today;
    const expect1 = {
      institutionId: t.institutionId,
      phone,
      name: 'Synthetic Interviewee',
      purpose: 'interview' as const,
      note: 'Maths post',
      partySize: 1,
      expectedOn: day,
    };
    expect(
      await code(expectVisitor(deps, expector, { ...expect1, expectedOn: '2020-01-01' })),
    ).toBe('past_date');
    const { visitId } = await expectVisitor(deps, expector, expect1);
    const mine = await myExpected(deps, expector, t.institutionId);
    // The host sees their visitor, but phones stay at the gate.
    expect(mine.find((v) => v.visitId === visitId)).toMatchObject({ state: 'expected', phone: '' });
    expect(
      await code(cancelExpected(deps, otherStaff, { institutionId: t.institutionId, visitId })),
    ).toBe('denied');
    const gate = await gateToday(deps, guard, t.institutionId);
    expect(gate.expected.map((v) => v.visitId)).toContain(visitId);

    // The screen sends the expected host back; they needn't be on the staff roll (an owner).
    await checkIn(
      deps,
      guard,
      walkIn(phone, {
        visitId,
        purpose: 'interview',
        name: 'Synthetic Interviewee',
        hostPersonId: expector.personId,
      }),
    );
    expect(await code(checkIn(deps, guard, walkIn(phone, { visitId, purpose: 'interview' })))).toBe(
      'not_expected',
    );
    // The host is the person who expected them.
    expect(
      (await gateToday(deps, guard, t.institutionId)).inside.find((v) => v.visitId === visitId)
        ?.hostPersonId,
    ).toBe(expector.personId);
    // Staff find colleagues to meet; only the office finds students.
    expect(
      await code(
        findPeople(deps, expector, {
          institutionId: t.institutionId,
          text: 'Synthetic',
          kind: 'student',
        }),
      ),
    ).toBe('denied');
  });
});

describe('gate passes', () => {
  it('offers only unrestricted guardians and refuses a restricted one however typed', async () => {
    const options = await pickupOptions(deps, office, {
      institutionId: t.institutionId,
      studentId: t.studentId,
    });
    expect(options.map((o) => o.personId)).toEqual([t.guardianId]);
    const base = { institutionId: t.institutionId, studentId: t.studentId, reason: 'Fever' };
    expect(
      await code(issuePass(deps, office, { ...base, collector: { guardianId: restrictedId } })),
    ).toBe('collector_restricted');
    expect(
      await code(
        issuePass(deps, office, {
          ...base,
          collector: { name: 'Synthetic Uncle', relation: 'Uncle', phone: restrictedPhone },
        }),
      ),
    ).toBe('collector_restricted');
    expect(
      await code(issuePass(deps, office, { ...base, collector: { guardianId: t.teacherId } })),
    ).toBe('collector_not_guardian');
    expect(
      await code(
        issuePass(deps, office, {
          ...base,
          studentId: t.teacherId,
          collector: { guardianId: t.guardianId },
        }),
      ),
    ).toBe('not_a_student');
    expect(
      await code(issuePass(deps, guard, { ...base, collector: { guardianId: t.guardianId } })),
    ).toBe('denied');
  });

  it('lets the child out once, and tells every unrestricted guardian, opted out or not', async () => {
    const { passId } = await issuePass(deps, office, {
      institutionId: t.institutionId,
      studentId: t.studentId,
      collector: { guardianId: t.guardianId },
      reason: 'Doctor appointment',
    });
    expect(await code(passLeft(deps, office, { institutionId: t.institutionId, passId }))).toBe(
      'denied',
    );
    await passLeft(deps, guard, { institutionId: t.institutionId, passId });
    expect(await code(passLeft(deps, guard, { institutionId: t.institutionId, passId }))).toBe(
      'pass_not_valid',
    );
    // A safety message: it goes even to a guardian who switched academic messages off.
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update guardian_link set academic_messages = false
        where org_id = app_current_org() and guardian_person_id = ${t.guardianId}`),
    );
    await run(PASS_LEFT, { passId, institutionId: t.institutionId });
    const sent = await messages(`gate-pass:${passId}`);
    expect(sent.map((m) => m.to)).toEqual([t.guardianId]);
    expect(sent[0]?.body).toMatch(
      /^Synthetic Student Gate left school at \d{2}:\d{2} [AP]M with Synthetic Guardian Gate \(mother\)\. Reason: Doctor appointment$/,
    );
  });

  it('refuses at the gate a guardian restricted after the pass was issued', async () => {
    const day = await gateToday(deps, guard, t.institutionId);
    // The seed's pass, collected by the seed guardian.
    const seeded = day.passes.find((p) => p.state === 'issued' && p.reason === 'Doctor visit');
    expect(seeded).toBeDefined();
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update guardian_link set restricted_at = now(), restriction_reason = 'Family request'
        where org_id = app_current_org() and guardian_person_id = ${t.guardianId}`),
    );
    expect(
      await code(
        passLeft(deps, guard, { institutionId: t.institutionId, passId: seeded?.passId ?? '' }),
      ),
    ).toBe('collector_restricted');
  });
});
