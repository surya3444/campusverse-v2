// The helpdesk (docs/specs/HELPDESK.md): requests from staff and from parents about their child,
// routed by category with a time to answer; threads with internal notes; assignment and states;
// overdue first. Names through people/records, a child's school and class through
// AcademicPlacementPort.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, memberKind, type AcademicPlacementPort } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
  type Resource,
} from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { afterReply, dueAt, isOverdue, type Priority, type State } from '../domain/helpdesk.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements'>[];
export type HelpdeskDeps = { db: Db; permissions: Permissions; placements: Placements };

export const TICKET_RAISED = 'helpdesk.ticket.raised.v1';
export const TICKET_REPLIED = 'helpdesk.ticket.replied.v1';
export const TICKET_RESOLVED = 'helpdesk.ticket.resolved.v1';
export const TICKET_ASSIGNED = 'helpdesk.ticket.assigned.v1';

export const DEFAULT_CATEGORIES: [string, number, 'parents' | 'staff' | 'both'][] = [
  ['Fees and payments', 24, 'both'],
  ['Transport', 8, 'both'],
  ['Academics and homework', 48, 'both'],
  ['Facilities and repairs', 72, 'staff'],
  ['IT and logins', 24, 'both'],
  ['Other', 48, 'both'],
];

export class HelpdeskError extends Error {
  constructor(
    readonly code:
      | 'institution_not_found'
      | 'category_not_found'
      | 'category_exists'
      | 'not_for_you'
      | 'not_a_student'
      | 'ticket_not_found'
      | 'not_staff'
      | 'closed'
      | 'internal_not_allowed',
  ) {
    super(`helpdesk: ${code}`);
    this.name = 'HelpdeskError';
  }
}

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';
async function place(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new HelpdeskError('institution_not_found');
  return p;
}
const res = (actor: Actor, p: Resource['place'] | null, subjectPersonId?: string): Resource => ({
  orgId: actor.orgId,
  ...(p ? { place: p } : {}),
  ...(subjectPersonId ? { subjectPersonId } : {}),
});
const handles = async (deps: HelpdeskDeps, tx: Tx, actor: Actor, institutionId: string) =>
  (
    await deps.permissions.can(
      tx,
      actor,
      'helpdesk.ticket.handle',
      res(actor, await place(tx, institutionId)),
    )
  ).allowed;

/** The default categories for a new organisation. Safe to repeat. */
export async function installHelpdeskCategories(tx: Tx): Promise<void> {
  for (const [name, hours, audience] of DEFAULT_CATEGORIES)
    await tx.execute(sql`
      insert into helpdesk_category (org_id, name, hours, audience)
      values (app_current_org(), ${name}, ${hours}, ${audience}) on conflict do nothing`);
}

// ---------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------

export type Category = {
  id: string;
  name: string;
  hours: number;
  assigneePersonId: string | null;
  assignee: string | null;
  audience: 'parents' | 'staff' | 'both';
  active: boolean;
};

/** Every category, for anyone signed in to this organisation (the form filters by audience). */
export async function helpdeskCategories(deps: HelpdeskDeps, actor: Actor): Promise<Category[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const rows = await tx.execute<Omit<Category, 'assignee'>>(sql`
      select id::text, name, hours, assignee_person_id::text as "assigneePersonId", audience, active
      from helpdesk_category where org_id = app_current_org() order by active desc, name`);
    const names = await displayNames(
      tx,
      rows.flatMap((r) => (r.assigneePersonId ? [r.assigneePersonId] : [])),
    );
    return rows.map((r) => ({
      ...r,
      assignee: r.assigneePersonId ? (names[r.assigneePersonId] ?? null) : null,
    }));
  });
}

