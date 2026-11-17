import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approvalDesign,
  approvalStates,
  decideApproval,
  myWork,
  saveApprovalSteps,
  startApproval,
  withdrawApproval,
  type WorkflowDeps,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const deps: WorkflowDeps = { db, permissions: createPermissions(null) };

let t: SeededTenant;
let owner: Actor;
let clerk: Actor;
let bursar: Actor;
let head: Actor;
let otherHead: Actor;
let secondInstitution: string;
const actor = (personId: string): Actor => ({ accountId: randomUUID(), orgId: t.orgId, personId });

/** A person holding a role (made if new) at a scope. */
async function withRole(key: string, scope: 'organisation' | 'institution', scopeId?: string) {
  return withTenant(db, t.orgId, async (tx) => {
    await tx.execute(sql`
      insert into role (org_id, key, name) values (app_current_org(), ${key}, ${key})
      on conflict (org_id, key) do nothing`);
    const [p] = await tx.execute<{ id: string }>(sql`
      insert into person (org_id, legal_name) values (app_current_org(), ${`Synthetic ${key}`}) returning id::text`);
    await tx.execute(sql`
      insert into role_assignment (org_id, person_id, role_id, scope_type, scope_id)
      select app_current_org(), ${p!.id}, id, ${scope}, ${scopeId ?? t.orgId}
      from role where org_id = app_current_org() and key = ${key}`);
    return actor(p!.id);
  });
}

const start = (subjectId: string, amountPaise: number, institutionId = t.institutionId) =>
  withTenant(db, t.orgId, (tx) =>
    startApproval(tx, {
      process: 'expenses.bill',
      subjectId,
      institutionId,
      amountPaise,
      summary: `Synthetic bill ${amountPaise}`,
      requestedBy: clerk.personId,
    }),
  );
const decide = (who: Actor, subjectId: string, approve = true, note: string | null = null) =>
  withTenant(db, t.orgId, (tx) =>
    decideApproval(tx, deps.permissions, who, {
      process: 'expenses.bill',
      subjectId,
      approve,
      note,
    }),
  );
const state = (who: Actor, subjectId: string) =>
  withTenant(
    db,
    t.orgId,
    async (tx) =>
      (await approvalStates(tx, deps.permissions, who, 'expenses.bill', [subjectId]))[subjectId]!,
  );

