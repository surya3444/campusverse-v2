// The hostel's messages (docs/specs/HOSTEL.md): guardians of a child absent at roll call, the
// parent who asked for an outpass when it's decided, and every guardian when the child leaves and
// comes back. Absence, leaving and coming back are safety messages: opt-outs don't apply.
import type { Tx } from '@campusverse/db';
import type { Consumer } from '@campusverse/platform-events';
import { notifyGuardians, requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { OUTPASS_DECIDED, OUTPASS_LEFT, OUTPASS_RETURNED, ROLL_CALL_SUBMITTED } from './hostel.js';

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const COPY = {
  en: {
    absentTitle: (n: string) => `${n} missed the hostel roll call`,
    absentBody: (n: string, session: string, on: string) =>
      `${n} wasn't at the hostel's ${session} roll call on ${day(on)}. The warden is checking.`,
    approvedTitle: (n: string) => `Outpass approved for ${n}`,
    approvedBody: (n: string, from: string, to: string) =>
      `${n} may leave the hostel on ${day(from)} and should be back by ${day(to)}.`,
    rejectedTitle: (n: string) => `Outpass not approved for ${n}`,
    rejectedBody: (note: string) => `The warden said: ${note}`,
    leftTitle: (n: string) => `${n} left the hostel`,
    leftBody: (n: string, collector: string, relation: string, to: string) =>
      `${n} left the hostel with ${collector} (${relation.toLowerCase()}). Back by ${day(to)}.`,
    backTitle: (n: string) => `${n} is back at the hostel`,
    backBody: (n: string) => `${n} is back at the hostel.`,
  },
} as const;

async function outpass(tx: Tx, outpassId: string) {
  const [o] = await tx.execute<{
    studentId: string;
    student: string;
    state: string;
    leavesOn: string;
    backBy: string;
    collector: string;
    relation: string;
    note: string | null;
    requestedBy: string;
    byParent: boolean;
  }>(sql`
    select o.student_person_id::text as "studentId", p.legal_name as student, o.state,
      o.leaves_on::text as "leavesOn", o.back_by::text as "backBy", o.collector_name as collector,
      o.collector_relation as relation, o.decision_note as note, o.requested_by_person_id::text as "requestedBy",
      exists (select 1 from guardian_link g where g.org_id = o.org_id and g.guardian_person_id = o.requested_by_person_id
        and g.student_person_id = o.student_person_id and g.restricted_at is null) as "byParent"
    from hostel_outpass o join person p on p.org_id = o.org_id and p.id = o.student_person_id
    where o.org_id = app_current_org() and o.id = ${outpassId}`);
  return o;
}

export function hostelJobs(): Consumer[] {
  return [
    {
      name: 'hostel.rollcall.tell-guardians',
      queue: 'notifications',
      events: [ROLL_CALL_SUBMITTED],
      handle: async (tx, e) => {
        const { rollCallId } = e.payload as { rollCallId: string };
        const absent = await tx.execute<{
          studentId: string;
          name: string;
          session: string;
          onDate: string;
        }>(sql`
          select m.student_person_id::text as "studentId", p.legal_name as name, c.session, c.on_date::text as "onDate"
          from hostel_roll_mark m
          join hostel_roll_call c on c.org_id = m.org_id and c.id = m.roll_call_id
          join person p on p.org_id = m.org_id and p.id = m.student_person_id
          where m.org_id = app_current_org() and m.roll_call_id = ${rollCallId} and m.status = 'absent'`);
        for (const a of absent)
          await notifyGuardians(tx, {
            studentId: a.studentId,
            flag: null,
            kind: 'hostel',
            language: 'en',
            title: COPY.en.absentTitle(a.name),
            body: COPY.en.absentBody(a.name, a.session, a.onDate),
            dedupeKey: `hostel-absent:${rollCallId}:${a.studentId}`,
          });
      },
    },
    {
      name: 'hostel.outpass.tell-parent',
      queue: 'notifications',
      events: [OUTPASS_DECIDED],
      handle: async (tx, e) => {
        const { outpassId } = e.payload as { outpassId: string };
        const o = await outpass(tx, outpassId);
        if (!o?.byParent || (o.state !== 'approved' && o.state !== 'rejected')) return;
        const approved = o.state === 'approved';
        await requestMessage(tx, {
          recipientPersonId: o.requestedBy,
          aboutPersonId: o.studentId,
          kind: 'hostel',
          language: 'en',
          title: approved ? COPY.en.approvedTitle(o.student) : COPY.en.rejectedTitle(o.student),
          body: approved
            ? COPY.en.approvedBody(o.student, o.leavesOn, o.backBy)
            : COPY.en.rejectedBody(o.note ?? ''),
          dedupeKey: `hostel-outpass-decided:${outpassId}`,
        });
      },
    },
    {
      name: 'hostel.outpass.tell-guardians',
      queue: 'notifications',
      events: [OUTPASS_LEFT, OUTPASS_RETURNED],
      handle: async (tx, e) => {
        const { outpassId } = e.payload as { outpassId: string };
        const o = await outpass(tx, outpassId);
        if (!o) return;
        const left = e.type === OUTPASS_LEFT;
        await notifyGuardians(tx, {
          studentId: o.studentId,
          flag: null,
          kind: 'hostel',
          language: 'en',
          title: left ? COPY.en.leftTitle(o.student) : COPY.en.backTitle(o.student),
          body: left
            ? COPY.en.leftBody(o.student, o.collector, o.relation, o.backBy)
            : COPY.en.backBody(o.student),
          dedupeKey: `hostel-outpass-${left ? 'left' : 'back'}:${outpassId}`,
        });
      },
    },
  ];
}