export async function saveCategory(
  deps: HelpdeskDeps,
  actor: Actor,
  input: {
    institutionId: string;
    id: string | null;
    name: string;
    hours: number;
    assigneePersonId: string | null;
    audience: 'parents' | 'staff' | 'both';
    active: boolean;
  },
): Promise<{ id: string }> {
  const resource = await withTenant(deps.db, actor.orgId, async (tx) =>
    res(actor, await place(tx, input.institutionId)),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'helpdesk.setup.manage', resource },
    async (tx) => {
      const name = input.name.trim();
      const [same] = await tx.execute<{ id: string }>(sql`
        select id::text from helpdesk_category where org_id = app_current_org() and lower(btrim(name)) = lower(${name})`);
      if (same && same.id !== input.id) throw new HelpdeskError('category_exists');
      if (input.assigneePersonId) {
        const kind = await memberKind(tx, {
          institutionId: input.institutionId,
          personId: input.assigneePersonId,
          onDate: await today(tx),
        });
        if (kind !== 'staff') throw new HelpdeskError('not_staff');
      }
      let id = input.id;
      if (id) {
        const done = await tx.execute(sql`
          update helpdesk_category set name = ${name}, hours = ${input.hours},
            assignee_person_id = ${input.assigneePersonId}, audience = ${input.audience}, active = ${input.active}
          where org_id = app_current_org() and id = ${id} returning id`);
        if (done.length === 0) throw new HelpdeskError('category_not_found');
      } else {
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into helpdesk_category (org_id, name, hours, assignee_person_id, audience, active)
          values (app_current_org(), ${name}, ${input.hours}, ${input.assigneePersonId}, ${input.audience}, ${input.active})
          returning id::text`);
        id = row?.id ?? '';
      }
      return {
        result: { id },
        audit: {
          action: 'helpdesk.category.save',
          entityType: 'helpdesk_category',
          entityId: id,
          dataClass: 'operational',
          detail: { name, hours: input.hours, audience: input.audience, active: input.active },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Raising a request
// ---------------------------------------------------------------------------------------------

export type RaiseInput = {
  /** Staff: their school. Parents leave it out and give the child. */
  institutionId: string | null;
  /** Parents: which child it is about. */
  studentId: string | null;
  categoryId: string;
  subject: string;
  body: string;
  priority: Priority;
};

/** A staff member raises a request for themselves, or a parent about their own child. */
export async function raiseTicket(
  deps: HelpdeskDeps,
  actor: Actor,
  input: RaiseInput,
): Promise<{ ticketId: string; number: number }> {
  const { institutionId, resource, byParent } = await withTenant(
    deps.db,
    actor.orgId,
    async (tx) => {
      if (input.studentId) {
        const on = await today(tx);
        const found = (
          await Promise.all(
            deps.placements.map((p) =>
              p.getPlacements(tx, { personIds: [input.studentId ?? ''], onDate: on }),
            ),
          )
        )
          .map((m) => m.get(input.studentId ?? ''))
          .find((x) => x !== undefined);
        if (!found) throw new HelpdeskError('not_a_student');
        return {
          institutionId: found.institutionId,
          resource: res(actor, await place(tx, found.institutionId), input.studentId),
          byParent: true,
        };
      }
      if (!input.institutionId) throw new HelpdeskError('institution_not_found');
      return {
        institutionId: input.institutionId,
        resource: res(actor, await place(tx, input.institutionId), actor.personId),
        byParent: false,
      };
    },
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'helpdesk.ticket.raise', resource },
    async (tx) => {
      const [c] = await tx.execute<{
        hours: number;
        assignee: string | null;
        audience: string;
        active: boolean;
      }>(sql`
        select hours, assignee_person_id::text as assignee, audience, active from helpdesk_category
        where org_id = app_current_org() and id = ${input.categoryId}`);
      if (!c || !c.active) throw new HelpdeskError('category_not_found');
      if ((byParent && c.audience === 'staff') || (!byParent && c.audience === 'parents'))
        throw new HelpdeskError('not_for_you');
      await tx.execute(sql`
        insert into helpdesk_counter (org_id, institution_id) values (app_current_org(), ${institutionId})
        on conflict do nothing`);
      const [n] = await tx.execute<{ n: number }>(sql`
        update helpdesk_counter set next_number = next_number + 1
        where org_id = app_current_org() and institution_id = ${institutionId}
        returning next_number - 1 as n`);
      const number = n?.n ?? 1;
      const due = new Date(dueAt(Date.now(), c.hours, input.priority)).toISOString();
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into helpdesk_ticket (org_id, institution_id, number, category_id, raised_by_person_id,
          student_person_id, subject, priority, assignee_person_id, due_at)
        values (app_current_org(), ${institutionId}, ${number}, ${input.categoryId}, ${actor.personId},
          ${input.studentId}, ${input.subject.trim()}, ${input.priority}, ${c.assignee}, ${due}::timestamptz)
        returning id::text`);
      const ticketId = row?.id ?? '';
      await tx.execute(sql`
        insert into helpdesk_message (org_id, ticket_id, author_person_id, body)
        values (app_current_org(), ${ticketId}, ${actor.personId}, ${input.body.trim()})`);
      return {
        result: { ticketId, number },
        audit: {
          action: 'helpdesk.ticket.raise',
          entityType: 'helpdesk_ticket',
          entityId: ticketId,
          dataClass: 'personal',
          detail: { number, categoryId: input.categoryId, priority: input.priority, byParent },
        },
        events: [{ type: TICKET_RAISED, payload: { ticketId } }],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Reading requests
// ---------------------------------------------------------------------------------------------

export type TicketRow = {
  ticketId: string;
  number: number;
  institutionId: string;
  category: string;
  subject: string;
  priority: Priority;
  state: State;
  raisedById: string;
  raisedBy: string | null;
  student: string | null;
  studentLabel: string | null;
  assigneeId: string | null;
  assignee: string | null;
  dueAt: string;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

async function ticketRows(
  tx: Tx,
  deps: HelpdeskDeps,
  filter: ReturnType<typeof sql>,
): Promise<TicketRow[]> {
  const rows = await tx.execute<
    Omit<TicketRow, 'raisedBy' | 'student' | 'studentLabel' | 'assignee' | 'overdue'> & {
      studentId: string | null;
    }
  >(sql`
    select t.id::text as "ticketId", t.number, t.institution_id::text as "institutionId", c.name as category,
      t.subject, t.priority, t.state, t.raised_by_person_id::text as "raisedById",
      t.student_person_id::text as "studentId", t.assignee_person_id::text as "assigneeId",
      t.due_at as "dueAt", t.created_at as "createdAt", t.updated_at as "updatedAt", t.resolved_at as "resolvedAt"
    from helpdesk_ticket t join helpdesk_category c on c.org_id = t.org_id and c.id = t.category_id
    where t.org_id = app_current_org() and ${filter}
    order by (t.state <> 'resolved' and t.due_at < now()) desc, t.state = 'resolved', t.due_at
    limit 300`);
  const names = await displayNames(
    tx,
    rows.flatMap((r) => [r.raisedById, r.studentId, r.assigneeId].filter((x): x is string => !!x)),
  );
  const on = await today(tx);
  const students = rows.flatMap((r) => (r.studentId ? [r.studentId] : []));
  const placed = students.length
    ? await Promise.all(
        deps.placements.map((p) => p.getPlacements(tx, { personIds: students, onDate: on })),
      )
    : [];
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  return rows.map(({ studentId, ...r }) => ({
    ...r,
    raisedBy: names[r.raisedById] ?? null,
    student: studentId ? (names[studentId] ?? null) : null,
    studentLabel: studentId
      ? (placed.map((m) => m.get(studentId)).find((x) => x !== undefined)?.displayLabel ?? null)
      : null,
    assignee: r.assigneeId ? (names[r.assigneeId] ?? null) : null,
    dueAt: new Date(r.dueAt).toISOString(),
    overdue: isOverdue(r.state, new Date(r.dueAt).getTime(), Date.now()),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    resolvedAt: iso(r.resolvedAt),
  }));
}

const VIEWS = {
  open: sql`t.state <> 'resolved'`,
  overdue: sql`t.state <> 'resolved' and t.due_at < now()`,
  waiting: sql`t.state = 'waiting'`,
  resolved: sql`t.state = 'resolved' and t.resolved_at > now() - interval '30 days'`,
} as const;
export type QueueView = keyof typeof VIEWS | 'mine' | 'raised';

/**
 * A school's requests for people who handle them; "mine" (assigned to me) and "raised" (my own)
 * for anyone.
 */
export async function tickets(
  deps: HelpdeskDeps,
  actor: Actor,
  input: { institutionId: string; view: QueueView },
): Promise<TicketRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const inst = sql`t.institution_id = ${input.institutionId}`;
    if (input.view === 'mine')
      return ticketRows(
        tx,
        deps,
        sql`${inst} and t.assignee_person_id = ${actor.personId} and t.state <> 'resolved'`,
      );
    if (input.view === 'raised')
      return ticketRows(tx, deps, sql`t.raised_by_person_id = ${actor.personId}`);
    if (!(await handles(deps, tx, actor, input.institutionId)))
      throw new PermissionDenied('helpdesk.ticket.handle', 'no_grant');
    return ticketRows(tx, deps, sql`${inst} and ${VIEWS[input.view]}`);
  });
}

/**
 * Requests about one person, for their record: raised about a student, or raised by or assigned
 * to a staff member. Only for people who handle the school's requests.
 */
export async function ticketsAbout(
  deps: HelpdeskDeps,
  actor: Actor,
  input: { institutionId: string; personId: string },
): Promise<TicketRow[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    if (!(await handles(deps, tx, actor, input.institutionId)))
      throw new PermissionDenied('helpdesk.ticket.handle', 'no_grant');
    return ticketRows(
      tx,
      deps,
      sql`t.institution_id = ${input.institutionId} and (t.student_person_id = ${input.personId}
        or t.raised_by_person_id = ${input.personId} or t.assignee_person_id = ${input.personId})`,
    );
  });
}

