// My Timetable (rule book §13 Timetable › My Timetable: "Teacher's week; Google or Outlook
// calendar sync"): a teacher's own lessons across the schools they teach in, the lessons they
// cover for others, the ones someone covers for them, and the papers they invigilate. The same
// days feed a private calendar link (iCalendar) that Google Calendar or Outlook subscribe to.
import { withTenant, type Db, type Tx } from '@campusverse/db';
import { writeAudit } from '@campusverse/platform-audit';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { CoverKind } from './cover.js';
import { planIn } from './timetable.js';

type Permissions = ReturnType<typeof createPermissions>;

export type MyLesson = {
  date: string;
  ordinal: number | null;
  startsAt: string;
  endsAt: string;
  subject: string;
  /** "Class 5-A", or a teaching group with its sections. */
  section: string;
  room: string | null;
  institution: string;
  /** Mine; one I cover for someone away; or mine, covered by someone else while I'm away. */
  kind: 'own' | 'covering' | 'covered';
  /** Covering: whose lesson it is. Covered: who covers it (null when combined or supervised). */
  other: string | null;
  coverKind: CoverKind | null;
};
export type MyInvigilation = {
  date: string;
  exam: string;
  subject: string;
  className: string;
  room: string | null;
  startsAt: string | null;
  endsAt: string | null;
  institution: string;
};
export type MyDay = {
  date: string;
  /** Set when every school the teacher works in is closed that day. */
  holiday: string | null;
  lessons: MyLesson[];
  exams: MyInvigilation[];
};
export type MyWeek = {
  today: string;
  /** Monday of the week shown. */
  from: string;
  days: MyDay[];
  /** Whether a calendar link is live. */
  feed: { live: boolean; since: string | null };
};

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = (d: string) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(d, -((day + 6) % 7));
};

/** Schools whose timetable or covers name the person, that they may still read. */
async function myInstitutions(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx.execute<{ id: string; name: string; campusId: string }>(sql`
    select i.id::text, i.name, i.campus_id::text as "campusId" from institution i
    where i.org_id = app_current_org() and i.id in (
      select t.institution_id from school_timetable t
      join school_timetable_slot s on s.org_id = t.org_id and s.timetable_id = t.id
      where t.org_id = app_current_org() and t.state = 'published' and s.teacher_person_id = ${actor.personId}
      union
      select c.institution_id from school_cover c
      where c.org_id = app_current_org() and c.covering_person_id = ${actor.personId} and c.cancelled_at is null)
    order by i.name`);
  const allowed: { id: string; name: string }[] = [];
  for (const r of rows) {
    const ok = await permissions.can(tx, actor, 'school.timetable.read', {
      orgId: actor.orgId,
      place: { campusId: r.campusId, institutionId: r.id },
    });
    if (ok.allowed) allowed.push({ id: r.id, name: r.name });
  }
  return allowed;
}

/**
 * The person's days from `from`, `count` days on. No permission check beyond the schools'
 * timetable read: callers are the person themselves (or their calendar link).
 * ponytail: builds each day from planIn per school; cache per day if a feed spans many schools.
 */
async function myDays(
  tx: Tx,
  permissions: Permissions,
  actor: Actor,
  from: string,
  count: number,
): Promise<MyDay[]> {
  const schools = await myInstitutions(tx, permissions, actor);
  const me = actor.personId;
  const days: MyDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(from, i);
    const lessons: MyLesson[] = [];
    const exams: MyInvigilation[] = [];
    const holidays: string[] = [];
    for (const s of schools) {
      const plan = await planIn(tx, s.id, date);
      if (plan.holiday) {
        holidays.push(plan.holiday);
        continue;
      }
      for (const l of plan.lessons) {
        const mine = l.teacherPersonId === me;
        const covering = l.cover?.personId === me;
        if (!mine && !covering) continue;
        lessons.push({
          date,
          ordinal: l.ordinal,
          startsAt: l.startsAt,
          endsAt: l.endsAt,
          subject: l.subject,
          section: l.section,
          room: l.room,
          institution: s.name,
          kind: covering ? 'covering' : l.cover ? 'covered' : 'own',
          other: covering ? l.teacher : l.cover ? l.cover.name : null,
          coverKind: l.cover?.kind ?? null,
        });
      }
      for (const e of plan.exams) {
        if (e.invigilatorPersonId !== me) continue;
        exams.push({
          date,
          exam: e.exam,
          subject: e.subject,
          className: e.className,
          room: e.room,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          institution: s.name,
        });
      }
    }
    lessons.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    days.push({
      date,
      holiday:
        schools.length > 0 && holidays.length === schools.length ? (holidays[0] ?? null) : null,
      lessons,
      exams,
    });
  }
  return days;
}

