// Campus Core › Workflow & Approvals (rule book §12.4 decision 6, §13 Campus Core): the designer,
// requests started and decided inside the owning module's transaction, and My Work. Roles come
// from platform/permissions; names from people/records; places from platform/organisation.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { writeAudit } from '@campusverse/platform-audit';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  listRoles,
  rolesOf,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import {
  PROCESSES,
  applicableSteps,
  isProcess,
  mayDecide,
  overdueAt,
  type HeldRole,
  type PolicyStep,
  type ProcessKey,
  type RequestStep,
} from '../domain/workflow.js';

type Permissions = ReturnType<typeof createPermissions>;
export type WorkflowDeps = { db: Db; permissions: Permissions };
const MANAGE = 'platform.workflow.manage';

export type ApprovalErrorCode =
  | 'unknown_process'
  | 'institution_not_found'
  | 'no_request'
  | 'not_your_step'
  | 'own_request'
  | 'already_acted'
  | 'note_required'
  | 'amounts_not_used'
  | 'steps_invalid';

export class ApprovalError extends Error {
  constructor(readonly code: ApprovalErrorCode) {
    super(`approval: ${code}`);
    this.name = 'ApprovalError';
  }
}

const one = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T | null> =>
  ((await tx.execute(q)) as T[])[0] ?? null;

async function policyFor(tx: Tx, process: string, institutionId: string): Promise<PolicyStep[]> {
  const rows = await tx.execute<PolicyStep & { own: boolean }>(sql`
    select approver_role_key as role, min_amount_paise::float as "minAmountPaise", hours,
      escalate_role_key as "escalateTo", institution_id is not null as own
    from approval_step where org_id = app_current_org() and process = ${process}
      and (institution_id is null or institution_id = ${institutionId})
    order by position`);
  // An institution's own steps replace the organisation's there (a recorded branch override).
  const own = rows.filter((r) => r.own);
  return (own.length ? own : rows).map((s) => ({
    role: s.role,
    minAmountPaise: s.minAmountPaise,
    hours: s.hours,
    escalateTo: s.escalateTo,
  }));
}

async function rolesNow(tx: Tx, personId: string): Promise<HeldRole[]> {
  const today = (await one<{ d: string }>(tx, sql`select app_today()::text as d`))?.d ?? '';
  return (await rolesOf(tx, personId))
    .filter((r) => r.from <= today && (r.until === null || r.until >= today))
    .map((r) => ({
      roleKey: r.roleKey,
      scopeType: r.scopeType as HeldRole['scopeType'],
      scopeId: r.scopeId,
    }));
}

// ---------------------------------------------------------------------------------------------
// Called by owning modules, inside their own transaction
// ---------------------------------------------------------------------------------------------

/**
 * Starts the approval of a subject (a bill, a registration), replacing any request still open for
 * it. The steps that apply now are copied onto the request, so later design changes don't move
 * requests already waiting.
 */
export async function startApproval(
  tx: Tx,
  input: {
    process: ProcessKey;
    subjectId: string;
    institutionId: string;
    amountPaise: number | null;
    summary: string;
    requestedBy: string | null;
  },
): Promise<{ requestId: string; steps: number }> {
  const place = await placeOf(tx, input.institutionId);
  if (!place) throw new ApprovalError('institution_not_found');
  await withdrawApproval(tx, input.process, input.subjectId);
  const steps = applicableSteps(
    await policyFor(tx, input.process, input.institutionId),
    PROCESSES[input.process].amounts ? input.amountPaise : null,
  );
  const row = await one<{ id: string }>(
    tx,
    sql`
    insert into approval_request (org_id, process, subject_id, institution_id, campus_id, amount_paise, summary,
      requested_by_person_id, steps)
    values (app_current_org(), ${input.process}, ${input.subjectId}, ${input.institutionId}, ${place.campusId},
      ${input.amountPaise}, ${input.summary.slice(0, 200)}, ${input.requestedBy}, ${JSON.stringify(steps)}::jsonb)
    returning id::text`,
  );
  if (!row) throw new Error('startApproval: no row');
  return { requestId: row.id, steps: steps.length };
}

/** Closes a subject's open request without a decision (the bill was cancelled, the form changed). */
export async function withdrawApproval(tx: Tx, process: ProcessKey, subjectId: string) {
  await tx.execute(sql`
    update approval_request set status = 'withdrawn', closed_at = now()
    where org_id = app_current_org() and process = ${process} and subject_id = ${subjectId} and status = 'pending'`);
}

type OpenRequest = {
  id: string;
  institutionId: string;
  campusId: string;
  requestedBy: string | null;
  steps: RequestStep[];
  stepIndex: number;
  stepSince: string;
  actedBy: string[];
};

