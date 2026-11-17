// Academics › Exams & Results › Hall Tickets & Eligibility (rule book §13.2: "Attendance, fee and
// no-dues checks; QR admit cards"; §16: "Hall ticket in app; ineligibility notice with reason";
// P0 item 12). Each student's eligibility for the current term's end exams from attendance
// (academics/attendance) and overdue fees (finance); hall tickets issued as frozen, QR-verifiable
// documents; ineligibility notices with the reasons to the student and their guardians.
import { courseStandings } from '@campusverse/academics-attendance';
import type { BatchFacts } from '@campusverse/academics-structure';
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames } from '@campusverse/people-records';
import { issueDocumentIn, issuedDocumentUrl } from '@campusverse/platform-documents';
import type { Actor } from '@campusverse/platform-permissions';
import { courseAttendanceAt } from '@campusverse/platform-rulepacks';
import { notifyGuardians, requestMessage } from '@campusverse/shared-communications';
import { overdueOf, rupees } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import { eligibilityOf, type CourseEligibility, type Reason } from '../domain/eligibility.js';
import {
  batchAt,
  ExamError,
  finish,
  MANAGE,
  PUBLISH,
  term,
  today,
  type ExamDeps,
} from './exams.js';

export const HALL_TICKET_ISSUED = 'academics.hall_ticket.issued.v1';

/** The PDF fonts draw plain Latin only: dashes in batch labels ("2026–29") become hyphens. */
const plain = (s: string) => s.replace(/[–—]/g, '-');

export type EligibilityRow = {
  studentId: string;
  name: string;
  registerNumber: string | null;
  courses: (CourseEligibility & { basisPoints: number | null })[];
  overduePaise: number;
  reasons: Reason[];
  ticket: {
    number: string;
    courseIds: string[];
    releasedReason: string | null;
    issuedAt: string;
  } | null;
  /** A ticket can be issued now: some course may be sat and no fees hold it (or a release reason is given). */
  ready: boolean;
};

export type EligibilityBoard = {
  batch: { id: string; name: string; term: number; termKind: string };
  students: EligibilityRow[];
};

/** Works out every current student's eligibility for the term's end exams. Call inside the tenant. */
async function rows(tx: Tx, b: BatchFacts) {
  const { courses, takers } = await term(tx, b);
  const d = await today(tx);
  const standings = await courseStandings(tx, b, await courseAttendanceAt(tx, b.institutionId, d));
  const overdue = await overdueOf(
    tx,
    b.students.map((s) => s.personId),
    d,
  );
  const names = await displayNames(
    tx,
    b.students.map((s) => s.personId),
  );
  const tickets = new Map(
    (
      await tx.execute<{
        studentId: string;
        number: string;
        courseIds: string[];
        releasedReason: string | null;
        issuedAt: string;
        documentId: string;
      }>(sql`
        select student_person_id::text as "studentId", number, course_ids::text[] as "courseIds",
          released_reason as "releasedReason", issued_at::text as "issuedAt", document_id::text as "documentId"
        from exam_hall_ticket where org_id = app_current_org() and batch_id = ${b.batchId}
          and term_number = ${b.currentTerm}`)
    ).map((t) => [t.studentId, t]),
  );
  return b.students.map((s) => {
    const taking = takers.find((t) => t.studentId === s.personId)?.courseIds ?? [];
    const list = courses
      .filter((c) => taking.includes(c.courseId))
      .map((c) => {
        const st = standings.get(`${c.courseId}:${s.personId}`);
        return {
          courseId: c.courseId,
          code: c.code,
          title: c.title,
          standing: st?.standing ?? ('no_classes' as const),
          basisPoints: st?.basisPoints ?? null,
        };
      });
    const e = eligibilityOf(list, overdue[s.personId] ?? 0);
    const t = tickets.get(s.personId);
    return {
      studentId: s.personId,
      name: names[s.personId] ?? '',
      registerNumber: s.registerNumber,
      courses: e.courses.map((c) => ({
        ...c,
        basisPoints: list.find((x) => x.courseId === c.courseId)?.basisPoints ?? null,
      })),
      titles: new Map(list.map((c) => [c.courseId, c.title])),
      overduePaise: overdue[s.personId] ?? 0,
      reasons: e.reasons,
      feesHold: e.feesHold,
      anyCourse: e.anyCourse,
      ticket: t ?? null,
    };
  });
}

