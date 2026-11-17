// The gate's messages (docs/specs/VISITORS_GATE.md): the host hears their visitor is at the gate;
// guardians hear the moment their child leaves with a pass. Leaving is a safety message: it goes
// to every unrestricted guardian, whatever they chose for academic messages.
import type { Consumer } from '@campusverse/platform-events';
import { notifyGuardians, requestMessage } from '@campusverse/shared-communications';
import { sql } from 'drizzle-orm';
import { PASS_LEFT, VISIT_CHECKED_IN } from './gate.js';

export const COPY = {
  en: {
    visitorTitle: 'Visitor at the gate',
    visitorBody: (name: string, party: number) =>
      `${name}${party > 1 ? ` and ${party - 1} more` : ''} ${party > 1 ? 'are' : 'is'} at the gate to see you.`,
    leftTitle: (student: string) => `${student} left school`,
    leftBody: (student: string, at: string, collector: string, relation: string, reason: string) =>
      `${student} left school at ${at} with ${collector} (${relation.toLowerCase()}). Reason: ${reason}`,
  },
} as const;

export function gateJobs(): Consumer[] {
  return [
    {
      name: 'gate.visit.tell-host',
      queue: 'notifications',
      events: [VISIT_CHECKED_IN],
      handle: async (tx, e) => {
        const { visitId } = e.payload as { visitId: string };
        const [v] = await tx.execute<{ host: string | null; name: string; party: number }>(sql`
          select v.host_person_id::text as host, g.name, v.party_size as party
          from gate_visit v join gate_visitor g on g.org_id = v.org_id and g.id = v.visitor_id
          where v.org_id = app_current_org() and v.id = ${visitId} and v.state = 'in'`);
        if (!v?.host) return;
        await requestMessage(tx, {
          recipientPersonId: v.host,
          kind: 'gate',
          language: 'en',
          title: COPY.en.visitorTitle,
          body: COPY.en.visitorBody(v.name, v.party),
          dedupeKey: `gate-visit:${visitId}`,
        });
      },
    },
    {
      name: 'gate.pass.tell-guardians',
      queue: 'notifications',
      events: [PASS_LEFT],
      handle: async (tx, e) => {
        const { passId } = e.payload as { passId: string };
        const [p] = await tx.execute<{
          studentId: string;
          student: string;
          at: string;
          collector: string;
          relation: string;
          reason: string;
        }>(sql`
          select p.student_person_id::text as "studentId", s.legal_name as student,
            to_char(p.left_at at time zone 'Asia/Kolkata', 'HH12:MI AM') as at,
            p.collector_name as collector, p.collector_relation as relation, p.reason
          from gate_pass p join person s on s.org_id = p.org_id and s.id = p.student_person_id
          where p.org_id = app_current_org() and p.id = ${passId} and p.state = 'left'`);
        if (!p) return;
        await notifyGuardians(tx, {
          studentId: p.studentId,
          flag: null,
          kind: 'gate',
          language: 'en',
          title: COPY.en.leftTitle(p.student),
          body: COPY.en.leftBody(p.student, p.at, p.collector, p.relation, p.reason),
          dedupeKey: `gate-pass:${passId}`,
        });
      },
    },
  ];
}