/** A person's own requests, at any school: what parents see in the app. */
export async function myRequests(deps: HelpdeskDeps, actor: Actor): Promise<TicketRow[]> {
  return withTenant(deps.db, actor.orgId, (tx) =>
    ticketRows(tx, deps, sql`t.raised_by_person_id = ${actor.personId}`),
  );
}

export type TicketMessage = {
  messageId: string;
  author: string | null;
  authorId: string;
  body: string;
  internal: boolean;
  at: string;
};

type Access = { row: TicketRow; staffSide: boolean; isRaiser: boolean; isAssignee: boolean };

async function access(deps: HelpdeskDeps, tx: Tx, actor: Actor, ticketId: string): Promise<Access> {
  const [row] = await ticketRows(tx, deps, sql`t.id = ${ticketId}`);
  if (!row) throw new HelpdeskError('ticket_not_found');
  const isRaiser = row.raisedById === actor.personId;
  const isAssignee = row.assigneeId === actor.personId;
  const handler = await handles(deps, tx, actor, row.institutionId);
  if (!isRaiser && !isAssignee && !handler) throw new HelpdeskError('ticket_not_found');
  return { row, staffSide: handler || isAssignee, isRaiser, isAssignee };
}

/** One request with its thread; internal notes only for the people working it. */
export async function ticket(
  deps: HelpdeskDeps,
  actor: Actor,
  ticketId: string,
): Promise<TicketRow & { messages: TicketMessage[]; canWork: boolean }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const a = await access(deps, tx, actor, ticketId);
    const msgs = await tx.execute<Omit<TicketMessage, 'author'>>(sql`
      select id::text as "messageId", author_person_id::text as "authorId", body, internal, created_at as at
      from helpdesk_message where org_id = app_current_org() and ticket_id = ${ticketId}
        and (${a.staffSide} or not internal)
      order by created_at`);
    const names = await displayNames(
      tx,
      msgs.map((m) => m.authorId),
    );
    return {
      ...a.row,
      canWork: a.staffSide,
      messages: msgs.map((m) => ({
        ...m,
        author: names[m.authorId] ?? null,
        at: new Date(m.at).toISOString(),
      })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Working a request
// ---------------------------------------------------------------------------------------------

/** The permission a step runs under: handlers under handle; the requester or assignee under raise (self). */
async function stepCheck(deps: HelpdeskDeps, actor: Actor, ticketId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const a = await access(deps, tx, actor, ticketId);
    const p = await place(tx, a.row.institutionId);
    const handler = await handles(deps, tx, actor, a.row.institutionId);
    // A parent's own request is checked against their child below (stepCheckWithStudent).
    const check = handler
      ? { permission: 'helpdesk.ticket.handle', resource: res(actor, p) }
      : { permission: 'helpdesk.ticket.raise', resource: res(actor, p, actor.personId) };
    return { a, check };
  });
}

