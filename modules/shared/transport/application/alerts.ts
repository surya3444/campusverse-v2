// Who hears what during a trip. Guardians: boarded, dropped, back at school, not on the bus
// (after a short wait, in case the tap is corrected). The in-charge (everyone who manages routes
// on the campus): a child found on the bus, nobody at a drop stop, a trip not cleared in time.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import type { Consumer, Schedule, Task } from '@campusverse/platform-events';
import { holdersAt } from '@campusverse/platform-permissions';
import { notifyGuardians, requestMessage, type Kind } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { riderState, type MarkKind } from '../domain/trip.js';
import { TRANSPORT_SOS } from './drive.js';
import { TRANSPORT_STUDENT_MARKED, TRANSPORT_TRIP_ENDED, TRANSPORT_TRIP_STARTED } from './trips.js';

export const TRIP_NOT_CLEARED = 'transport.trip.not-cleared-check';
export const NOT_BOARDED_ALERT = 'transport.not-boarded-alert';
/** A "not on the bus" alert waits this long, so a quick correction sends nothing. */
export const NOT_BOARDED_WAIT_MS = 5 * 60_000;

const t = (title: string, body: string): [string, string] => [title, body];

const COPY = {
  boarded: (n: string, stop: string, at: string) =>
    t('On the bus', `${n} boarded the bus${stop ? ` at ${stop}` : ''} at ${at}.`),
  dropped: (n: string, stop: string, at: string) =>
    t('Dropped', `${n} was dropped at ${stop} at ${at}.`),
  handed_to_school: (n: string, _stop: string, at: string) =>
    t('At school', `${n} is at school with the staff (${at}).`),
  nobody_at_stop: (n: string, stop: string) =>
    t(
      'Coming back to school',
      `Nobody was at ${stop} for ${n}. ${n} is staying on the bus and coming back to school. Please call the school office.`,
    ),
  notBoarded: (n: string, route: string) =>
    t('Not on the bus today', `${n} did not board ${route} today.`),
  staffNobody: (n: string, route: string, stop: string) =>
    t(
      `${route}: nobody at ${stop}`,
      `${n} is staying on the bus and coming back to school. The guardians have been told.`,
    ),
  childFound: (route: string, note: string) =>
    t(
      `${route}: child found on the bus`,
      `The attendant found a child on the bus after the trip. ${note}`,
    ),
  sos: (route: string, note: string, where: string) =>
    t(`SOS: ${route}`, `${note || 'The bus asked for help.'}${where} Call the bus now.`),
  papers: (reg: string, kind: string, until: string, days: number) =>
    t(
      days < 0 ? `${reg}: ${kind} expired` : `${reg}: ${kind} expires in ${days} days`,
      days < 0
        ? `The ${kind} for ${reg} expired on ${until}. The bus can't run without a reason recorded. Renew it and record the new paper.`
        : `The ${kind} for ${reg} is valid until ${until}. Renew it and record the new paper in Transport.`,
    ),
  notCleared: (route: string) =>
    t(
      `${route} has not been cleared`,
      'The trip is still open 30 minutes after its last stop. Check that the bus is empty.',
    ),
};

async function context(tx: Tx, tripId: string, personId: string | null, eventId: string | null) {
  const [c] = await tx.execute<{
    route: string;
    campusId: string;
    name: string;
    stop: string;
    at: string;
  }>(sql`
    select r.name as route, r.campus_id::text as "campusId",
      coalesce((select legal_name from person where org_id = app_current_org() and id = ${personId}), '') as name,
      coalesce(s.name, '') as stop,
      coalesce(to_char(e.occurred_at at time zone 'Asia/Kolkata', 'FMHH12:MI am'), '') as at
    from transport_trip t join transport_route r on r.org_id = t.org_id and r.id = t.route_id
    left join transport_boarding_event e on e.org_id = t.org_id and e.id = ${eventId}
    left join transport_stop s on s.org_id = e.org_id and s.id = e.stop_id
    where t.org_id = app_current_org() and t.id = ${tripId}`);
  return c;
}

