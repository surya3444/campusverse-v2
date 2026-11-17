// Verse AI: today's buses as counts (no children's names), for people who see transport.
import type { Db } from '@campusverse/db';
import type { createPermissions } from '@campusverse/platform-permissions';
import { defineTool, type VerseTool } from '@campusverse/verse-ai';
import { z } from 'zod';
import { todayTrips } from './trips.js';

export function transportTools(deps: {
  db: Db;
  permissions: ReturnType<typeof createPermissions>;
}): VerseTool[] {
  return [
    defineTool({
      name: 'transport.trips_today',
      description:
        "Today's school buses: each route's state (not started, running, ended), riders on board, " +
        "who didn't come, running late past its last stop, SOS, papers missing, and when the bus was last seen. Counts only.",
      permission: ['transport.trip.read'],
      risk: 'read',
      dataClasses: ['operational'],
      input: z.object({}),
      handler: async (ctx) => {
        const trips = await todayTrips(deps.db, deps.permissions, ctx.actor, ctx.institutionId);
        const now = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date());
        return {
          data: {
            asOf: now,
            buses: trips.map((r) => ({
              route: r.name,
              direction: r.direction,
              planned: r.firstAt && r.lastAt ? `${r.firstAt}-${r.lastAt}` : null,
              state: !r.trip ? 'not_started' : r.trip.endedAt ? 'ended' : 'running',
              riders: r.riders,
              onBoard: r.counts.on_board,
              notBoarded: r.counts.not_boarded,
              dropped: r.counts.dropped,
              atSchool: r.counts.at_school,
              // Still running 30 minutes after the last planned stop.
              late: !!r.trip && !r.trip.endedAt && !!r.lastAt && now > addMinutes(r.lastAt, 30),
              sos: r.trip?.sos ? r.trip.sos.at : null,
              childFound: r.trip?.checkOutcome === 'child_found',
              papersMissing: r.blocked,
              lastSeenMinutesAgo: r.trip?.lastSeen?.minutesAgo ?? null,
            })),
          },
          sources: [{ label: 'Transport · Today', href: '/transport', asOf: now }],
        };
      },
    }),
  ];
}

const addMinutes = (hm: string, m: number) => {
  const [h = 0, mm = 0] = hm.split(':').map(Number);
  const t = h * 60 + mm + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