/** Replies to a request: the requester publicly; people working it publicly or as an internal note. */
export async function replyTicket(
  deps: HelpdeskDeps,
  actor: Actor,
  input: { ticketId: string; body: string; internal: boolean; state?: State | null | undefined },
): Promise<{ state: State }> {
  const { a, check } = await stepCheckWithStudent(deps, actor, input.ticketId);
  return command(deps.db, deps.permissions, actor, check, async (tx) => {
    if (input.internal && !a.staffSide) throw new HelpdeskError('internal_not_allowed');
    const [t] = await tx.execute<{ state: State; resolvedAt: string | null }>(sql`
      select state, resolved_at as "resolvedAt" from helpdesk_ticket
      where org_id = app_current_org() and id = ${input.ticketId} for update`);
    if (!t) throw new HelpdeskError('ticket_not_found');
    const moved = afterReply({
      state: t.state,
      byRequester: a.isRaiser && !a.staffSide,
      internal: input.internal,
      resolvedAt: t.resolvedAt ? new Date(t.resolvedAt).getTime() : null,
      now: Date.now(),
    });
    if (moved === 'closed') throw new HelpdeskError('closed');
    const next: State = a.staffSide && input.state ? input.state : moved;
    await tx.execute(sql`
      insert into helpdesk_message (org_id, ticket_id, author_person_id, body, internal)
      values (app_current_org(), ${input.ticketId}, ${actor.personId}, ${input.body.trim()}, ${input.internal})`);
    await tx.execute(sql`
      update helpdesk_ticket set state = ${next}, updated_at = now(),
        resolved_at = case when ${next} = 'resolved' then coalesce(resolved_at, now()) else null end
      where org_id = app_current_org() and id = ${input.ticketId}`);
    const events = [];
    if (!input.internal)
      events.push({
        type: TICKET_REPLIED,
        payload: { ticketId: input.ticketId, byRequester: a.isRaiser && !a.staffSide },
      });
    if (next === 'resolved' && t.state !== 'resolved')
      events.push({ type: TICKET_RESOLVED, payload: { ticketId: input.ticketId } });
    return {
      result: { state: next },
      audit: {
        action: input.internal ? 'helpdesk.ticket.note' : 'helpdesk.ticket.reply',
        entityType: 'helpdesk_ticket',
        entityId: input.ticketId,
        dataClass: 'personal',
        detail: { from: t.state, to: next },
      },
      events,
    };
  });
}