const pendingSql = sql`
  select r.id::text, r.institution_id::text as "institutionId", r.campus_id::text as "campusId",
    r.requested_by_person_id::text as "requestedBy", r.steps, r.step_index as "stepIndex",
    r.step_since::text as "stepSince",
    coalesce((select array_agg(d.decided_by_person_id::text) from approval_decision d
      where d.org_id = r.org_id and d.request_id = r.id), '{}') as "actedBy"
  from approval_request r`;

/** Whether `actor` may decide this request's current step now, and why not. */
async function judge(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
  process: ProcessKey,
  r: OpenRequest,
  roles: HeldRole[],
): Promise<{ ok: true; escalated: boolean } | { ok: false; why: ApprovalErrorCode }> {
  if (r.requestedBy === actor.personId) return { ok: false, why: 'own_request' };
  if (r.actedBy.includes(actor.personId)) return { ok: false, why: 'already_acted' };
  const step = r.steps[r.stepIndex];
  if (!step) return { ok: false, why: 'no_request' };
  const place = { orgId: actor.orgId, campusId: r.campusId, institutionId: r.institutionId };
  const holdsPermission =
    step.role === null &&
    (
      await permissions.can(tx, actor, PROCESSES[process].permission, {
        orgId: actor.orgId,
        place: { campusId: r.campusId, institutionId: r.institutionId },
      })
    ).allowed;
  const d = mayDecide({
    step,
    since: new Date(r.stepSince),
    now: new Date(),
    roles,
    place,
    holdsPermission,
  });
  return d.ok ? { ok: true, escalated: d.escalated } : { ok: false, why: 'not_your_step' };
}

/**
 * Decides the current step of a subject's open request. Returns the outcome: approved after the
 * last step, rejected at once, or still pending at the next step. Nobody decides their own
 * request or two steps of the same one; a rejection says why.
 */
export async function decideApproval(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
  input: { process: ProcessKey; subjectId: string; approve: boolean; note: string | null },
): Promise<'approved' | 'rejected' | 'pending'> {
  const note = input.note?.trim() || null;
  if (!input.approve && !note) throw new ApprovalError('note_required');
  const r = await one<OpenRequest>(
    tx,
    sql`${pendingSql} where r.org_id = app_current_org() and r.process = ${input.process}
      and r.subject_id = ${input.subjectId} and r.status = 'pending' for update of r`,
  );
  if (!r) throw new ApprovalError('no_request');
  const j = await judge(
    tx,
    permissions,
    actor,
    input.process,
    r,
    await rolesNow(tx, actor.personId),
  );
  if (!j.ok) throw new ApprovalError(j.why);
  await tx.execute(sql`
    insert into approval_decision (org_id, request_id, step_index, decided_by_person_id, decision, note, escalated)
    values (app_current_org(), ${r.id}, ${r.stepIndex}, ${actor.personId},
      ${input.approve ? 'approve' : 'reject'}, ${note}, ${j.escalated})`);
  const last = r.stepIndex >= r.steps.length - 1;
  const outcome = !input.approve ? 'rejected' : last ? 'approved' : 'pending';
  if (outcome === 'pending')
    await tx.execute(sql`
      update approval_request set step_index = step_index + 1, step_since = now()
      where org_id = app_current_org() and id = ${r.id}`);
  else
    await tx.execute(sql`
      update approval_request set status = ${outcome}, closed_at = now()
      where org_id = app_current_org() and id = ${r.id}`);
  await writeAudit(tx, actor, {
    action: input.approve ? 'platform.approval.approve' : 'platform.approval.reject',
    entityType: 'approval_request',
    entityId: r.id,
    dataClass: 'operational',
    detail: {
      process: input.process,
      step: r.stepIndex + 1,
      of: r.steps.length,
      escalated: j.escalated,
      outcome,
    },
  });
  return outcome;
}

export type ApprovalState = {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  step: number;
  steps: number;
  /** The current step's role key, or null when anyone with the permission decides. */
  stepRole: string | null;
  /** Its name, as the organisation calls the role. */
  stepRoleName: string | null;
  dueAt: string | null;
  overdue: boolean;
  /** The signed-in person may decide the current step now. */
  mine: boolean;
  history: {
    step: number;
    by: string;
    decision: 'approve' | 'reject';
    note: string | null;
    at: string;
  }[];
};

