// Riders (Milestone 18 step 2): who rides which route from which stop, dated like enrolment, so a
// change keeps the history. Transport assigns person ids; labels such as "Class 5-A" come from the
// academic placement port, so school and college students can share a bus.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { displayNames, type AcademicPlacementPort } from '@campusverse/people-records';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { TransportError } from './setup.js';

type Permissions = ReturnType<typeof createPermissions>;
type Placements = Pick<AcademicPlacementPort, 'getPlacements' | 'findByReference'>[];

export const TRANSPORT_ASSIGNMENT_CHANGED = 'transport.assignment.changed.v1';

/**
 * Bills a new rider on every published fee plan that covers them (finance's billStudent, passed in
 * by the API so transport never imports finance). Runs inside the assignment's own transaction.
 * `asOf` is the rider's first day: instalments due before it are not billed.
 */
export type BillRider = (
  tx: Tx,
  input: { studentId: string; institutionId: string; actorId: string; asOf: string },
) => Promise<{ invoices: number; totalPaise: number }>;

async function billRider(
  tx: Tx,
  bill: BillRider | undefined,
  placements: Placements,
  actor: Actor,
  input: { personId: string; from: string; institutionId: string },
) {
  if (!bill) return { invoices: 0, totalPaise: 0 };
  const d = await today(tx);
  const asOf = input.from > d ? input.from : d;
  const placed = await lookup(tx, placements, [input.personId], asOf);
  return bill(tx, {
    studentId: input.personId,
    institutionId: placed.get(input.personId)?.institutionId ?? input.institutionId,
    actorId: actor.personId,
    asOf,
  });
}

export type Rider = {
  assignmentId: string;
  personId: string;
  name: string;
  /** "Class 5-A" from the person's institution; null when they have no placement that day. */
  label: string | null;
  reference: string | null;
  routeId: string;
  direction: 'pickup' | 'drop';
  stopId: string;
  from: string;
  until: string | null;
};

async function campusOf(tx: Tx, institutionId: string) {
  const p = await placeOf(tx, institutionId);
  if (!p) throw new TransportError('institution_not_found');
  return p;
}

async function today(tx: Tx): Promise<string> {
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return r?.d ?? '';
}

async function lookup(tx: Tx, placements: Placements, personIds: string[], onDate: string) {
  const found = new Map<
    string,
    { displayLabel: string; reference: string | null; institutionId: string }
  >();
  if (personIds.length === 0) return found;
  for (const p of placements)
    for (const [id, v] of await p.getPlacements(tx, { personIds, onDate }))
      found.set(id, {
        displayLabel: v.displayLabel,
        reference: v.reference ?? null,
        institutionId: v.institutionId,
      });
  return found;
}