async function stepCheckWithStudent(deps: HelpdeskDeps, actor: Actor, ticketId: string) {
  const s = await stepCheck(deps, actor, ticketId);
  if (s.check.permission === 'helpdesk.ticket.raise' && s.a.isRaiser) {
    const studentId = await withTenant(deps.db, actor.orgId, async (tx) => {
      const [r] = await tx.execute<{ id: string | null }>(sql`
        select student_person_id::text as id from helpdesk_ticket where org_id = app_current_org() and id = ${ticketId}`);
      return r?.id ?? null;
    });
    if (studentId) s.check.resource = { ...s.check.resource, subjectPersonId: studentId };
  }
  return s;
}

/** Changes the state without a message (take it, ask, resolve): the people working it. */
export async function setTicketState(
  deps: HelpdeskDeps,
  actor: Actor,
  input: { ticketId: string; state: State },
): Promise<void> {
  const { a, check } = await stepCheck(deps, actor, input.ticketId);
  if (!a.staffSide) throw new PermissionDenied('helpdesk.ticket.handle', 'no_grant');
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    const [t] = await tx.execute<{ state: State }>(sql`
      select state from helpdesk_ticket where org_id = app_current_org() and id = ${input.ticketId} for update`);
    if (!t) throw new HelpdeskError('ticket_not_found');
    await tx.execute(sql`
      update helpdesk_ticket set state = ${input.state}, updated_at = now(),
        resolved_at = case when ${input.state} = 'resolved' then coalesce(resolved_at, now()) else null end
      where org_id = app_current_org() and id = ${input.ticketId}`);
    return {
      result: undefined,
      audit: {
        action: 'helpdesk.ticket.state',
        entityType: 'helpdesk_ticket',
        entityId: input.ticketId,
        dataClass: 'operational',
        detail: { from: t.state, to: input.state },
      },
      events:
        input.state === 'resolved' && t.state !== 'resolved'
          ? [{ type: TICKET_RESOLVED, payload: { ticketId: input.ticketId } }]
          : [],
    };
  });
}