async function tellStaff(
  tx: Tx,
  campusId: string,
  [title, body]: [string, string],
  key: string,
  kind: Kind = 'urgent',
) {
  for (const id of await holdersAt(tx, 'transport.route.manage', campusId))
    await requestMessage(tx, {
      recipientPersonId: id,
      kind,
      language: 'en',
      title,
      body,
      dedupeKey: `${key}:${id}`,
    });
}

type Marked = { eventId: string; tripId: string; personId: string; kind: MarkKind };

export function transportJobs(deps: { schedule: Schedule }): {
  consumers: Consumer[];
  tasks: Task[];
} {
  return {
    consumers: [
      {
        // Repeat-safe: the task alerts at most once per trip (not_cleared_alerted_at).
        name: 'transport.schedule-not-cleared',
        queue: 'notifications',
        events: [TRANSPORT_TRIP_STARTED],
        afterCommit: async (_db, e) => {
          const p = e.payload as { tripId: string; checkInMs: number };
          await deps.schedule(TRIP_NOT_CLEARED, { orgId: e.orgId, tripId: p.tripId }, p.checkInMs);
        },
      },
      {
        name: 'transport.mark-alerts',
        queue: 'notifications',
        events: [TRANSPORT_STUDENT_MARKED],
        handle: async (tx, e) => {
          const p = e.payload as Marked;
          if (p.kind === 'not_boarded') return;
          const c = await context(tx, p.tripId, p.personId, p.eventId);
          if (!c) return;
          const [title, body] = COPY[p.kind](c.name, c.stop, c.at);
          await notifyGuardians(tx, {
            studentId: p.personId,
            flag: 'academic_messages',
            kind: p.kind === 'nobody_at_stop' ? 'urgent' : 'transport',
            language: 'en',
            title,
            body,
            dedupeKey: `transport:${p.eventId}`,
          });
          if (p.kind === 'nobody_at_stop')
            await tellStaff(
              tx,
              c.campusId,
              COPY.staffNobody(c.name, c.route, c.stop),
              `transport:${p.eventId}`,
            );
        },
      },
      {
        // Repeat-safe: the task re-reads the marks and alerts once per child per trip.
        name: 'transport.schedule-not-boarded',
        queue: 'notifications',
        events: [TRANSPORT_STUDENT_MARKED],
        afterCommit: async (_db, e) => {
          const p = e.payload as Marked;
          if (p.kind === 'not_boarded')
            await deps.schedule(NOT_BOARDED_ALERT, { ...p, orgId: e.orgId }, NOT_BOARDED_WAIT_MS);
        },
      },
      {
        // Papers: checked whenever a trip starts on the campus, so a school that runs buses
        // hears about them on a working day; each reminder (30 days, 7 days, expired) goes once.
        // ponytail: rides on trip starts, not a nightly job; a scheduled check if buses sit idle for weeks.
        name: 'transport.paper-reminders',
        queue: 'notifications',
        events: [TRANSPORT_TRIP_STARTED],
        handle: async (tx, e) => {
          const p = e.payload as { campusId: string };
          const due = await tx.execute<{
            vehicleId: string;
            registration: string;
            kind: string;
            until: string;
            days: number;
          }>(sql`
            select v.id::text as "vehicleId", v.registration, d.kind,
              to_char(max(d.valid_until), 'DD Mon YYYY') as until,
              (max(d.valid_until) - app_today())::int as days
            from transport_vehicle v
            join transport_vehicle_document d on d.org_id = v.org_id and d.vehicle_id = v.id
            where v.org_id = app_current_org() and v.campus_id = ${p.campusId} and v.active
            group by v.id, v.registration, d.kind
            having max(d.valid_until) - app_today() <= 30`);
          for (const d of due) {
            const step = d.days < 0 ? 'expired' : d.days <= 7 ? 'week' : 'month';
            await tellStaff(
              tx,
              p.campusId,
              COPY.papers(d.registration, d.kind, d.until, d.days),
              `transport-papers:${d.vehicleId}:${d.kind}:${d.until}:${step}`,
              d.days < 0 ? 'urgent' : 'notice',
            );
          }
        },
      },
      {
        name: 'transport.sos',
        queue: 'notifications',
        events: [TRANSPORT_SOS],
        handle: async (tx, e) => {
          const p = e.payload as {
            tripId: string;
            note: string | null;
            lat: number | null;
            lng: number | null;
          };
          const c = await context(tx, p.tripId, null, null);
          const where =
            p.lat !== null && p.lng !== null
              ? ` Last position: https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}.`
              : '';
          if (c)
            await tellStaff(
              tx,
              c.campusId,
              COPY.sos(c.route, p.note ?? '', where),
              `transport:${e.id}`,
            );
        },
      },
      {
        name: 'transport.child-found',
        queue: 'notifications',
        events: [TRANSPORT_TRIP_ENDED],
        handle: async (tx, e) => {
          const p = e.payload as { tripId: string; outcome: string; note: string | null };
          if (p.outcome !== 'child_found') return;
          const c = await context(tx, p.tripId, null, null);
          if (c)
            await tellStaff(
              tx,
              c.campusId,
              COPY.childFound(c.route, p.note ?? ''),
              `transport:${e.id}`,
            );
        },
      },
    ],
    tasks: [
      {
        name: TRIP_NOT_CLEARED,
        queue: 'notifications',
        run: (db, data) => checkCleared(db, data as { orgId: string; tripId: string }),
      },
      {
        name: NOT_BOARDED_ALERT,
        queue: 'notifications',
        run: (db, data) => notBoarded(db, data as Marked & { orgId: string }),
      },
    ],
  };
}