/** The term's eligibility, student by student, with any hall ticket issued. */
export async function eligibilityBoard(
  deps: ExamDeps,
  actor: Actor,
  batchId: string,
): Promise<EligibilityBoard> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, batchId, [
      MANAGE,
      PUBLISH,
      'academics.structure.read',
    ]);
    const list = await rows(tx, b);
    return {
      batch: {
        id: b.batchId,
        name: `${b.programCode} ${b.label}`,
        term: b.currentTerm,
        termKind: b.termKind,
      },
      students: list.map((r) => ({
        studentId: r.studentId,
        name: r.name,
        registerNumber: r.registerNumber,
        courses: r.courses,
        overduePaise: r.overduePaise,
        reasons: r.reasons,
        ticket: r.ticket
          ? {
              number: r.ticket.number,
              courseIds: r.ticket.courseIds,
              releasedReason: r.ticket.releasedReason,
              issuedAt: r.ticket.issuedAt,
            }
          : null,
        ready: r.anyCourse && !r.feesHold,
      })),
    };
  });
}

/**
 * Issues hall tickets: every ready student of the batch, or the named ones. With `releaseReason`,
 * named students are issued one although fees are overdue (audited). A ticket already issued for
 * the same courses is left alone; one whose courses changed is issued again as a new version.
 */
export async function issueHallTickets(
  deps: ExamDeps,
  actor: Actor,
  input: {
    batchId: string;
    studentIds?: string[] | undefined;
    releaseReason?: string | null | undefined;
  },
): Promise<{ issued: number; unchanged: number; withheld: number; noCourse: number }> {
  if (!deps.store || !deps.verifyBaseUrl)
    throw new Error('issueHallTickets: document store missing');
  const store = deps.store;
  const verifyBaseUrl = deps.verifyBaseUrl;
  const release = input.releaseReason?.trim() || null;
  if (release !== null && (release.length < 3 || !input.studentIds?.length))
    throw new ExamError('release_reason_needed');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MANAGE]);
    const want = input.studentIds ? new Set(input.studentIds) : null;
    const counts = { issued: 0, unchanged: 0, withheld: 0, noCourse: 0 };
    for (const r of await rows(tx, b)) {
      if (want && !want.has(r.studentId)) continue;
      if (!r.anyCourse) {
        counts.noCourse += 1;
        continue;
      }
      if (r.feesHold && !release) {
        counts.withheld += 1;
        continue;
      }
      const courseIds = r.courses.filter((c) => c.maySit).map((c) => c.courseId);
      if (r.ticket && r.ticket.courseIds.join() === courseIds.join()) {
        counts.unchanged += 1;
        continue;
      }
      const number =
        r.ticket?.number ??
        `HT-${b.programCode}-${b.label.replace(/[^\w]+/g, '')}-T${b.currentTerm}-${r.registerNumber ?? r.studentId.slice(-6)}`;
      const doc = await issueDocumentIn(
        tx,
        store,
        actor,
        { verifyBaseUrl },
        {
          kind: 'hall_ticket',
          number,
          title: 'Hall ticket',
          subjectPersonId: r.studentId,
          ...(r.ticket ? { supersedesId: r.ticket.documentId, reason: 'Courses changed' } : {}),
          lines: (
            [
              ['Name', r.name],
              ['Register number', r.registerNumber ?? '-'],
              ['Programme', `${b.programCode} ${b.label}`],
              ['Term', String(b.currentTerm)],
              ...r.courses
                .filter((c) => c.maySit)
                .map((c, i): [string, string] => [
                  i === 0 ? 'May sit' : '',
                  `${c.code} ${r.titles.get(c.courseId) ?? ''}`,
                ]),
            ] as [string, string][]
          ).map(([k, v]): [string, string] => [k, plain(v)]),
        },
      );
      await tx.execute(sql`
        insert into exam_hall_ticket (org_id, batch_id, term_number, student_person_id, number, course_ids, document_id,
          released_reason, issued_by_person_id)
        values (app_current_org(), ${b.batchId}, ${b.currentTerm}, ${r.studentId}, ${number},
          ${`{${courseIds.join(',')}}`}::uuid[], ${doc.id}, ${r.feesHold ? release : null}, ${actor.personId})
        on conflict (org_id, batch_id, term_number, student_person_id) do update set
          course_ids = excluded.course_ids, document_id = excluded.document_id,
          released_reason = excluded.released_reason, issued_by_person_id = excluded.issued_by_person_id,
          issued_at = now()`);
      await finish(tx, actor, {
        result: undefined,
        audit: {
          action: r.feesHold ? 'academics.hall_ticket.release' : 'academics.hall_ticket.issue',
          entityType: 'person',
          entityId: r.studentId,
          dataClass: 'personal',
          ...(r.feesHold && release ? { reason: release } : {}),
          detail: { number, term: b.currentTerm, courses: courseIds.length },
        },
        events: [
          {
            type: HALL_TICKET_ISSUED,
            payload: { batchId: b.batchId, studentId: r.studentId, documentId: doc.id },
          },
        ],
      });
      counts.issued += 1;
    }
    return counts;
  });
}

