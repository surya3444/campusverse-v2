import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ESCALATION_RAISED,
  allocation,
  assignMentor,
  closeEscalation,
  escalate,
  escalations,
  menteeLog,
  mentoringJobs,
  myMentees,
  recordCheckIn,
  scheduleCheckIn,
  type MentoringDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: MentoringDeps = { db, permissions: createPermissions(null), placements: [] };

let t: SeededTenant;
let hod: Actor;
let mentor: Actor;
let other: Actor;
let counsellorId: string;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const at = () => ({ institutionId: t.institutionId });

/** A staff member of the seed school with these permissions. */
async function staff(permissions: string[]) {
  const id = await seedAdmin(db, t.orgId, permissions);
  await withTenant(db, t.orgId, (tx) =>
    tx.execute(sql`
      insert into institution_membership (org_id, person_id, institution_id, kind, valid_during)
      values (${t.orgId}, ${id}, ${t.institutionId}, 'staff', daterange(current_date - 1, null))`),
  );
  return id;
}

beforeAll(async () => {
  t = await seedTenant(db, 'Mentoring');
  hod = actor(await seedAdmin(db, t.orgId, ['mentoring.allocation.manage']));
  mentor = actor(await staff(['mentoring.mentee.mentor']));
  other = actor(await staff(['mentoring.mentee.mentor']));
  counsellorId = await seedAdmin(db, t.orgId, ['mentoring.escalation.counsel']);
});
afterAll(() => close());

describe('mentoring', () => {
  it('gives a student one mentor at a time and keeps the history', async () => {
    const before = await allocation(deps, hod, t.institutionId);
    expect(before.students.find((s) => s.personId === t.studentId)?.mentor).toBeNull();
    expect(
      await assignMentor(deps, hod, {
        ...at(),
        mentorId: other.personId,
        studentIds: [t.studentId],
      }),
    ).toEqual({ assigned: 1 });
    // Changing mentor the same day replaces; one mentor holds.
    await assignMentor(deps, hod, {
      ...at(),
      mentorId: mentor.personId,
      studentIds: [t.studentId],
    });
    // The test's staff have no staff profile, so read the mentors' own lists.
    expect((await myMentees(deps, mentor, t.institutionId)).map((m) => m.personId)).toEqual([
      t.studentId,
    ]);
    expect(await myMentees(deps, other, t.institutionId)).toEqual([]);
    expect((await allocation(deps, hod, t.institutionId)).summary.unassigned).toBe(
      before.summary.unassigned - 1,
    );
    await expect(
      assignMentor(deps, hod, { ...at(), mentorId: t.studentId, studentIds: [t.studentId] }),
    ).rejects.toMatchObject({ code: 'not_staff' });
    await expect(allocation(deps, mentor, t.institutionId)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });

  it('a mentor records check-ins for their own mentees only', async () => {
    const { id } = await scheduleCheckIn(deps, mentor, {
      ...at(),
      studentId: t.studentId,
      on: '2027-01-15',
    });
    await recordCheckIn(deps, mentor, {
      ...at(),
      studentId: t.studentId,
      meetingId: id,
      state: 'held',
      notes: 'Struggling with algebra; agreed a weekly practice sheet.',
      concern: 'watch',
    });
    await expect(
      recordCheckIn(deps, mentor, {
        ...at(),
        studentId: t.studentId,
        meetingId: id,
        state: 'missed',
        notes: null,
        concern: null,
      }),
    ).rejects.toMatchObject({ code: 'meeting_done' });
    const mine = await myMentees(deps, mentor, t.institutionId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ personId: t.studentId, lastConcern: 'watch' });
    await expect(menteeLog(deps, other, { ...at(), studentId: t.studentId })).rejects.toMatchObject(
      {
        code: 'not_your_mentee',
      },
    );
    const log = await menteeLog(deps, hod, { ...at(), studentId: t.studentId });
    expect(log.meetings[0]?.notes).toContain('algebra');
  });

  it('escalates: staff get the reason, parents only a template; then it is closed', async () => {
    const { id } = await escalate(deps, mentor, {
      ...at(),
      studentId: t.studentId,
      to: 'parent',
      reason: 'Missed three check-ins and homework is slipping badly.',
    });
    await escalate(deps, mentor, {
      ...at(),
      studentId: t.studentId,
      to: 'counsellor',
      reason: 'Seems withdrawn in class for two weeks now.',
    });
    const events = await withTenant(db, t.orgId, (tx) =>
      tx.execute<OutboxEvent>(sql`
        select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
        from ops.outbox where org_id = ${t.orgId} and type = ${ESCALATION_RAISED}`),
    );
    const [job] = mentoringJobs();
    for (const e of events) expect(await runConsumer(db, job!, e)).toBe('processed');
    const msgs = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ to: string; body: string }>(sql`
        select recipient_person_id::text as to, body from notification_message
        where dedupe_key like 'mentoring-escalation:%'`),
    );
    const parent = msgs.find((m) => m.to === t.guardianId);
    expect(parent?.body).toContain('would like to talk with you');
    expect(parent?.body).not.toContain('homework is slipping');
    expect(msgs.find((m) => m.to === counsellorId)?.body).toContain('withdrawn');

    // The counsellor sees only what was sent to the counsellor.
    const forCounsellor = await escalations(deps, actor(counsellorId), t.institutionId);
    expect(forCounsellor.every((e) => e.to === 'counsellor')).toBe(true);
    await closeEscalation(deps, hod, {
      ...at(),
      escalationId: id,
      note: 'Met the parents on Friday.',
    });
    await expect(
      closeEscalation(deps, hod, { ...at(), escalationId: id, note: 'Again' }),
    ).rejects.toMatchObject({ code: 'already_closed' });
    await expect(
      closeEscalation(deps, actor(counsellorId), { ...at(), escalationId: id, note: 'Not mine' }),
    ).rejects.toMatchObject({ code: 'escalation_not_found' });
  });
});
