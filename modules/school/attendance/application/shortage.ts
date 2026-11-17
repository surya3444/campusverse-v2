import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { boardRulesAt } from '@campusverse/platform-rulepacks';
import { sectionOf, sectionRoster } from '@campusverse/school-enrolment';
import { sectionsOn, type SectionInfo } from '@campusverse/school-setup';
import {
  messageStates,
  notifyGuardians,
  type MessageState,
} from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { COPY } from '../copy.js';
import {
  attendancePercent,
  percentText,
  standing,
  type DayStatus,
  type Standing,
} from '../domain/attendance.js';
import {
  AttendanceError,
  DATE,
  placeOf,
  section,
  SHORTAGE_REACHED,
  today,
  type AttendanceDeps,
} from './common.js';

export type ShortageRow = {
  personId: string;
  name: string;
  sectionLabel: string;
  workingDays: number;
  basisPoints: number;
  percent: string;
  standing: Exclude<Standing, 'ok'>;
  lastNotice: { id: string; sentAt: string } | null;
  condonation: { id: string; status: 'open' | 'granted' | 'refused'; deadline: string } | null;
};

export type ShortageReport = {
  rule: {
    minimumPercent: string;
    warnBelowPercent: string;
    source: string;
    url: string | null;
  } | null;
  students: ShortageRow[];
};

/** Each student's running percentage over the year so far. */
async function percentages(tx: Tx, yearStarts: string, personIds: string[]) {
  if (personIds.length === 0) return new Map<string, ReturnType<typeof attendancePercent>>();
  const rows = await tx.execute<{ id: string; statuses: DayStatus[] }>(sql`
    select person_id::text as id, array_agg(status) as statuses from school_attendance_day
    where org_id = app_current_org() and on_date >= ${yearStarts}::date
      and person_id = any(${`{${personIds.join(',')}}`}::uuid[])
    group by person_id`);
  return new Map(rows.map((r) => [r.id, attendancePercent(r.statuses)]));
}

/** The board's attendance rule in force on a date (rule pack), with its source. */
async function attendanceRuleAt(tx: Tx, s: SectionInfo, on: string) {
  const b = await boardRulesAt(tx, s.institutionId, s.board, on);
  return b?.rules.attendance ? { ...b.rules.attendance, source: b.source } : null;
}

async function ruleFor(tx: Tx, s: SectionInfo, on: string) {
  const rule = await attendanceRuleAt(tx, s, on);
  if (!rule) throw new AttendanceError('no_rule_pack');
  return rule;
}

/** Students below the warning level, with the notices sent and any condonation case. */
export async function shortageReport(
  deps: AttendanceDeps,
  actor: Actor,
  institutionId: string,
): Promise<ShortageReport> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sections = await sectionsOn(tx, institutionId, d);
    const first = sections[0];
    if (!first) return { rule: null, students: [] };
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      place: placeOf(first),
    });
    const rule = await attendanceRuleAt(tx, first, d);
    if (!rule) return { rule: null, students: [] };

    const students = new Map<string, { name: string; sectionLabel: string }>();
    for (const s of sections) {
      for (const r of await sectionRoster(tx, s.sectionId, d)) {
        students.set(r.personId, { name: r.name, sectionLabel: s.label });
      }
    }
    const pct = await percentages(tx, first.yearStarts, [...students.keys()]);
    const flagged = [...pct].flatMap(([personId, p]) => {
      const st = standing(p.basisPoints, rule);
      const who = students.get(personId);
      return st === 'ok' || p.basisPoints === null || !who
        ? []
        : [
            {
              personId,
              ...who,
              workingDays: p.workingDays,
              basisPoints: p.basisPoints,
              standing: st,
            },
          ];
    });
    const ids = `{${flagged.map((f) => f.personId).join(',')}}`;
    const notices = new Map(
      (
        await tx.execute<{ person: string; id: string; sentAt: string }>(sql`
          select distinct on (student_person_id) student_person_id::text as person, id::text, sent_at::text as "sentAt"
          from school_attendance_notice
          where org_id = app_current_org() and year_id = ${first.yearId} and student_person_id = any(${ids}::uuid[])
          order by student_person_id, sent_at desc`)
      ).map((n) => [n.person, { id: n.id, sentAt: n.sentAt }]),
    );
    const cases = new Map(
      (
        await tx.execute<{
          person: string;
          id: string;
          status: 'open' | 'granted' | 'refused';
          deadline: string;
        }>(sql`
          select distinct on (student_person_id) student_person_id::text as person, id::text, status,
            deadline::text as deadline
          from school_condonation_case
          where org_id = app_current_org() and year_id = ${first.yearId} and student_person_id = any(${ids}::uuid[])
          order by student_person_id, created_at desc`)
      ).map((c) => [c.person, { id: c.id, status: c.status, deadline: c.deadline }]),
    );
    return {
      rule: {
        minimumPercent: percentText(rule.minimumBasisPoints),
        warnBelowPercent: percentText(rule.warnBelowBasisPoints),
        source: rule.source.title,
        url: rule.source.url ?? null,
      },
      students: flagged
        .sort((a, b) => a.basisPoints - b.basisPoints)
        .map((f) => ({
          ...f,
          percent: percentText(f.basisPoints),
          lastNotice: notices.get(f.personId) ?? null,
          condonation: cases.get(f.personId) ?? null,
        })),
    };
  });
}

