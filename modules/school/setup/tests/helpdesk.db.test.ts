// The helpdesk across modules (docs/specs/HELPDESK.md): parents raise requests about their own
// child only, staff for themselves; numbers per school; urgent halves the time; internal notes
// never reach the requester; replies move the state, reopening within 7 days; assignees must be
// staff and can work what they're given; messages to requester and assignee.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { grantPermission, seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { schoolPlacement } from '@campusverse/school-enrolment';
import {
  TICKET_REPLIED,
  assignTicket,
  helpdeskCategories,
  helpdeskFigures,
  helpdeskJobs,
  installHelpdeskCategories,
  myRequests,
  raiseTicket,
  replyTicket,
  ticket,
  tickets,
  type HelpdeskDeps,
} from '@campusverse/shared-helpdesk';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: HelpdeskDeps = {
  db,
  permissions: createPermissions(null),
  placements: [schoolPlacement],
};

let t: SeededTenant;
let parent: Actor;
let office: Actor;
let staff: Actor;
let teacher: Actor;
let cat: Record<string, string>;
let ticketId: string;
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e.name === 'PermissionDenied' ? 'denied' : (e.code ?? String(e)),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Helpdesk');
  await withTenant(db, t.orgId, (tx) => installHelpdeskCategories(tx));
  await grantPermission(db, t.orgId, 'parent', 'helpdesk.ticket.raise', 'guardian');
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
  office = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['helpdesk.ticket.handle', 'helpdesk.ticket.raise']),
  };
  staff = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['helpdesk.ticket.raise']),
  };
  // The seed's teacher (on staff here) may raise requests for themselves.
  await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into role (org_id, key, name) values (${t.orgId}, 'help_teacher', 'Teacher') returning id::text`);
    await tx.execute(sql`
      insert into role_grant (org_id, role_id, permission, relation)
      values (${t.orgId}, ${r?.id}, 'helpdesk.ticket.raise', 'self')`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      values (${t.orgId}, ${t.teacherId}, ${r?.id}, 'organisation', ${t.orgId})`);
  });
  teacher = { accountId: randomUUID(), orgId: t.orgId, personId: t.teacherId };
  cat = Object.fromEntries((await helpdeskCategories(deps, parent)).map((c) => [c.name, c.id]));
});
afterAll(() => close());

