// Verse AI first (decision 0021): actions are prepared, never done, until the person they were
// prepared for confirms them, once, within 15 minutes, still holding the permission. Runs the
// API's own Verse wiring against real Postgres with scripted models (nothing leaves the machine).
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { PermissionDenied, createPermissions, type Actor } from '@campusverse/platform-permissions';
import {
  askVerse,
  confirmAction,
  conversation,
  conversations,
  dismissAction,
  type VerseDeps,
} from '@campusverse/platform-verse';
import { localModel, scriptedModel, turn, type Model } from '@campusverse/verse-ai';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verseDeps } from '../src/verse.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const noStore = {
  put: () => Promise.reject(new Error('no store')),
  get: () => Promise.resolve(null),
  size: () => Promise.resolve(null),
  signedUpload: () => Promise.reject(new Error('no store')),
  signedDownload: () => Promise.reject(new Error('no store')),
};
// The seeded school has no customer record: Verse AI is simply on, with room in the budget.
const deps = (model: Model): VerseDeps => ({
  ...verseDeps({ db, permissions }, model, noStore),
  switchedOn: async () => true,
  monthlyTokens: async () => 1e9,
});

let t: SeededTenant;
let librarian: Actor;
let other: Actor;
const loanOpen = () =>
  withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from library_loan l join library_copy c on c.org_id = l.org_id and c.id = l.copy_id
      where l.org_id = app_current_org() and c.accession_no = 'ACC-0001' and l.returned_on is null`);
    return (r?.n ?? 0) > 0;
  });
const returnAcc = () =>
  scriptedModel([
    () => turn.call('library_loan_return', { accessionNo: 'ACC-0001' }),
    () => turn.text('Tap Return to take Synthetic Stories back.'),
  ]);
const ask = (actor: Actor, model: Model, question = 'Return ACC-0001', conversationId?: string) =>
  askVerse(deps(model), actor, {
    institutionId: t.institutionId,
    question,
    conversationId: conversationId ?? null,
  });
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string; name?: string }) =>
      e instanceof PermissionDenied ? 'denied' : (e.code ?? String(e)),
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Verse Actions');
  librarian = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, [
      'platform.verse.ask',
      'library.book.read',
      'library.book.manage',
      'people.student.read',
    ]),
  };
  other = {
    accountId: randomUUID(),
    orgId: t.orgId,
    personId: await seedAdmin(db, t.orgId, ['platform.verse.ask', 'library.book.manage']),
  };
});
afterAll(() => close());

describe('an action Verse AI prepares', () => {
  it('changes nothing until its own person confirms it, and runs once', async () => {
    const a = await ask(librarian, returnAcc());
    expect(a.actions).toEqual([
      expect.objectContaining({
        tool: 'library.loan.return',
        title: 'Return Synthetic Stories',
        confirm: 'Return',
        state: 'proposed',
      }),
    ]);
    expect(await loanOpen()).toBe(true);
    const id = a.actions[0]?.actionId ?? '';
    // Someone else can't confirm it, even with the same permission.
    expect(await code(confirmAction(deps(localModel()), other, id))).toBe('action_not_found');
    const done = await confirmAction(deps(localModel()), librarian, id);
    expect(done).toMatchObject({ state: 'done', outcome: expect.stringMatching(/returned by/) });
    expect(await loanOpen()).toBe(false);
    // A second tap changes nothing more.
    expect(await confirmAction(deps(localModel()), librarian, id)).toMatchObject({ state: 'done' });
    const audit = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ action: string }>(sql`
        select action from audit_event where org_id = app_current_org()
          and action in ('platform.verse.act', 'library.loan.return') order by occurred_at`),
    );
    expect(audit.map((r) => r.action)).toEqual(['platform.verse.act', 'library.loan.return']);
  });

  it('says why when the module refuses, and expires after 15 minutes', async () => {
    // The book is back now: preparing again finds nothing to return, so no card.
    const again = await ask(librarian, returnAcc());
    expect(again.actions).toEqual([]);
    // A fresh loan, then a proposal left too long.
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        with c as (update library_copy set status = 'on_loan' where org_id = app_current_org()
          and accession_no = 'ACC-0001' returning id)
        insert into library_loan (org_id, institution_id, copy_id, borrower_person_id, borrower_kind, issued_on,
          due_on, issued_by_person_id)
        select app_current_org(), ${t.institutionId}, c.id, ${t.studentId}, 'student', app_today(),
          app_today() + 14, ${librarian.personId} from c`),
    );
    const a = await ask(librarian, returnAcc());
    const id = a.actions[0]?.actionId ?? '';
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update verse_action set expires_at = now() - interval '1 minute'
        where org_id = app_current_org() and id = ${id}`),
    );
    expect(await code(confirmAction(deps(localModel()), librarian, id))).toBe('action_expired');
    expect(await loanOpen()).toBe(true);
  });

  it('is refused at confirm when the permission went in the meantime; dismissed ones never run', async () => {
    const a = await ask(librarian, returnAcc());
    const b = await ask(librarian, returnAcc());
    await dismissAction(deps(localModel()), librarian, b.actions[0]?.actionId ?? '');
    expect(
      await confirmAction(deps(localModel()), librarian, b.actions[0]?.actionId ?? ''),
    ).toMatchObject({ state: 'dismissed' });
    await withTenant(db, t.orgId, async (tx) => {
      await tx.execute(sql`
        delete from role_grant where org_id = app_current_org() and permission = 'library.book.manage'
          and role_id in (select role_id from role_assignment where org_id = app_current_org()
            and person_id = ${librarian.personId})`);
      await tx.execute(
        sql`update organisation set permission_version = permission_version + 1 where id = app_current_org()`,
      );
    });
    expect(
      await code(confirmAction(deps(localModel()), librarian, a.actions[0]?.actionId ?? '')),
    ).toBe('denied');
    expect(await loanOpen()).toBe(true);
  });

  it('is never prepared from a tool the person was not offered', async () => {
    // other lacks library.book.read? They hold manage, so offered; a viewer is not.
    const viewer = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, ['platform.verse.ask']),
    };
    const a = await ask(viewer, returnAcc());
    expect(a.actions).toEqual([]);
    const [log] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ tools: { tool: string; outcome: string }[] }>(sql`
        select tools from verse_request where org_id = app_current_org() and id = ${a.requestId}`),
    );
    expect(log?.tools[0]).toMatchObject({ outcome: 'not_offered' });
  });
});

describe('names and conversations', () => {
  it('finds a student by name for someone who may see students, and remembers the conversation', async () => {
    const reader = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, ['platform.verse.ask', 'people.student.read']),
    };
    const conversationId = randomUUID();
    const first = scriptedModel([
      (req) => {
        expect(req.tools.map((x) => x.name)).toContain('people_find');
        return turn.call('people_find', { text: 'Synthetic Student' });
      },
      (req) => {
        const out = JSON.stringify(req.messages.at(-1));
        expect(out).toContain('Synthetic Student Verse Actions');
        expect(out).toContain('Class 5-A');
        return turn.text('Synthetic Student Verse Actions is in Class 5-A.');
      },
    ]);
    await ask(reader, first, 'Find Synthetic Student', conversationId);
    // The follow-up sees the earlier turn.
    const second = scriptedModel([
      (req) => {
        expect(JSON.stringify(req.messages)).toContain('is in Class 5-A');
        return turn.text('Their class teacher is on the timetable page.');
      },
    ]);
    await ask(reader, second, 'Who teaches them?', conversationId);
    const turns = await conversation(deps(localModel()), reader, conversationId);
    expect(turns.map((x) => x.question)).toEqual(['Find Synthetic Student', 'Who teaches them?']);
    expect((await conversations(deps(localModel()), reader))[0]).toMatchObject({
      conversationId,
      title: 'Find Synthetic Student',
    });
    // Nobody else sees it.
    expect(await conversation(deps(localModel()), librarian, conversationId)).toEqual([]);
  });

  it('the offline model prepares an action from a plain sentence', async () => {
    const warden = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, [
        'platform.verse.ask',
        'hostel.resident.read',
        'hostel.outpass.decide',
      ]),
    };
    const a = await ask(warden, localModel(), 'Approve the outpass for the family wedding');
    expect(a.actions).toEqual([
      expect.objectContaining({ tool: 'hostel.outpass.decide', confirm: 'Approve' }),
    ]);
    const done = await confirmAction(deps(localModel()), warden, a.actions[0]?.actionId ?? '');
    expect(done.state).toBe('done');
  });
});

describe('more actions', () => {
  it('corrects one day of attendance, with the reason, only after Confirm', async () => {
    const office = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, [
        'platform.verse.ask',
        'school.attendance.read',
        'school.attendance.mark',
        'school.attendance.manage',
      ]),
    };
    const status = () =>
      withTenant(db, t.orgId, async (tx) => {
        const [r] = await tx.execute<{ status: string }>(sql`
          select status from school_attendance_day where org_id = app_current_org()
            and person_id = ${t.studentId} and on_date = '2026-07-01'`);
        return r?.status;
      });
    const model = scriptedModel([
      () =>
        turn.call('school_attendance_correct', {
          personId: t.studentId,
          date: '2026-07-01',
          status: 'present',
          reason: 'Was at the science fair on school work',
        }),
      () => turn.text('Tap Correct to mark them present.'),
    ]);
    const a = await ask(office, model, 'Mark the student present on 1 July');
    expect(a.actions[0]).toMatchObject({
      tool: 'school.attendance.correct',
      title: expect.stringMatching(/present on 2026-07-01$/),
      lines: expect.arrayContaining(['Was absent']),
    });
    expect(await status()).toBe('absent');
    expect(
      await confirmAction(deps(localModel()), office, a.actions[0]?.actionId ?? ''),
    ).toMatchObject({
      state: 'done',
    });
    expect(await status()).toBe('present');
  });

  it('sets homework for a class and subject named in words', async () => {
    const head = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, [
        'platform.verse.ask',
        'school.homework.read',
        'school.homework.set',
        'school.homework.manage',
      ]),
    };
    const [d] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ due: string }>(sql`select (app_today() + 2)::text as due`),
    );
    const model = scriptedModel([
      () =>
        turn.call('homework_set', {
          section: 'Class 5-A',
          subject: 'english',
          title: 'Read chapter 4',
          dueOn: d?.due,
        }),
      () => turn.text('Tap Set homework.'),
    ]);
    const a = await ask(head, model, 'Set English homework for 5-A: read chapter 4');
    expect(a.actions[0]).toMatchObject({ title: 'Set English homework for Class 5-A' });
    const done = await confirmAction(deps(localModel()), head, a.actions[0]?.actionId ?? '');
    expect(done.state).toBe('done');
    const [hw] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(sql`
        select count(*)::int as n from school_homework where org_id = app_current_org() and title = 'Read chapter 4'`),
    );
    expect(hw?.n).toBe(1);
  });

  it('prepares no fee reminders when nothing is overdue', async () => {
    const accounts = {
      accountId: randomUUID(),
      orgId: t.orgId,
      personId: await seedAdmin(db, t.orgId, [
        'platform.verse.ask',
        'finance.invoice.read',
        'finance.invoice.issue',
      ]),
    };
    const model = scriptedModel([
      () => turn.call('finance_reminders_send', { minDaysOverdue: 7 }),
      (req) => {
        expect(JSON.stringify(req.messages.at(-1))).toContain('No fees are overdue');
        return turn.text('Nothing is overdue, so no reminders are needed.');
      },
    ]);
    const a = await ask(accounts, model, 'Send fee reminders');
    expect(a.actions).toEqual([]);
  });
});