async function standingOf(deps: AttendanceDeps, actor: Actor, personId: string) {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const d = await today(tx);
    const sectionId = await sectionOf(tx, personId, d);
    if (!sectionId) throw new AttendanceError('not_enrolled_then');
    const s = await section(tx, sectionId, d);
    const rule = await ruleFor(tx, s, d);
    const p = (await percentages(tx, s.yearStarts, [personId])).get(personId);
    if (!p || p.basisPoints === null) throw new AttendanceError('no_working_days');
    return { s, rule, basisPoints: p.basisPoints, standing: standing(p.basisPoints, rule) };
  });
}

/**
 * Warns the student's guardians of low attendance. The messages are kept with the notice: their
 * delivery status (per guardian, per channel) is the evidence that the school gave notice.
 */
export async function sendShortageNotice(
  deps: AttendanceDeps,
  actor: Actor,
  input: { personId: string },
): Promise<{ id: string; messages: number }> {
  const st = await standingOf(deps, actor, input.personId);
  if (st.standing === 'ok') throw new AttendanceError('not_short');
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.manage',
      resource: { orgId: actor.orgId, place: placeOf(st.s), subjectPersonId: input.personId },
    },
    async (tx) => {
      const [student] = await sectionRoster(tx, st.s.sectionId, await today(tx)).then((r) =>
        r.filter((x) => x.personId === input.personId),
      );
      const percent = percentText(st.basisPoints);
      const [notice] = await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`);
      if (!notice || !student) throw new Error('notice: missing');
      const messageIds = await notifyGuardians(tx, {
        studentId: input.personId,
        flag: 'academic_messages',
        kind: 'notice',
        language: 'en',
        title: COPY.en.shortageTitle,
        body: COPY.en.shortageBody(student.name, percent, percentText(st.rule.minimumBasisPoints)),
        dedupeKey: `attendance-shortage:${notice.id}`,
      });
      if (messageIds.length === 0) throw new AttendanceError('no_reachable_guardian');
      await tx.execute(sql`
        insert into school_attendance_notice (org_id, id, student_person_id, year_id, percent, message_ids,
          sent_by_person_id)
        values (app_current_org(), ${notice.id}, ${input.personId}, ${st.s.yearId}, ${percent}::numeric,
          ${`{${messageIds.join(',')}}`}::uuid[], ${actor.personId})`);
      return {
        result: { id: notice.id, messages: messageIds.length },
        audit: {
          action: 'school.attendance.manage',
          entityType: 'school_attendance_notice',
          entityId: notice.id,
          dataClass: 'personal',
          detail: { studentId: input.personId, percent, standing: st.standing },
        },
        events:
          st.standing === 'short'
            ? [
                {
                  type: SHORTAGE_REACHED,
                  payload: { personId: input.personId, yearId: st.s.yearId, percent },
                },
              ]
            : [],
      };
    },
  );
}

export type NoticeProof = {
  id: string;
  personId: string;
  percent: string;
  sentAt: string;
  sentBy: string;
  messages: MessageState[];
};

/** A notice and where each of its messages got to. */
export async function noticeProof(
  deps: AttendanceDeps,
  actor: Actor,
  noticeId: string,
): Promise<NoticeProof> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const [n] = await tx.execute<Omit<NoticeProof, 'messages'> & { messageIds: string[] }>(sql`
      select n.id::text, n.student_person_id::text as "personId", n.percent::text, n.sent_at::text as "sentAt",
        p.legal_name as "sentBy", n.message_ids::text[] as "messageIds"
      from school_attendance_notice n join person p on p.org_id = n.org_id and p.id = n.sent_by_person_id
      where n.org_id = app_current_org() and n.id = ${noticeId}`);
    if (!n) throw new AttendanceError('notice_not_found');
    const sectionId = await sectionOf(tx, n.personId, await today(tx));
    if (!sectionId) throw new AttendanceError('notice_not_found');
    const s = await section(tx, sectionId, await today(tx));
    await deps.permissions.assertCan(tx, actor, 'school.attendance.read', {
      orgId: actor.orgId,
      place: placeOf(s),
    });
    const { messageIds, ...rest } = n;
    return { ...rest, messages: await messageStates(tx, messageIds) };
  });
}

/** Opens a condonation case file for a student short of the minimum. */
export async function openCondonation(
  deps: AttendanceDeps,
  actor: Actor,
  input: { personId: string; reason: string; deadline: string; fileIds?: string[] | undefined },
): Promise<{ id: string }> {
  if (!DATE.test(input.deadline)) throw new AttendanceError('bad_date');
  if (input.reason.trim().length < 3) throw new AttendanceError('reason_required');
  const st = await standingOf(deps, actor, input.personId);
  if (st.standing !== 'short') throw new AttendanceError('not_short');
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.attendance.manage',
      resource: { orgId: actor.orgId, place: placeOf(st.s), subjectPersonId: input.personId },
    },
    async (tx) => {
      if (input.deadline < (await today(tx))) throw new AttendanceError('deadline_passed');
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_condonation_case (org_id, student_person_id, year_id, percent, reason, file_ids,
          deadline, opened_by_person_id)
        values (app_current_org(), ${input.personId}, ${st.s.yearId}, ${percentText(st.basisPoints)}::numeric,
          ${input.reason.trim()}, ${`{${(input.fileIds ?? []).join(',')}}`}::uuid[], ${input.deadline}::date,
          ${actor.personId})
        on conflict do nothing
        returning id::text`);
      if (!row) throw new AttendanceError('case_already_open');
      return {
        result: row,
        audit: {
          action: 'school.attendance.manage',
          entityType: 'school_condonation_case',
          entityId: row.id,
          dataClass: 'sensitive',
          reason: input.reason.trim(),
          detail: { studentId: input.personId, deadline: input.deadline },
        },
      };
    },
  );
}