/** Still open past its time: tell the in-charge, once. */
export async function checkCleared(db: Db, data: { orgId: string; tripId: string }): Promise<void> {
  await withTenant(db, data.orgId, async (tx) => {
    const [open] = await tx.execute(sql`
      update transport_trip set not_cleared_alerted_at = now()
      where org_id = app_current_org() and id = ${data.tripId} and ended_at is null
        and not_cleared_alerted_at is null
      returning id`);
    if (!open) return;
    const c = await context(tx, data.tripId, null, null);
    if (c)
      await tellStaff(
        tx,
        c.campusId,
        COPY.notCleared(c.route),
        `transport-not-cleared:${data.tripId}`,
      );
  });
}

/** Still marked "didn't come" after the wait: tell the guardians, once. */
export async function notBoarded(db: Db, data: Marked & { orgId: string }): Promise<void> {
  await withTenant(db, data.orgId, async (tx) => {
    const marks = await tx.execute<{ kind: MarkKind; at: string }>(sql`
      select kind, occurred_at::text as at from transport_boarding_event
      where org_id = app_current_org() and trip_id = ${data.tripId} and person_id = ${data.personId}`);
    if (riderState(marks) !== 'not_boarded') return;
    // The parent already told the school: nothing to tell them.
    const [told] = await tx.execute(sql`
      select 1 from transport_skip k join transport_trip t on t.org_id = k.org_id
        and t.trip_date = k.trip_date and t.direction = k.direction
      where k.org_id = app_current_org() and t.id = ${data.tripId} and k.person_id = ${data.personId}
        and k.cancelled_at is null`);
    if (told) return;
    const c = await context(tx, data.tripId, data.personId, null);
    if (!c) return;
    const [title, body] = COPY.notBoarded(c.name, c.route);
    await notifyGuardians(tx, {
      studentId: data.personId,
      flag: 'academic_messages',
      kind: 'transport',
      language: 'en',
      title,
      body,
      dedupeKey: `transport-not-boarded:${data.tripId}:${data.personId}`,
    });
  });
}