/** The signed-in person's week (Monday to Sunday) containing `date` (today by default). */
export async function myWeek(
  db: Db,
  permissions: Permissions,
  actor: Actor,
  date?: string | null,
): Promise<MyWeek> {
  return withTenant(db, actor.orgId, async (tx) => {
    const [row] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = row?.d ?? '';
    const from = monday(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today);
    const [feed] = await tx.execute<{ since: string }>(sql`
      select created_at::text as since from school_timetable_feed
      where org_id = app_current_org() and person_id = ${actor.personId} and revoked_at is null`);
    return {
      today,
      from,
      days: await myDays(tx, permissions, actor, from, 7),
      feed: { live: !!feed, since: feed?.since ?? null },
    };
  });
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Makes the person's private calendar link, ending any earlier one. The secret is returned once
 * and only its hash is kept. The link carries the organisation so the feed finds its tenant.
 */
export async function makeCalendarLink(db: Db, actor: Actor): Promise<{ path: string }> {
  const token = randomBytes(24).toString('base64url');
  await withTenant(db, actor.orgId, async (tx) => {
    await tx.execute(sql`
      update school_timetable_feed set revoked_at = now()
      where org_id = app_current_org() and person_id = ${actor.personId} and revoked_at is null`);
    await tx.execute(sql`
      insert into school_timetable_feed (org_id, person_id, token_hash)
      values (app_current_org(), ${actor.personId}, ${hash(token)})`);
    await writeAudit(tx, actor, {
      action: 'school.timetable.calendar_link',
      entityType: 'person',
      entityId: actor.personId,
      dataClass: 'operational',
      detail: { made: true },
    });
  });
  return { path: `public/calendar/${actor.orgId}/${token}.ics` };
}

/** Ends the person's calendar link: subscribed calendars stop updating. */
export async function stopCalendarLink(db: Db, actor: Actor): Promise<void> {
  await withTenant(db, actor.orgId, async (tx) => {
    await tx.execute(sql`
      update school_timetable_feed set revoked_at = now()
      where org_id = app_current_org() and person_id = ${actor.personId} and revoked_at is null`);
    await writeAudit(tx, actor, {
      action: 'school.timetable.calendar_link',
      entityType: 'person',
      entityId: actor.personId,
      dataClass: 'operational',
      detail: { made: false },
    });
  });
}

/** iCalendar text: CRLF lines, folded at 75 octets, with commas, semicolons and backslashes escaped. */
const ics = {
  text: (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'),
  fold: (line: string) => {
    const out: string[] = [];
    let rest = line;
    while (Buffer.byteLength(rest) > 75) {
      let cut = 75;
      while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
      out.push(rest.slice(0, cut));
      rest = ` ${rest.slice(cut)}`;
    }
    out.push(rest);
    return out.join('\r\n');
  },
  local: (date: string, hhmm: string) => `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`,
};

export type CalendarWords = {
  name: string;
  covering: (teacher: string | null) => string;
  covered: (by: string | null) => string;
  invigilation: string;
};

/**
 * The calendar for a link, or null when the link isn't live: last week and the next six weeks,
 * rebuilt on every fetch, in India time. Each lesson is its own event (holidays, exams and covers
 * change single days), with a stable id per lesson and day so calendars update it in place.
 */
export async function calendarFor(
  db: Db,
  permissions: Permissions,
  input: { orgId: string; token: string },
  words: CalendarWords,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(input.orgId) || !/^[A-Za-z0-9_-]{20,64}$/.test(input.token))
    return null;
  return withTenant(db, input.orgId, async (tx) => {
    const [feed] = await tx.execute<{ id: string; personId: string }>(sql`
      select id::text, person_id::text as "personId" from school_timetable_feed
      where org_id = app_current_org() and token_hash = ${hash(input.token)} and revoked_at is null`);
    if (!feed) return null;
    await tx.execute(sql`
      update school_timetable_feed set last_fetched_at = now() where org_id = app_current_org() and id = ${feed.id}`);
    const [row] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
    const today = row?.d ?? '';
    const actor: Actor = { accountId: '', orgId: input.orgId, personId: feed.personId };
    const days = await myDays(tx, permissions, actor, addDays(monday(today), -7), 49);
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Campusverse//My Timetable//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${ics.text(words.name)}`,
      'X-WR-TIMEZONE:Asia/Kolkata',
      'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Kolkata',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0530',
      'TZOFFSETTO:+0530',
      'TZNAME:IST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
    const event = (
      uid: string,
      date: string,
      starts: string,
      ends: string,
      summary: string,
      location: string | null,
      description: string,
    ) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}@campusverse`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Asia/Kolkata:${ics.local(date, starts)}`,
        `DTEND;TZID=Asia/Kolkata:${ics.local(date, ends)}`,
        `SUMMARY:${ics.text(summary)}`,
        ...(location ? [`LOCATION:${ics.text(location)}`] : []),
        `DESCRIPTION:${ics.text(description)}`,
        'END:VEVENT',
      );
    };
    for (const d of days) {
      for (const l of d.lessons) {
        if (l.kind === 'covered' || !l.startsAt || !l.endsAt) continue;
        const what = `${l.subject} · ${l.section}`;
        event(
          `${feed.personId}-${d.date}-${l.startsAt}-${l.section}`.replace(/[^A-Za-z0-9-]/g, ''),
          d.date,
          l.startsAt,
          l.endsAt,
          l.kind === 'covering' ? `${words.covering(l.other)}: ${what}` : what,
          l.room,
          l.institution,
        );
      }
      for (const e of d.exams) {
        if (!e.startsAt || !e.endsAt) continue;
        event(
          `${feed.personId}-${d.date}-exam-${e.startsAt}-${e.subject}`.replace(
            /[^A-Za-z0-9-]/g,
            '',
          ),
          d.date,
          e.startsAt,
          e.endsAt,
          `${words.invigilation}: ${e.exam} · ${e.subject} · ${e.className}`,
          e.room,
          e.institution,
        );
      }
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(ics.fold).join('\r\n')}\r\n`;
  });
}