/** The latest request of each subject, for the owning module's screens. Call inside the tenant. */
export async function approvalStates(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
  process: ProcessKey,
  subjectIds: string[],
): Promise<Record<string, ApprovalState>> {
  if (subjectIds.length === 0) return {};
  const requests = await tx.execute<
    OpenRequest & { subjectId: string; status: ApprovalState['status'] }
  >(sql`
    select distinct on (r.subject_id) r.subject_id::text as "subjectId", r.status, r.id::text,
      r.institution_id::text as "institutionId", r.campus_id::text as "campusId",
      r.requested_by_person_id::text as "requestedBy", r.steps, r.step_index as "stepIndex",
      r.step_since::text as "stepSince",
      coalesce((select array_agg(d.decided_by_person_id::text) from approval_decision d
        where d.org_id = r.org_id and d.request_id = r.id), '{}') as "actedBy"
    from approval_request r
    where r.org_id = app_current_org() and r.process = ${process}
      and r.subject_id = any(${`{${subjectIds.join(',')}}`}::uuid[])
    order by r.subject_id, r.created_at desc`);
  const decisions = await tx.execute<{
    requestId: string;
    step: number;
    by: string;
    decision: 'approve' | 'reject';
    note: string | null;
    at: string;
  }>(sql`
    select request_id::text as "requestId", step_index + 1 as step, decided_by_person_id::text as by,
      decision, note, decided_at::text as at
    from approval_decision where org_id = app_current_org()
      and request_id = any(${`{${requests.map((r) => r.id).join(',')}}`}::uuid[])
    order by decided_at`);
  const names = await displayNames(
    tx,
    decisions.map((d) => d.by),
  );
  const roles = await rolesNow(tx, actor.personId);
  const roleNames = Object.fromEntries((await listRoles(tx)).map((r) => [r.key, r.name]));
  const out: Record<string, ApprovalState> = {};
  for (const r of requests) {
    const step = r.steps[r.stepIndex];
    const due = step && r.status === 'pending' ? overdueAt(step, new Date(r.stepSince)) : null;
    out[r.subjectId] = {
      requestId: r.id,
      status: r.status,
      step: r.stepIndex + 1,
      steps: r.steps.length,
      stepRole: step?.role ?? null,
      stepRoleName: step?.role ? (roleNames[step.role] ?? step.role) : null,
      dueAt: due?.toISOString() ?? null,
      overdue: !!due && due <= new Date(),
      mine: r.status === 'pending' && (await judge(tx, permissions, actor, process, r, roles)).ok,
      history: decisions
        .filter((d) => d.requestId === r.id)
        .map((d) => ({
          step: d.step,
          by: names[d.by] ?? '',
          decision: d.decision,
          note: d.note,
          at: d.at,
        })),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// My Work and the designer
// ---------------------------------------------------------------------------------------------

export type WorkItem = {
  requestId: string;
  process: ProcessKey;
  subjectId: string;
  institutionId: string;
  institution: string;
  summary: string;
  amountPaise: number | null;
  requestedBy: string;
  waitingSince: string;
  step: number;
  steps: number;
  dueAt: string | null;
  escalated: boolean;
};

/**
 * Everything waiting for the signed-in person's decision, oldest first, across every process.
 * ponytail: judges every pending request in the organisation; index by role if pending runs to thousands.
 */
export async function myWork(deps: WorkflowDeps, actor: Actor): Promise<WorkItem[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const rows = await tx.execute<
      OpenRequest & {
        process: string;
        subjectId: string;
        summary: string;
        amountPaise: number | null;
        institution: string;
        createdAt: string;
      }
    >(sql`
      select r.id::text, r.process, r.subject_id::text as "subjectId", r.summary,
        r.amount_paise::float as "amountPaise", i.name as institution, r.created_at::text as "createdAt",
        r.institution_id::text as "institutionId", r.campus_id::text as "campusId",
        r.requested_by_person_id::text as "requestedBy", r.steps, r.step_index as "stepIndex",
        r.step_since::text as "stepSince",
        coalesce((select array_agg(d.decided_by_person_id::text) from approval_decision d
          where d.org_id = r.org_id and d.request_id = r.id), '{}') as "actedBy"
      from approval_request r join institution i on i.org_id = r.org_id and i.id = r.institution_id
      where r.org_id = app_current_org() and r.status = 'pending'
      order by r.created_at`);
    const roles = await rolesNow(tx, actor.personId);
    const items: (WorkItem & { requester: string | null })[] = [];
    for (const r of rows) {
      if (!isProcess(r.process)) continue;
      const j = await judge(tx, deps.permissions, actor, r.process, r, roles);
      if (!j.ok) continue;
      const step = r.steps[r.stepIndex];
      items.push({
        requestId: r.id,
        process: r.process,
        subjectId: r.subjectId,
        institutionId: r.institutionId,
        institution: r.institution,
        summary: r.summary,
        amountPaise: r.amountPaise,
        requestedBy: '',
        requester: r.requestedBy,
        waitingSince: r.stepSince,
        step: r.stepIndex + 1,
        steps: r.steps.length,
        dueAt: step ? (overdueAt(step, new Date(r.stepSince))?.toISOString() ?? null) : null,
        escalated: j.escalated,
      });
    }
    const names = await displayNames(
      tx,
      items.flatMap((i) => (i.requester ? [i.requester] : [])),
    );
    return items.map(({ requester, ...i }) => ({
      ...i,
      requestedBy: requester ? (names[requester] ?? '') : '',
    }));
  });
}

export type ProcessPolicy = {
  process: ProcessKey;
  amounts: boolean;
  /** The process's permission, which decides when no steps are set. */
  permission: string;
  steps: PolicyStep[];
  /** For an institution: true when it follows the organisation's steps. */
  inherited: boolean;
};

/** Every process's steps for the organisation, or for one institution, with the roles to choose from. */
export async function approvalDesign(
  deps: WorkflowDeps,
  actor: Actor,
  institutionId: string | null,
): Promise<{ processes: ProcessPolicy[]; roles: { key: string; name: string }[] }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const place = institutionId ? await placeOf(tx, institutionId) : null;
    if (institutionId && !place) throw new ApprovalError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, MANAGE, {
      orgId: actor.orgId,
      ...(place ? { place } : {}),
    });
    const rows = await tx.execute<
      PolicyStep & { process: string; institutionId: string | null }
    >(sql`
      select process, institution_id::text as "institutionId", approver_role_key as role,
        min_amount_paise::float as "minAmountPaise", hours, escalate_role_key as "escalateTo"
      from approval_step where org_id = app_current_org()
        and (institution_id is null or institution_id = ${institutionId})
      order by process, position`);
    const strip = (s: PolicyStep & { process: string; institutionId: string | null }) => ({
      role: s.role,
      minAmountPaise: s.minAmountPaise,
      hours: s.hours,
      escalateTo: s.escalateTo,
    });
    const processes = (Object.keys(PROCESSES) as ProcessKey[]).map((p) => {
      const own = rows.filter((r) => r.process === p && r.institutionId === institutionId);
      const org = rows.filter((r) => r.process === p && r.institutionId === null);
      const inherited = !!institutionId && own.length === 0;
      return {
        process: p,
        amounts: PROCESSES[p].amounts,
        permission: PROCESSES[p].permission,
        steps: (inherited ? org : own).map(strip),
        inherited,
      };
    });
    const roles = (await listRoles(tx))
      .filter((r) => r.key !== 'parent')
      .map((r) => ({ key: r.key, name: r.name }));
    return { processes, roles };
  });
}