beforeAll(async () => {
  t = await seedTenant(db, 'Workflow');
  owner = actor(
    await seedAdmin(db, t.orgId, ['platform.workflow.manage', 'expenses.bill.approve']),
  );
  clerk = actor(await seedAdmin(db, t.orgId, ['expenses.bill.record']));
  secondInstitution = await withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      insert into institution (org_id, campus_id, legal_entity_id, type, authority_code, name)
      select org_id, campus_id, legal_entity_id, 'school', 'CBSE', 'Synthetic Second School'
      from institution where org_id = app_current_org() and id = ${t.institutionId} returning id::text`);
    return r!.id;
  });
  bursar = await withRole('bursar', 'institution', t.institutionId);
  head = await withRole('head', 'institution', t.institutionId);
  otherHead = await withRole('head', 'institution', secondInstitution);
});
afterAll(() => close());

describe('approval engine', () => {
  it('with no steps set, anyone holding the process permission decides, never the requester', async () => {
    const bill = randomUUID();
    await start(bill, 1_000_00);
    expect(await state(owner, bill)).toMatchObject({ steps: 1, stepRole: null, mine: true });
    expect(await state(clerk, bill)).toMatchObject({ mine: false });
    await expect(decide(clerk, bill)).rejects.toMatchObject({ code: 'own_request' });
    await expect(decide(bursar, bill)).rejects.toMatchObject({ code: 'not_your_step' });
    expect(await decide(owner, bill)).toBe('approved');
    await expect(decide(owner, bill)).rejects.toMatchObject({ code: 'no_request' });
  });

  it('the designer sets steps by role, with amount limits and an escalation timer', async () => {
    await expect(
      saveApprovalSteps(deps, bursar, { process: 'expenses.bill', institutionId: null, steps: [] }),
    ).rejects.toMatchObject({ name: 'PermissionDenied' });
    await expect(
      saveApprovalSteps(deps, owner, {
        process: 'academics.registration',
        institutionId: null,
        steps: [{ role: 'head', minAmountPaise: 100, hours: null, escalateTo: null }],
      }),
    ).rejects.toMatchObject({ code: 'amounts_not_used' });
    await expect(
      saveApprovalSteps(deps, owner, {
        process: 'expenses.bill',
        institutionId: null,
        steps: [{ role: 'no_such_role', minAmountPaise: null, hours: null, escalateTo: null }],
      }),
    ).rejects.toMatchObject({ code: 'steps_invalid' });
    await saveApprovalSteps(deps, owner, {
      process: 'expenses.bill',
      institutionId: null,
      steps: [
        { role: 'bursar', minAmountPaise: null, hours: 48, escalateTo: 'head' },
        { role: 'head', minAmountPaise: 50_000_00, hours: null, escalateTo: null },
      ],
    });
    const design = await approvalDesign(deps, owner, null);
    expect(design.processes.find((p) => p.process === 'expenses.bill')?.steps).toHaveLength(2);
    expect(design.roles.map((r) => r.key)).toContain('bursar');

    // A small bill: the bursar alone.
    const small = randomUUID();
    await start(small, 5_000_00);
    expect(await state(bursar, small)).toMatchObject({ steps: 1, stepRole: 'bursar', mine: true });
    await expect(decide(owner, small)).rejects.toMatchObject({ code: 'not_your_step' });
    expect(await decide(bursar, small)).toBe('approved');

    // A large bill: bursar, then head; the head of another school can't decide it.
    const large = randomUUID();
    await start(large, 80_000_00);
    expect(await decide(bursar, large)).toBe('pending');
    expect(await state(head, large)).toMatchObject({ step: 2, steps: 2, mine: true });
    await expect(decide(otherHead, large)).rejects.toMatchObject({ code: 'not_your_step' });
    const work = await myWork(deps, head);
    expect(work.map((w) => w.subjectId)).toContain(large);
    expect(work.find((w) => w.subjectId === large)).toMatchObject({ step: 2, steps: 2 });
    await expect(decide(head, large, false)).rejects.toMatchObject({ code: 'note_required' });
    expect(await decide(head, large, false, 'Over budget this quarter')).toBe('rejected');
    expect((await state(owner, large)).history.map((h) => h.decision)).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('after the timer, the escalation role may decide too', async () => {
    const late = randomUUID();
    await start(late, 1_000_00);
    expect(await state(head, late)).toMatchObject({ mine: false, overdue: false });
    expect((await myWork(deps, head)).map((w) => w.subjectId)).not.toContain(late);
    await withTenant(db, t.orgId, (tx) =>
      tx.execute(sql`
        update approval_request set step_since = now() - interval '49 hours'
        where org_id = app_current_org() and subject_id = ${late}`),
    );
    expect(await state(head, late)).toMatchObject({ mine: true, overdue: true });
    expect((await myWork(deps, head)).find((w) => w.subjectId === late)?.escalated).toBe(true);
    expect(await decide(head, late)).toBe('approved');
    const [d] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ escalated: boolean }>(sql`
        select d.escalated from approval_decision d join approval_request r on r.org_id = d.org_id and r.id = d.request_id
        where r.subject_id = ${late}`),
    );
    expect(d!.escalated).toBe(true);
  });

  it('an institution’s own steps replace the organisation’s there; waiting requests keep theirs', async () => {
    const waiting = randomUUID();
    await start(waiting, 1_000_00, secondInstitution);
    await saveApprovalSteps(deps, owner, {
      process: 'expenses.bill',
      institutionId: secondInstitution,
      steps: [{ role: 'head', minAmountPaise: null, hours: null, escalateTo: null }],
    });
    const fresh = randomUUID();
    await start(fresh, 1_000_00, secondInstitution);
    expect(await state(otherHead, fresh)).toMatchObject({ stepRole: 'head', mine: true });
    expect(await state(otherHead, waiting)).toMatchObject({ stepRole: 'bursar', mine: false });
    const own = await approvalDesign(deps, owner, secondInstitution);
    expect(own.processes.find((p) => p.process === 'expenses.bill')?.inherited).toBe(false);
    // Withdrawn requests leave My Work.
    await withTenant(db, t.orgId, (tx) => withdrawApproval(tx, 'expenses.bill', fresh));
    expect((await myWork(deps, otherHead)).map((w) => w.subjectId)).not.toContain(fresh);
  });

  it('decisions are append-only', async () => {
    await expect(
      withTenant(db, t.orgId, (tx) => tx.execute(sql`delete from approval_decision`)),
    ).rejects.toThrow();
  });
});