/** Everyone riding a route on this campus on the date (today by default). */
export async function listRiders(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  institutionId: string,
  onDate?: string,
): Promise<Rider[]> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await campusOf(tx, institutionId);
    await permissions.assertCan(tx, actor, 'transport.trip.read', {
      orgId: actor.orgId,
      place: where,
    });
    const d = onDate ?? (await today(tx));
    const rows = await tx.execute<Omit<Rider, 'name' | 'label' | 'reference'>>(sql`
      select a.id::text as "assignmentId", a.person_id::text as "personId", a.route_id::text as "routeId",
        a.direction, a.stop_id::text as "stopId", lower(a.valid_during)::text as "from",
        (upper(a.valid_during) - 1)::text as until
      from transport_assignment a join transport_route r on r.org_id = a.org_id and r.id = a.route_id
      where a.org_id = app_current_org() and r.campus_id = ${where.campusId}
        and a.valid_during @> ${d}::date`);
    const ids = [...new Set(rows.map((r) => r.personId))];
    const names = await displayNames(tx, ids);
    const placed = await lookup(tx, placements, ids, d);
    return rows
      .map((r) => ({
        ...r,
        name: names[r.personId] ?? '',
        label: placed.get(r.personId)?.displayLabel ?? null,
        reference: placed.get(r.personId)?.reference ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

type Assign = { personId: string; routeId: string; stopId: string; from: string };

/** Checks one assignment against the campus's routes and the person's placement. */
async function check(
  tx: Tx,
  placements: Placements,
  campusId: string,
  a: Assign,
): Promise<{ direction: 'pickup' | 'drop' }> {
  const [route] = await tx.execute<{ direction: 'pickup' | 'drop'; active: boolean }>(sql`
    select direction, active from transport_route
    where org_id = app_current_org() and id = ${a.routeId} and campus_id = ${campusId}`);
  if (!route || !route.active) throw new TransportError('route_not_found');
  const [onRoute] = await tx.execute(sql`
    select 1 from transport_route_stop
    where org_id = app_current_org() and route_id = ${a.routeId} and stop_id = ${a.stopId}`);
  if (!onRoute) throw new TransportError('stop_not_on_route');
  const placed = (await lookup(tx, placements, [a.personId], a.from)).get(a.personId);
  if (!placed) throw new TransportError('not_a_student');
  const [same] = await tx.execute(sql`
    select 1 from institution where org_id = app_current_org() and id = ${placed.institutionId}
      and campus_id = ${campusId}`);
  if (!same) throw new TransportError('not_a_student');
  return { direction: route.direction };
}

/** Ends what the person rode in that direction from `from` on, and starts the new assignment. */
async function write(tx: Tx, actor: Actor, a: Assign, direction: string, batch: string | null) {
  // Started before: ends the day before. Starting on or after: never happens.
  await tx.execute(sql`
    update transport_assignment
    set valid_during = case when lower(valid_during) < ${a.from}::date
      then daterange(lower(valid_during), ${a.from}::date) else 'empty'::daterange end
    where org_id = app_current_org() and person_id = ${a.personId} and direction = ${direction}
      and valid_during && daterange(${a.from}::date, null)`);
  const [row] = await tx.execute<{ id: string }>(sql`
    insert into transport_assignment (org_id, person_id, route_id, direction, stop_id, valid_during,
      import_batch_id, created_by_person_id)
    values (app_current_org(), ${a.personId}, ${a.routeId}, ${direction}, ${a.stopId},
      daterange(${a.from}::date, null), ${batch}, ${actor.personId})
    returning id::text`);
  return row?.id ?? '';
}

/** Puts a student on a route from a stop, from a date. Any earlier route that way ends the day before. */
export async function assignRider(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: Assign & { institutionId: string },
  bill?: BillRider,
): Promise<{ id: string; invoices: number; totalPaise: number }> {
  const where = await withTenant(db, actor.orgId, (tx) => campusOf(tx, input.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.assignment.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const { direction } = await check(tx, placements, where.campusId, input);
      const id = await write(tx, actor, input, direction, null);
      const billed = await billRider(tx, bill, placements, actor, input);
      return {
        result: { id, ...billed },
        audit: {
          action: 'transport.assignment.create',
          entityType: 'person',
          entityId: input.personId,
          dataClass: 'personal',
          detail: {
            routeId: input.routeId,
            stopId: input.stopId,
            from: input.from,
            direction,
            invoices: billed.invoices,
          },
        },
        events: [
          {
            type: TRANSPORT_ASSIGNMENT_CHANGED,
            payload: { personId: input.personId, routeId: input.routeId, from: input.from },
          },
        ],
      };
    },
  );
}

/** Takes a student off a route after `lastDay` (inclusive); one not yet started never happens. */
export async function endRider(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  input: { institutionId: string; assignmentId: string; lastDay: string },
): Promise<void> {
  const where = await withTenant(db, actor.orgId, (tx) => campusOf(tx, input.institutionId));
  await command(
    db,
    permissions,
    actor,
    { permission: 'transport.assignment.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const [a] = await tx.execute<{ personId: string; routeId: string }>(sql`
        update transport_assignment a
        set valid_during = case when ${input.lastDay}::date < lower(a.valid_during) then 'empty'::daterange
          else daterange(lower(a.valid_during), ${input.lastDay}::date + 1) end
        from transport_route r
        where a.org_id = app_current_org() and a.id = ${input.assignmentId}
          and r.org_id = a.org_id and r.id = a.route_id and r.campus_id = ${where.campusId}
          and (upper_inf(a.valid_during) or upper(a.valid_during) > ${input.lastDay}::date + 1)
        returning a.person_id::text as "personId", a.route_id::text as "routeId"`);
      if (!a) throw new TransportError('assignment_not_found');
      return {
        result: undefined,
        audit: {
          action: 'transport.assignment.end',
          entityType: 'person',
          entityId: a.personId,
          dataClass: 'personal',
          detail: { routeId: a.routeId, lastDay: input.lastDay },
        },
        events: [
          {
            type: TRANSPORT_ASSIGNMENT_CHANGED,
            payload: { personId: a.personId, routeId: a.routeId, until: input.lastDay },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Bulk import: preview, then commit (the rows that previewed clean).
// ---------------------------------------------------------------------------------------------

export type ImportRow = {
  reference: string;
  route: string;
  direction: 'pickup' | 'drop';
  stop: string;
};
export type ImportProblem =
  'student_not_found' | 'student_ambiguous' | 'route_not_found' | 'stop_not_on_route' | 'repeated';
export type ImportLine = {
  row: number;
  reference: string;
  personId: string | null;
  name: string | null;
  label: string | null;
  routeId: string | null;
  stopId: string | null;
  problem: ImportProblem | null;
  /** Already riding this route from this stop: nothing changes. */
  unchanged: boolean;
};
export type ImportPlan = {
  lines: ImportLine[];
  ready: number;
  problems: number;
  /** Routes whose riders would exceed the usual vehicle's seats after the import. */
  overCapacity: { routeId: string; name: string; riders: number; seats: number }[];
};

async function planImport(
  tx: Tx,
  placements: Placements,
  institutionId: string,
  campusId: string,
  rows: ImportRow[],
  from: string,
): Promise<ImportPlan> {
  const routes = await tx.execute<{
    id: string;
    name: string;
    direction: string;
    seats: number | null;
  }>(sql`
    select r.id::text, r.name, r.direction, v.seats from transport_route r
    left join transport_vehicle v on v.org_id = r.org_id and v.id = r.vehicle_id
    where r.org_id = app_current_org() and r.campus_id = ${campusId} and r.active`);
  const stops = await tx.execute<{ routeId: string; stopId: string; name: string }>(sql`
    select rs.route_id::text as "routeId", rs.stop_id::text as "stopId", s.name
    from transport_route_stop rs join transport_stop s on s.org_id = rs.org_id and s.id = rs.stop_id
    join transport_route r on r.org_id = rs.org_id and r.id = rs.route_id
    where rs.org_id = app_current_org() and r.campus_id = ${campusId}`);
  const current = new Set(
    (
      await tx.execute<{ k: string }>(sql`
        select person_id::text || ':' || route_id::text || ':' || stop_id::text as k
        from transport_assignment where org_id = app_current_org() and valid_during @> ${from}::date`)
    ).map((r) => r.k),
  );
  const norm = (x: string) => x.trim().toLowerCase();
  const seen = new Set<string>();
  const lines: ImportLine[] = [];
  for (const [i, r] of rows.entries()) {
    const line: ImportLine = {
      row: i + 1,
      reference: r.reference.trim(),
      personId: null,
      name: null,
      label: null,
      routeId: null,
      stopId: null,
      problem: null,
      unchanged: false,
    };
    lines.push(line);
    const candidates = new Set<string>();
    for (const p of placements)
      for (const id of await p.findByReference(tx, { institutionId, text: line.reference }))
        candidates.add(id);
    const placed = await lookup(tx, placements, [...candidates], from);
    const exact = [...placed].filter(([, v]) => norm(v.reference ?? '') === norm(line.reference));
    if (exact.length !== 1) {
      line.problem = exact.length ? 'student_ambiguous' : 'student_not_found';
      continue;
    }
    const [personId, info] = exact[0] ?? ['', null];
    line.personId = personId;
    line.label = info?.displayLabel ?? null;
    const route = routes.find((x) => norm(x.name) === norm(r.route) && x.direction === r.direction);
    if (!route) {
      line.problem = 'route_not_found';
      continue;
    }
    line.routeId = route.id;
    const stop = stops.find((s) => s.routeId === route.id && norm(s.name) === norm(r.stop));
    if (!stop) {
      line.problem = 'stop_not_on_route';
      continue;
    }
    line.stopId = stop.stopId;
    const key = `${personId}:${r.direction}`;
    if (seen.has(key)) {
      line.problem = 'repeated';
      continue;
    }
    seen.add(key);
    line.unchanged = current.has(`${personId}:${route.id}:${stop.stopId}`);
  }
  const ids = lines.flatMap((l) => (l.personId ? [l.personId] : []));
  const names = await displayNames(tx, ids);
  for (const l of lines) l.name = l.personId ? (names[l.personId] ?? null) : null;

  // Riders per route after the import: today's riders, minus those moving, plus those arriving.
  const riding = await tx.execute<{ personId: string; routeId: string; direction: string }>(sql`
    select person_id::text as "personId", route_id::text as "routeId", direction from transport_assignment
    where org_id = app_current_org() and valid_during @> ${from}::date`);
  const ok = lines.filter((l) => !l.problem);
  const moving = new Set(
    ok.map((l) => `${l.personId}:${routes.find((x) => x.id === l.routeId)?.direction}`),
  );
  const count = new Map<string, number>();
  for (const r of riding)
    if (!moving.has(`${r.personId}:${r.direction}`))
      count.set(r.routeId, (count.get(r.routeId) ?? 0) + 1);
  for (const l of ok) if (l.routeId) count.set(l.routeId, (count.get(l.routeId) ?? 0) + 1);
  return {
    lines,
    ready: ok.filter((l) => !l.unchanged).length,
    problems: lines.length - ok.length,
    overCapacity: routes
      .filter((r) => r.seats !== null && (count.get(r.id) ?? 0) > r.seats)
      .map((r) => ({
        routeId: r.id,
        name: r.name,
        riders: count.get(r.id) ?? 0,
        seats: r.seats ?? 0,
      })),
  };
}

type ImportInput = { institutionId: string; from: string; rows: ImportRow[] };

/** What an import would do, row by row. Changes nothing. */
export async function previewRiderImport(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: ImportInput,
): Promise<ImportPlan> {
  return withTenant(db, actor.orgId, async (tx) => {
    const where = await campusOf(tx, input.institutionId);
    await permissions.assertCan(tx, actor, 'transport.assignment.manage', {
      orgId: actor.orgId,
      place: where,
    });
    return planImport(tx, placements, input.institutionId, where.campusId, input.rows, input.from);
  });
}

/** Applies the rows that are ready (re-checked now), as one batch. */
export async function commitRiderImport(
  db: Db,
  permissions: Permissions,
  placements: Placements,
  actor: Actor,
  input: ImportInput,
  bill?: BillRider,
): Promise<{ batchId: string; assigned: number; skipped: number; invoices: number }> {
  const where = await withTenant(db, actor.orgId, (tx) => campusOf(tx, input.institutionId));
  return command(
    db,
    permissions,
    actor,
    { permission: 'transport.assignment.manage', resource: { orgId: actor.orgId, place: where } },
    async (tx) => {
      const plan = await planImport(
        tx,
        placements,
        input.institutionId,
        where.campusId,
        input.rows,
        input.from,
      );
      const [b] = await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`);
      const batchId = b?.id ?? '';
      let assigned = 0;
      let invoices = 0;
      for (const l of plan.lines) {
        if (l.problem || l.unchanged || !l.personId || !l.routeId || !l.stopId) continue;
        const a = { personId: l.personId, routeId: l.routeId, stopId: l.stopId, from: input.from };
        const { direction } = await check(tx, placements, where.campusId, a);
        await write(tx, actor, a, direction, batchId);
        invoices += (
          await billRider(tx, bill, placements, actor, {
            ...a,
            institutionId: input.institutionId,
          })
        ).invoices;
        assigned++;
      }
      return {
        result: { batchId, assigned, skipped: plan.lines.length - assigned, invoices },
        audit: {
          action: 'transport.assignment.import',
          entityType: 'institution',
          entityId: input.institutionId,
          dataClass: 'personal',
          detail: { batchId, assigned, invoices, problems: plan.problems, from: input.from },
        },
        events: [
          {
            type: TRANSPORT_ASSIGNMENT_CHANGED,
            payload: { batchId, institutionId: input.institutionId, assigned },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Audience: fare zones and routes as groups for fee plans and notices.
// ---------------------------------------------------------------------------------------------

/**
 * Transport's groups for communications and finance: each fare zone ("Transport zone 2") and each
 * route ("Route 3 · pickup riders"). Combine with the academic audience (combineAudiences), which
 * keeps the riders to students of the institution being billed or messaged.
 */
export const transportAudience = {
  async groups(tx: Tx, institutionId: string): Promise<{ id: string; label: string }[]> {
    const p = await placeOf(tx, institutionId);
    if (!p) return [];
    const zones = await tx.execute<{ id: string; label: string }>(sql`
      select id::text, 'Transport zone ' || number as label from transport_fare_zone
      where org_id = app_current_org() and campus_id = ${p.campusId} order by number`);
    const routes = await tx.execute<{ id: string; label: string }>(sql`
      select id::text, name || ' · ' || direction || ' riders' as label from transport_route
      where org_id = app_current_org() and campus_id = ${p.campusId} and active order by name, direction`);
    return [...zones, ...routes];
  },
  async students(
    tx: Tx,
    institutionId: string,
    groupIds: string[] | null,
    onDate: string,
  ): Promise<string[]> {
    if (!groupIds?.length) return [];
    const p = await placeOf(tx, institutionId);
    if (!p) return [];
    const ids = `{${groupIds.join(',')}}`;
    const rows = await tx.execute<{ id: string }>(sql`
      select distinct a.person_id::text as id
      from transport_assignment a
      join transport_route r on r.org_id = a.org_id and r.id = a.route_id
      join transport_stop s on s.org_id = a.org_id and s.id = a.stop_id
      left join transport_fare_zone z on z.org_id = s.org_id and z.campus_id = s.campus_id and z.number = s.fare_zone
      where a.org_id = app_current_org() and r.campus_id = ${p.campusId} and a.valid_during @> ${onDate}::date
        and (a.route_id = any(${ids}::uuid[]) or z.id = any(${ids}::uuid[]))`);
    return rows.map((r) => r.id);
  },
};