/**
 * Replaces a process's steps for the organisation, or for one institution (an empty list there
 * goes back to the organisation's). Requests already waiting keep the steps they started with.
 */
export async function saveApprovalSteps(
  deps: WorkflowDeps,
  actor: Actor,
  input: { process: string; institutionId: string | null; steps: PolicyStep[] },
): Promise<void> {
  if (!isProcess(input.process)) throw new ApprovalError('unknown_process');
  const process = input.process;
  if (input.steps.length > 6) throw new ApprovalError('steps_invalid');
  if (!PROCESSES[process].amounts && input.steps.some((s) => s.minAmountPaise !== null))
    throw new ApprovalError('amounts_not_used');
  if (input.steps.some((s) => (s.hours === null) !== (s.escalateTo === null)))
    throw new ApprovalError('steps_invalid');
  const place = await withTenant(deps.db, actor.orgId, (tx) =>
    input.institutionId ? placeOf(tx, input.institutionId) : Promise.resolve(null),
  );
  if (input.institutionId && !place) throw new ApprovalError('institution_not_found');
  // A role that doesn't exist here fails the foreign key: refuse it plainly.
  const unknownRole = (err: unknown) => {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.cause?.code ?? e.code) === '23503') throw new ApprovalError('steps_invalid');
    throw err;
  };
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: MANAGE, resource: { orgId: actor.orgId, ...(place ? { place } : {}) } },
    async (tx) => {
      await tx.execute(sql`
        delete from approval_step where org_id = app_current_org() and process = ${process}
          and institution_id is not distinct from ${input.institutionId}::uuid`);
      for (const [i, s] of input.steps.entries())
        await tx.execute(sql`
          insert into approval_step (org_id, process, institution_id, position, approver_role_key,
            min_amount_paise, hours, escalate_role_key)
          values (app_current_org(), ${process}, ${input.institutionId}, ${i + 1}, ${s.role},
            ${s.minAmountPaise}, ${s.hours}, ${s.escalateTo})`);
      return {
        result: undefined,
        audit: {
          action: 'platform.workflow.save',
          entityType: 'approval_step',
          entityId: input.institutionId ?? actor.orgId,
          dataClass: 'operational',
          detail: {
            process,
            steps: input.steps
              .map(
                (s) =>
                  `${s.role}${s.minAmountPaise !== null ? `≥${s.minAmountPaise}` : ''}${s.hours ? `/${s.hours}h→${s.escalateTo}` : ''}`,
              )
              .join(', '),
          },
        },
      };
    },
  ).catch(unknownRole);
}