describe('raising', () => {
  it('parents raise about their own child, in parents’ categories; numbers run per school', async () => {
    const ask = {
      institutionId: null,
      studentId: t.studentId,
      categoryId: cat['Fees and payments'] ?? '',
      subject: 'Receipt not received',
      body: 'Paid online yesterday; no receipt yet.',
      priority: 'urgent' as const,
    };
    const first = await raiseTicket(deps, parent, ask);
    ticketId = first.ticketId;
    // The seed already used number 1.
    expect(first.number).toBe(2);
    expect(await code(raiseTicket(deps, parent, { ...ask, studentId: t.teacherId }))).toBe(
      'not_a_student',
    );
    expect(
      await code(
        raiseTicket(deps, parent, { ...ask, categoryId: cat['Facilities and repairs'] ?? '' }),
      ),
    ).toBe('not_for_you');
    const row = (await myRequests(deps, parent)).find((x) => x.number === 2);
    expect(row).toMatchObject({
      number: 2,
      state: 'open',
      student: expect.stringContaining('Synthetic Student'),
    });
    // Urgent: 12 of the category's 24 hours.
    const hours =
      (new Date(row?.dueAt ?? '').getTime() - new Date(row?.createdAt ?? '').getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(12);
  });

  it('staff raise for themselves and see only their own unless they handle requests', async () => {
    const own = await raiseTicket(deps, staff, {
      institutionId: t.institutionId,
      studentId: null,
      categoryId: cat['Facilities and repairs'] ?? '',
      subject: 'Projector in 5-A not working',
      body: 'No signal from the laptop.',
      priority: 'normal',
    });
    expect(own.number).toBe(3);
    expect(await code(tickets(deps, staff, { institutionId: t.institutionId, view: 'open' }))).toBe(
      'denied',
    );
    expect(
      (await tickets(deps, staff, { institutionId: t.institutionId, view: 'raised' })).map(
        (x) => x.number,
      ),
    ).toEqual([3]);
    expect(await code(ticket(deps, staff, ticketId))).toBe('ticket_not_found');
    const queue = await tickets(deps, office, { institutionId: t.institutionId, view: 'open' });
    expect(queue.map((x) => x.number).sort()).toEqual([1, 2, 3]);
  });
});

describe('working a request', () => {
  it('keeps internal notes from the requester and moves the state with replies', async () => {
    await replyTicket(deps, office, {
      ticketId,
      body: 'Checking with the bank: the gateway shows it pending.',
      internal: true,
    });
    expect((await ticket(deps, office, ticketId)).state).toBe('open');
    expect(
      await code(replyTicket(deps, parent, { ticketId, body: 'Hidden?', internal: true })),
    ).toBe('internal_not_allowed');
    const r = await replyTicket(deps, office, {
      ticketId,
      body: 'We see the payment; the receipt will come within a day. Can you send the UTR?',
      internal: false,
      state: 'waiting',
    });
    expect(r.state).toBe('waiting');
    const seen = await ticket(deps, parent, ticketId);
    expect(seen.messages.map((m) => m.internal)).toEqual([false, false]);
    expect(seen.canWork).toBe(false);
    // The parent is told, under their child.
    await withTenant(db, t.orgId, async (tx) => {
      for (const job of helpdeskJobs())
        await job.handle?.(tx, {
          id: randomUUID(),
          orgId: t.orgId,
          type: TICKET_REPLIED,
          payload: { ticketId, byRequester: false },
          occurredAt: new Date().toISOString(),
        });
    });
    const [msg] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ to: string; about: string; title: string }>(sql`
        select recipient_person_id::text as to, about_person_id::text as about, title from notification_message
        where org_id = app_current_org() and kind = 'helpdesk' order by created_at desc limit 1`),
    );
    expect(msg).toEqual({
      to: t.guardianId,
      about: t.studentId,
      title: 'Reply to your request #2',
    });

    expect(
      (await replyTicket(deps, parent, { ticketId, body: 'UTR 123456', internal: false })).state,
    ).toBe('in_progress');
    await replyTicket(deps, office, {
      ticketId,
      body: 'Receipt sent.',
      internal: false,
      state: 'resolved',
    });
    // Reopened within 7 days; closed after that.
    expect(
      (await replyTicket(deps, parent, { ticketId, body: 'Not in the app', internal: false }))
        .state,
    ).toBe('in_progress');
    await replyTicket(deps, office, {
      ticketId,
      body: 'Resent.',
      internal: false,
      state: 'resolved',
    });
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update helpdesk_ticket set resolved_at = now() - interval '8 days', created_at = now() - interval '9 days'
        where org_id = app_current_org() and id = ${ticketId}`),
    );
    expect(
      await code(replyTicket(deps, parent, { ticketId, body: 'Again', internal: false })),
    ).toBe('closed');
  });

  it('assigns only to staff of the school; the assignee can work the request', async () => {
    const [projector] = await tickets(deps, staff, {
      institutionId: t.institutionId,
      view: 'raised',
    });
    const id = projector?.ticketId ?? '';
    expect(await code(assignTicket(deps, office, { ticketId: id, personId: t.guardianId }))).toBe(
      'not_staff',
    );
    expect(await code(assignTicket(deps, staff, { ticketId: id, personId: t.teacherId }))).toBe(
      'denied',
    );
    await assignTicket(deps, office, { ticketId: id, personId: t.teacherId });
    const mine = await tickets(deps, teacher, { institutionId: t.institutionId, view: 'mine' });
    expect(mine.map((x) => x.ticketId)).toEqual([id]);
    await replyTicket(deps, teacher, {
      ticketId: id,
      body: 'Cable replaced.',
      internal: false,
      state: 'resolved',
    });
    expect(await helpdeskFigures(deps, office, t.institutionId)).toMatchObject({
      open: 1,
      resolvedWeek: 1,
    });
  });
});