/** Gives a request to a staff member of the school (or nobody): people who handle requests. */
export async function assignTicket(
  deps: HelpdeskDeps,
  actor: Actor,
  input: { ticketId: string; personId: string | null },
): Promise<void> {
  const { a } = await stepCheck(deps, actor, input.ticketId);
  const resource = await withTenant(deps.db, actor.orgId, async (tx) =>
    res(actor, await place(tx, a.row.institutionId)),
  );
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'helpdesk.ticket.handle', resource },
    async (tx) => {
      if (input.personId) {
        const kind = await memberKind(tx, {
          institutionId: a.row.institutionId,
          personId: input.personId,
          onDate: await today(tx),
        });
        if (kind !== 'staff') throw new HelpdeskError('not_staff');
      }
      await tx.execute(sql`
        update helpdesk_ticket set assignee_person_id = ${input.personId}, updated_at = now()
        where org_id = app_current_org() and id = ${input.ticketId}`);
      return {
        result: undefined,
        audit: {
          action: 'helpdesk.ticket.assign',
          entityType: 'helpdesk_ticket',
          entityId: input.ticketId,
          dataClass: 'operational',
          detail: { personId: input.personId },
        },
        events: input.personId
          ? [
              {
                type: TICKET_ASSIGNED,
                payload: { ticketId: input.ticketId, personId: input.personId },
              },
            ]
          : [],
      };
    },
  );
}

export type HelpdeskFigures = {
  open: number;
  overdue: number;
  waiting: number;
  resolvedWeek: number;
};

export async function helpdeskFigures(
  deps: HelpdeskDeps,
  actor: Actor,
  institutionId: string,
): Promise<
  HelpdeskFigures & { byCategory: { category: string; open: number; overdue: number }[] }
> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    if (!(await handles(deps, tx, actor, institutionId)))
      throw new PermissionDenied('helpdesk.ticket.handle', 'no_grant');
    const [f] = await tx.execute<HelpdeskFigures>(sql`
      select count(*) filter (where state <> 'resolved')::int as open,
        count(*) filter (where state <> 'resolved' and due_at < now())::int as overdue,
        count(*) filter (where state = 'waiting')::int as waiting,
        count(*) filter (where state = 'resolved' and resolved_at > now() - interval '7 days')::int as "resolvedWeek"
      from helpdesk_ticket where org_id = app_current_org() and institution_id = ${institutionId}`);
    const byCategory = await tx.execute<{ category: string; open: number; overdue: number }>(sql`
      select c.name as category, count(*) filter (where t.state <> 'resolved')::int as open,
        count(*) filter (where t.state <> 'resolved' and t.due_at < now())::int as overdue
      from helpdesk_ticket t join helpdesk_category c on c.org_id = t.org_id and c.id = t.category_id
      where t.org_id = app_current_org() and t.institution_id = ${institutionId}
      group by c.name having count(*) filter (where t.state <> 'resolved') > 0 order by c.name`);
    return {
      ...(f ?? { open: 0, overdue: 0, waiting: 0, resolvedWeek: 0 }),
      byCategory: [...byCategory],
    };
  });
}