/** The competent authority grants or refuses condonation, with a note either way. */
export async function decideCondonation(
  deps: AttendanceDeps,
  actor: Actor,
  input: { caseId: string; grant: boolean; note: string },
): Promise<void> {
  if (input.note.trim().length < 3) throw new AttendanceError('note_required');
  const place = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [c] = await tx.execute<{ personId: string }>(sql`
      select student_person_id::text as "personId" from school_condonation_case
      where org_id = app_current_org() and id = ${input.caseId} and status = 'open'`);
    if (!c) throw new AttendanceError('case_not_found');
    const sectionId = await sectionOf(tx, c.personId, await today(tx));
    if (!sectionId) throw new AttendanceError('not_enrolled_then');
    return placeOf(await section(tx, sectionId, await today(tx)));
  });
  await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.attendance.sign_off', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const [row] = await tx.execute(sql`
        update school_condonation_case set status = ${input.grant ? 'granted' : 'refused'},
          decided_by_person_id = ${actor.personId}, decided_at = now(), note = ${input.note.trim()}
        where org_id = app_current_org() and id = ${input.caseId} and status = 'open'
        returning 1`);
      if (!row) throw new AttendanceError('case_not_found');
      return {
        result: undefined,
        audit: {
          action: 'school.attendance.sign_off',
          entityType: 'school_condonation_case',
          entityId: input.caseId,
          dataClass: 'sensitive',
          reason: input.note.trim(),
          detail: { decision: input.grant ? 'granted' : 'refused' },
        },
      };
    },
  );
}
