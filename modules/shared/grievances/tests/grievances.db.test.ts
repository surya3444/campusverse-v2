import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CASE_RAISED,
  addNote,
  caseDetail,
  committeeCases,
  committees,
  grievanceJobs,
  moveCase,
  myCases,
  raiseCase,
  saveCommittee,
  setMembers,
  type GrievanceDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: GrievanceDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let principal: Actor;
let chair: Actor;
let raiser: Actor;
let committeeId: string;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });
const at = () => ({ institutionId: t.institutionId });

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
  t = await seedTenant(db, 'Grievances');
  principal = actor(
    await seedAdmin(db, t.orgId, ['grievance.committee.manage', 'grievance.case.raise']),
  );
  chair = actor(await staff(['grievance.case.raise']));
  raiser = actor(await staff(['grievance.case.raise']));
  ({ id: committeeId } = await saveCommittee(deps, principal, {
    ...at(),
    kind: 'internal_complaints',
    name: 'Internal Committee (POSH)',
    active: true,
  }));
  await setMembers(deps, principal, {
    ...at(),
    committeeId,
    members: [
      { personId: chair.personId, role: 'chair' },
      { outsideName: 'Synthetic NGO Member', role: 'outside_member' },
    ],
  });
});
afterAll(() => close());

describe('grievances and committees', () => {
  it('sets up a committee with the statutory days and members', async () => {
    const c = (await committees(deps, principal, t.institutionId)).find(
      (x) => x.id === committeeId,
    );
    expect(c).toMatchObject({ decideDays: 90, member: false });
    expect(c?.members.map((m) => m.role).sort()).toEqual(['chair', 'outside_member']);
    await expect(
      setMembers(deps, principal, {
        ...at(),
        committeeId,
        members: [{ personId: t.studentId, role: 'member' }],
      }),
    ).rejects.toMatchObject({ code: 'not_staff' });
  });

  it('only the committee sees a case; anonymity holds for it, not for the raiser', async () => {
    const { id, number } = await raiseCase(deps, raiser, {
      ...at(),
      committeeId,
      subject: 'Remarks in the staff room',
      details: 'Repeated remarks over two weeks; dates and witnesses listed.',
      anonymous: true,
    });
    expect(number).toBe(1);
    const forCommittee = await committeeCases(deps, chair, { ...at(), committeeId });
    expect(forCommittee[0]).toMatchObject({ id, raisedBy: 'Anonymous', state: 'received' });
    // The principal sees counts, never the case.
    await expect(committeeCases(deps, principal, { ...at(), committeeId })).rejects.toMatchObject({
      code: 'not_a_member',
    });
    await expect(caseDetail(deps, principal, { ...at(), caseId: id })).rejects.toMatchObject({
      code: 'case_not_found',
    });
    const counts = (await committees(deps, principal, t.institutionId)).find(
      (x) => x.id === committeeId,
    );
    expect(counts).toMatchObject({ open: 1, total: 1 });
    expect((await myCases(deps, raiser, t.institutionId))[0]?.raisedBy).not.toBe('Anonymous');
    // Nothing of the subject or details reaches the audit log.
    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ detail: unknown }>(sql`
        select detail from audit_event where action = 'grievance.case.raise' order by occurred_at desc limit 1`),
    );
    expect(JSON.stringify(audit?.detail)).not.toContain('staff room');

    // Members hear a case number, never its subject.
    const [event] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<OutboxEvent>(sql`
        select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
        from ops.outbox where org_id = ${t.orgId} and type = ${CASE_RAISED}`),
    );
    expect(await runConsumer(db, grievanceJobs()[0]!, event!)).toBe('processed');
    const [msg] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ body: string }>(sql`
        select body from notification_message where recipient_person_id = ${chair.personId}`),
    );
    expect(msg?.body).toContain('Case 1');
    expect(msg?.body).not.toContain('staff room');
  });

  it('the committee inquires, notes and decides; the raiser appeals; the committee closes', async () => {
    const [c] = await committeeCases(deps, chair, { ...at(), committeeId });
    const caseId = c!.id;
    await moveCase(deps, chair, { ...at(), caseId, to: 'inquiry' });
    await addNote(deps, chair, { ...at(), caseId, body: 'Heard both sides on 18 Nov.' });
    await expect(moveCase(deps, chair, { ...at(), caseId, to: 'decided' })).rejects.toMatchObject({
      code: 'outcome_needed',
    });
    await expect(
      moveCase(deps, raiser, { ...at(), caseId, to: 'decided', text: 'Mine' }),
    ).rejects.toMatchObject({
      code: 'not_a_member',
    });
    await moveCase(deps, chair, {
      ...at(),
      caseId,
      to: 'decided',
      text: 'Written warning issued.',
    });
    const seen = await caseDetail(deps, raiser, { ...at(), caseId });
    expect(seen).toMatchObject({ outcome: 'Written warning issued.', canAppeal: true, notes: [] });
    await moveCase(deps, raiser, {
      ...at(),
      caseId,
      to: 'appealed',
      text: 'The remarks continued after the warning.',
    });
    await moveCase(deps, chair, {
      ...at(),
      caseId,
      to: 'closed',
      text: 'Moved to another department.',
    });
    const done = await caseDetail(deps, chair, { ...at(), caseId });
    expect(done).toMatchObject({ state: 'closed', outcome: 'Moved to another department.' });
    expect(done.notes.map((n) => n.body)).toEqual(['Heard both sides on 18 Nov.']);
  });
});