/** A short-lived link to a student's hall ticket PDF (the exam office, or the student themself). */
export async function hallTicketUrl(
  deps: ExamDeps,
  actor: Actor,
  input: { batchId: string; studentId: string },
): Promise<string> {
  if (!deps.store) throw new Error('hallTicketUrl: document store missing');
  const store = deps.store;
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, input.batchId, [MANAGE, 'academics.structure.read']);
    const [t] = await tx.execute<{ documentId: string }>(sql`
      select document_id::text as "documentId" from exam_hall_ticket where org_id = app_current_org()
        and batch_id = ${b.batchId} and term_number = ${b.currentTerm} and student_person_id = ${input.studentId}`);
    const url = t ? await issuedDocumentUrl(tx, store, t.documentId) : null;
    if (!url) throw new ExamError('no_hall_ticket');
    return url;
  });
}

/** What an ineligibility notice says (rule book §16: "ineligibility notice with reason"). */
export function noticeText(name: string, reasons: Reason[]): string {
  const parts = reasons.map((r) =>
    r.kind === 'fees'
      ? `fees of ${rupees(r.overduePaise)} are overdue`
      : `attendance in ${r.code} is below the minimum${r.standing === 'condonable' ? ' (a condonation can be asked for)' : ''}`,
  );
  return `${name}: for this term's end exams, ${parts.join('; ')}. Please contact the exam office.`;
}

/**
 * Sends each student with a reason (and their guardians) a notice saying why, once per set of
 * reasons: a later change of reasons sends a new notice.
 */
export async function sendIneligibilityNotices(
  deps: ExamDeps,
  actor: Actor,
  batchId: string,
): Promise<{ students: number }> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const b = await batchAt(deps, tx, actor, batchId, [MANAGE]);
    let students = 0;
    for (const r of await rows(tx, b)) {
      if (r.reasons.length === 0) continue;
      const body = noticeText(r.name, r.reasons);
      const key = `ineligible:${b.batchId}:${b.currentTerm}:${r.studentId}:${r.reasons.map((x) => (x.kind === 'fees' ? 'fees' : x.code)).join(',')}`;
      const message = { kind: 'notice' as const, language: 'en', title: 'Exam eligibility', body };
      const sent = await requestMessage(tx, {
        ...message,
        recipientPersonId: r.studentId,
        dedupeKey: key,
      });
      await notifyGuardians(tx, {
        ...message,
        studentId: r.studentId,
        aboutPersonId: r.studentId,
        flag: 'academic_messages',
        dedupeKey: key,
      });
      if (sent) students += 1;
    }
    return finish(tx, actor, {
      result: { students },
      audit: {
        action: 'academics.hall_ticket.ineligibility_notice',
        entityType: 'academic_batch',
        entityId: b.batchId,
        dataClass: 'personal',
        detail: { term: b.currentTerm, students },
      },
    });
  });
}
