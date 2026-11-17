import { withTenant, type Db, type Tx } from '@campusverse/db';
import { studentFacts, studentLeaves } from '@campusverse/people-records';
import { institutionInfo } from '@campusverse/platform-organisation';
import {
  issueDocumentIn,
  issuedDocumentUrl,
  type ObjectStore,
} from '@campusverse/platform-documents';
import { command, type EventInput } from '@campusverse/platform-events';
import {
  PermissionDenied,
  type Actor,
  type createPermissions,
} from '@campusverse/platform-permissions';
import { tcDeadlineAt } from '@campusverse/platform-rulepacks';
import { attendanceFigures } from '@campusverse/school-attendance';
import { endEnrolment, enrolmentFacts } from '@campusverse/school-enrolment';
import { classInfo, sectionInfo, type SectionInfo } from '@campusverse/school-setup';
import { studentMoney } from '@campusverse/shared-finance';
import { sql } from 'drizzle-orm';
import {
  certificateNumber,
  clearance,
  dateFigures,
  dateInWords,
  yearLabelFrom,
  type Kind,
  type Warning,
} from '../domain/certificate.js';

type Permissions = ReturnType<typeof createPermissions>;
export type CertificateDeps = {
  db: Db;
  permissions: Permissions;
  store: ObjectStore;
  verifyBaseUrl: string;
};

export const CERTIFICATE_REQUESTED = 'school.certificate.requested.v1';
export const CERTIFICATE_ISSUED = 'school.certificate.issued.v1';
export const STUDENT_LEFT = 'school.student.left.v1';

/** Spec default: dues never block a TC; a school that wants a block above Class 8 needs legal advice first. */
const BLOCK_DUES_ABOVE_CLASS_8 = false;

const TITLES: Record<Kind, string> = {
  tc: 'Transfer Certificate',
  bonafide: 'Bonafide Certificate',
  fee_paid: 'Fee Paid Certificate',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CertificateError extends Error {
  constructor(
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`Certificate: ${code}`);
    this.name = 'CertificateError';
  }
}

const placeOf = (s: SectionInfo) => ({ campusId: s.campusId, institutionId: s.institutionId });

async function today(tx: Tx) {
  const [r] = await tx.execute<{ d: string }>(sql`select app_today()::text as d`);
  return r?.d ?? '';
}

/** The student's current section, as of a date (the leaving date for a TC). */
async function sectionOfStudent(tx: Tx, studentId: string, onDate: string) {
  const e = await enrolmentFacts(tx, studentId, onDate);
  if (!e) throw new CertificateError('not_enrolled');
  const s = await sectionInfo(tx, e.sectionId, onDate);
  if (!s) throw new CertificateError('not_enrolled');
  return { enrolment: e, section: s };
}

const daysText = (halves: number) => `${Math.floor(halves / 2)}${halves % 2 ? '.5' : ''}`;
const RELATION_LABEL: Record<string, string> = { father: "Father's name", mother: "Mother's name" };

/** The draft: what will be printed, label and value, built from the record. Nothing is invented. */
async function draft(
  tx: Tx,
  input: {
    studentId: string;
    kind: Kind;
    purpose: string | null;
    leavingDate: string | null;
    leavingReason: string | null;
  },
): Promise<{ fields: [string, string][]; warnings: Warning[]; section: SectionInfo }> {
  const onDate = input.leavingDate ?? (await today(tx));
  const { enrolment, section } = await sectionOfStudent(tx, input.studentId, onDate);
  const facts = await studentFacts(tx, input.studentId);
  if (!facts) throw new CertificateError('student_not_found');
  const year = yearLabelFrom(section.yearStarts);
  const name: [string, string] = ['Name of student', facts.name];
  const klass: [string, string] = ['Class and section', section.label];
  const yearRow: [string, string] = ['Academic year', year];
  const money = await studentMoney(tx, {
    studentId: input.studentId,
    paidFrom: section.yearStarts,
    paidUntil: section.yearEnds,
  });

  if (input.kind === 'bonafide') {
    return {
      fields: [
        name,
        klass,
        yearRow,
        ['Admission number', enrolment.admissionNumber],
        ['Purpose', input.purpose ?? 'General'],
        ['Certified that', 'the above student is a bonafide student of this school.'],
      ],
      warnings: [],
      section,
    };
  }
  if (input.kind === 'fee_paid') {
    const rupees = (p: number) =>
      `Rs. ${Math.floor(p / 100).toLocaleString('en-IN')}.${String(p % 100).padStart(2, '0')}`;
    return {
      fields: [
        name,
        klass,
        yearRow,
        ['Admission number', enrolment.admissionNumber],
        ['Fees paid in the year', rupees(money.paidPaise)],
        ['Purpose', input.purpose ?? 'Income tax / reimbursement'],
      ],
      warnings: [],
      section,
    };
  }

  const leaving = input.leavingDate ?? onDate;
  const next = new Date(Date.parse(`${leaving}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const attendance = await attendanceFigures(tx, {
    studentId: input.studentId,
    from: section.yearStarts,
    until: next,
  });
  const c = await classInfo(tx, (await sectionInfo(tx, section.sectionId, leaving))?.classId ?? '');
  const guardians = facts.guardians.map((g): [string, string] => [
    RELATION_LABEL[g.relationship] ?? "Guardian's name",
    g.name,
  ]);
  return {
    fields: [
      name,
      [
        'Date of birth',
        facts.dateOfBirth
          ? `${dateFigures(facts.dateOfBirth)} (${dateInWords(facts.dateOfBirth)})`
          : 'Not recorded',
      ],
      ...guardians,
      ['Admission number', enrolment.admissionNumber],
      ['Date of admission', dateFigures(enrolment.admittedOn)],
      ['Class at leaving', section.label],
      ['Date of leaving', dateFigures(leaving)],
      ['Reason for leaving', input.leavingReason ?? ''],
      ['Working days in the year', String(attendance.workingDays)],
      ['Days present', daysText(attendance.attendedHalfDays)],
      ['Fees paid up to date', money.duePaise === 0 ? 'Yes' : 'No'],
      ['Conduct', 'Good'],
      ['APAAR ID', facts.apaarStatus === 'present' ? 'Recorded with the school' : 'Not recorded'],
      ['PEN (UDISE+)', facts.pen ?? 'Not recorded'],
    ],
    warnings: clearance({
      duePaise: money.duePaise,
      classSequence: c?.sequence ?? 0,
      blockDuesAboveClass8: BLOCK_DUES_ABOVE_CLASS_8,
      workingDays: attendance.workingDays,
      documentsPending: facts.documentsPending,
    }),
    section,
  };
}

const blocking = (w: Warning[]) => w.some((x) => x.code === 'dues' && x.blocks);

/**
 * A request for a certificate, with its draft and clearance worked out at once. A TC needs the
 * leaving date and reason, and carries the state's deadline when one is known.
 */
export async function requestCertificate(
  deps: CertificateDeps,
  actor: Actor,
  input: {
    studentId: string;
    kind: Kind;
    purpose?: string | null | undefined;
    leavingDate?: string | null | undefined;
    leavingReason?: string | null | undefined;
  },
): Promise<{ id: string; warnings: Warning[] }> {
  if (
    input.kind === 'tc' &&
    (!input.leavingDate ||
      !DATE.test(input.leavingDate) ||
      (input.leavingReason ?? '').trim().length < 3)
  ) {
    throw new CertificateError('leaving_details_required');
  }
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(
      (await sectionOfStudent(tx, input.studentId, input.leavingDate ?? (await today(tx)))).section,
    ),
  );
  return command(
    deps.db,
    deps.permissions,
    actor,
    {
      permission: 'school.certificate.request',
      resource: { orgId: actor.orgId, place, subjectPersonId: input.studentId },
    },
    async (tx) => {
      const d = await draft(tx, {
        studentId: input.studentId,
        kind: input.kind,
        purpose: input.purpose?.trim() || null,
        leavingDate: input.leavingDate ?? null,
        leavingReason: input.leavingReason?.trim() || null,
      });
      const deadline =
        input.kind === 'tc'
          ? await tcDeadlineAt(tx, d.section.institutionId, await today(tx))
          : null;
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into school_certificate_request (org_id, institution_id, student_person_id, kind, state, purpose, leaving_date,
          leaving_reason, fields, warnings, due_by, requested_by_person_id)
        values (app_current_org(), ${d.section.institutionId}, ${input.studentId}, ${input.kind},
          ${blocking(d.warnings) ? 'clearance_pending' : 'ready_for_review'}, ${input.purpose?.trim() || null},
          ${input.leavingDate ?? null}::date, ${input.leavingReason?.trim() || null}, ${JSON.stringify(d.fields)}::jsonb,
          ${JSON.stringify(d.warnings)}::jsonb, ${deadline ? sql`app_today() + ${deadline.days}::int` : null}, ${actor.personId})
        on conflict do nothing
        returning id::text`);
      if (!row) throw new CertificateError('tc_already_open');
      return {
        result: { id: row.id, warnings: d.warnings },
        audit: {
          action: 'school.certificate.request',
          entityType: 'school_certificate_request',
          entityId: row.id,
          dataClass: 'personal',
          detail: { kind: input.kind, studentId: input.studentId, warnings: d.warnings.length },
        },
        events: [
          {
            type: CERTIFICATE_REQUESTED,
            payload: { requestId: row.id, kind: input.kind, studentId: input.studentId },
          },
        ],
      };
    },
  );
}

type Req = {
  id: string;
  institutionId: string;
  studentId: string;
  kind: Kind;
  state: string;
  leavingDate: string | null;
  checkedBy: string | null;
  documentId: string | null;
  number: string | null;
  fields: [string, string][];
  warnings: Warning[];
};

async function loadReq(tx: Tx, id: string, lock = false): Promise<Req> {
  const [r] = await tx.execute<Req>(sql`
    select id::text, institution_id::text as "institutionId", student_person_id::text as "studentId", kind, state,
      leaving_date::text as "leavingDate", checked_by_person_id::text as "checkedBy",
      issued_document_id::text as "documentId", number, fields, warnings
    from school_certificate_request where org_id = app_current_org() and id = ${id} ${lock ? sql`for update` : sql``}`);
  if (!r) throw new CertificateError('request_not_found');
  return r;
}

/** Runs a step on one request: permission on its section, the work, audit and events, in one transaction. */
async function step<T>(
  deps: CertificateDeps,
  actor: Actor,
  requestId: string,
  permission: string,
  work: (
    tx: Tx,
    r: Req,
    section: SectionInfo,
  ) => Promise<{
    result: T;
    detail: Record<string, string | number | boolean | null>;
    reason?: string;
    events?: EventInput[];
  }>,
): Promise<T> {
  const place = await withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await loadReq(tx, requestId);
    return placeOf(
      (await sectionOfStudent(tx, r.studentId, r.leavingDate ?? (await today(tx)))).section,
    );
  });
  return command(
    deps.db,
    deps.permissions,
    actor,
    { permission, resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const r = await loadReq(tx, requestId, true);
      const { section } = await sectionOfStudent(
        tx,
        r.studentId,
        r.leavingDate ?? (await today(tx)),
      );
      const out = await work(tx, r, section);
      return {
        result: out.result,
        audit: {
          action: permission,
          entityType: 'school_certificate_request',
          entityId: requestId,
          dataClass: 'personal',
          ...(out.reason ? { reason: out.reason } : {}),
          detail: { kind: r.kind, ...out.detail },
        },
        events: out.events ?? [],
      };
    },
  );
}

/** A changed field before approval, such as attendance the principal sets with a reason. Clears the check. */
export async function editDraft(
  deps: CertificateDeps,
  actor: Actor,
  input: { requestId: string; fields: [string, string][]; reason: string },
): Promise<void> {
  if (input.reason.trim().length < 3) throw new CertificateError('reason_required');
  await step(deps, actor, input.requestId, 'school.certificate.approve', async (tx, r) => {
    if (!['ready_for_review', 'clearance_pending'].includes(r.state))
      throw new CertificateError('not_editable');
    const labels = new Set(r.fields.map(([l]) => l));
    if (input.fields.some(([l]) => !labels.has(l))) throw new CertificateError('unknown_field');
    const next = r.fields.map(([l, v]): [string, string] => [
      l,
      input.fields.find(([x]) => x === l)?.[1] ?? v,
    ]);
    await tx.execute(sql`
      update school_certificate_request set fields = ${JSON.stringify(next)}::jsonb, checked_by_person_id = null, checked_at = null
      where org_id = app_current_org() and id = ${r.id}`);
    return {
      result: undefined,
      reason: input.reason.trim(),
      detail: { changed: input.fields.map(([l]) => l).join(', ') },
    };
  });
}

/** The class teacher checks a TC draft (or a principal or administrator, who then can't approve it). */
export async function checkCertificate(
  deps: CertificateDeps,
  actor: Actor,
  requestId: string,
): Promise<void> {
  await step(deps, actor, requestId, 'school.certificate.check', async (tx, r, section) => {
    if (r.kind !== 'tc' || r.state !== 'ready_for_review')
      throw new CertificateError('not_checkable');
    const isClassTeacher = section.classTeacherPersonId === actor.personId;
    const canApprove = (
      await deps.permissions.can(tx, actor, 'school.certificate.approve', {
        orgId: actor.orgId,
        place: placeOf(section),
      })
    ).allowed;
    if (!isClassTeacher && !canApprove)
      throw new PermissionDenied('school.certificate.check', 'no_relationship');
    await tx.execute(sql`
      update school_certificate_request set checked_by_person_id = ${actor.personId}, checked_at = now()
      where org_id = app_current_org() and id = ${r.id}`);
    return { result: undefined, detail: { classTeacher: isClassTeacher } };
  });
}

/** The principal approves a checked TC; the checker can't also approve it. */
export async function approveCertificate(
  deps: CertificateDeps,
  actor: Actor,
  requestId: string,
): Promise<void> {
  await step(deps, actor, requestId, 'school.certificate.approve', async (tx, r) => {
    if (r.kind !== 'tc' || r.state !== 'ready_for_review')
      throw new CertificateError('not_approvable');
    if (!r.checkedBy) throw new CertificateError('not_checked');
    if (r.checkedBy === actor.personId) throw new CertificateError('checker_cannot_approve');
    await tx.execute(sql`
      update school_certificate_request set state = 'approved', approved_by_person_id = ${actor.personId}, approved_at = now()
      where org_id = app_current_org() and id = ${r.id}`);
    return { result: undefined, detail: {} };
  });
}

async function nextNumber(tx: Tx, institutionId: string, kind: Kind, yearLabel: string) {
  const [c] = await tx.execute<{ n: number }>(sql`
    insert into school_number_counter (org_id, institution_id, kind, year_label, next_number)
    values (app_current_org(), ${institutionId}, ${kind}, ${yearLabel}, 2)
    on conflict (org_id, institution_id, kind, year_label) do update set next_number = school_number_counter.next_number + 1
    returning next_number - 1 as n`);
  return certificateNumber(kind, yearLabel, c?.n ?? 1);
}

/**
 * Issues the frozen, numbered document with its QR code. For a TC this also ends the enrolment and
 * the membership on the leaving date and marks the student left, in the same transaction.
 */
export async function issueCertificate(
  deps: CertificateDeps,
  actor: Actor,
  requestId: string,
): Promise<{ number: string; documentId: string; verificationCode: string }> {
  return step(deps, actor, requestId, 'school.certificate.issue', async (tx, r, section) => {
    if (r.kind === 'tc' ? r.state !== 'approved' : r.state !== 'ready_for_review')
      throw new CertificateError('not_ready');
    if (blocking(r.warnings)) throw new CertificateError('dues_block');
    const number = await nextNumber(tx, r.institutionId, r.kind, yearLabelFrom(section.yearStarts));
    const doc = await issueDocumentIn(
      tx,
      deps.store,
      actor,
      { verifyBaseUrl: deps.verifyBaseUrl },
      {
        kind: r.kind,
        number,
        title: TITLES[r.kind],
        lines: r.fields,
        subjectPersonId: r.studentId,
      },
    );
    await tx.execute(sql`
      update school_certificate_request set state = 'issued', number = ${number}, issued_document_id = ${doc.id}, issued_at = now()
      where org_id = app_current_org() and id = ${r.id}`);
    const events: EventInput[] = [
      {
        type: CERTIFICATE_ISSUED,
        payload: { requestId: r.id, kind: r.kind, number, documentId: doc.id },
      },
    ];
    if (r.kind === 'tc' && r.leavingDate) {
      await endEnrolment(tx, {
        personId: r.studentId,
        lastDay: r.leavingDate,
        status: 'transferred',
      });
      await studentLeaves(tx, {
        personId: r.studentId,
        institutionId: r.institutionId,
        lastDay: r.leavingDate,
      });
      events.push({
        type: STUDENT_LEFT,
        payload: {
          studentId: r.studentId,
          institutionId: r.institutionId,
          lastDay: r.leavingDate,
          tcNumber: number,
        },
      });
    }
    return {
      result: { number, documentId: doc.id, verificationCode: doc.verificationCode },
      detail: { number },
      events,
    };
  });
}

/**
 * A corrected or duplicate copy: a new version with the same number, which supersedes the old
 * one on the QR check. A duplicate is marked DUPLICATE; a correction carries the changed fields.
 */
export async function reissueCertificate(
  deps: CertificateDeps,
  actor: Actor,
  input: {
    requestId: string;
    mode: 'correction' | 'duplicate';
    reason: string;
    fields?: [string, string][] | undefined;
  },
): Promise<{ version: number; verificationCode: string }> {
  if (input.reason.trim().length < 3) throw new CertificateError('reason_required');
  return step(deps, actor, input.requestId, 'school.certificate.approve', async (tx, r) => {
    if (r.state !== 'issued' && r.state !== 'delivered') throw new CertificateError('not_issued');
    if (!r.documentId || !r.number) throw new CertificateError('not_issued');
    const fields =
      input.mode === 'correction' && input.fields
        ? r.fields.map(([l, v]): [string, string] => [
            l,
            input.fields?.find(([x]) => x === l)?.[1] ?? v,
          ])
        : r.fields;
    const doc = await issueDocumentIn(
      tx,
      deps.store,
      actor,
      { verifyBaseUrl: deps.verifyBaseUrl },
      {
        kind: r.kind,
        number: r.number,
        title: input.mode === 'duplicate' ? `${TITLES[r.kind]} (DUPLICATE)` : TITLES[r.kind],
        lines:
          input.mode === 'duplicate'
            ? [...fields, ['Copy', 'DUPLICATE: issued in place of a lost copy']]
            : fields,
        subjectPersonId: r.studentId,
        supersedesId: r.documentId,
        reason: input.reason.trim(),
      },
    );
    await tx.execute(sql`
      update school_certificate_request set issued_document_id = ${doc.id}, fields = ${JSON.stringify(fields)}::jsonb
      where org_id = app_current_org() and id = ${r.id}`);
    return {
      result: { version: doc.version, verificationCode: doc.verificationCode },
      reason: input.reason.trim(),
      detail: { mode: input.mode, version: doc.version },
    };
  });
}

export async function cancelCertificate(
  deps: CertificateDeps,
  actor: Actor,
  input: { requestId: string; reason: string },
): Promise<void> {
  if (input.reason.trim().length < 3) throw new CertificateError('reason_required');
  await step(deps, actor, input.requestId, 'school.certificate.request', async (tx, r) => {
    if (['issued', 'delivered', 'cancelled', 'superseded'].includes(r.state))
      throw new CertificateError('not_cancellable');
    await tx.execute(sql`
      update school_certificate_request set state = 'cancelled', cancelled_reason = ${input.reason.trim()}
      where org_id = app_current_org() and id = ${r.id}`);
    return { result: undefined, reason: input.reason.trim(), detail: {} };
  });
}

/** The state portal's own record of the TC: its number, and that the export is done. */
export async function recordPortalExport(
  deps: CertificateDeps,
  actor: Actor,
  input: { requestId: string; externalNumber?: string | null | undefined },
): Promise<void> {
  await step(deps, actor, input.requestId, 'school.certificate.issue', async (tx, r) => {
    if (r.kind !== 'tc' || r.state !== 'issued') throw new CertificateError('not_issued');
    await tx.execute(sql`
      update school_certificate_request set portal_export_done_at = now(), external_number = ${input.externalNumber?.trim() || null}
      where org_id = app_current_org() and id = ${r.id}`);
    return { result: undefined, detail: { external: !!input.externalNumber } };
  });
}

export type CertificateSummary = {
  id: string;
  kind: Kind;
  state: string;
  studentId: string;
  student: string;
  number: string | null;
  dueBy: string | null;
  checked: boolean;
  warnings: Warning[];
  portalExportDone: boolean;
  createdAt: string;
};

/** The register: every request for an institution, newest first. */
export async function listCertificates(
  deps: CertificateDeps,
  actor: Actor,
  institutionId: string,
): Promise<CertificateSummary[]> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const i = await institutionInfo(tx, institutionId);
    if (!i) throw new CertificateError('institution_not_found');
    await deps.permissions.assertCan(tx, actor, 'school.certificate.request', {
      orgId: actor.orgId,
      place: { campusId: i.campusId, institutionId },
    });
    return [
      ...(await tx.execute<CertificateSummary>(sql`
        select r.id::text, r.kind, r.state, r.student_person_id::text as "studentId", p.legal_name as student, r.number,
          r.due_by::text as "dueBy", r.checked_at is not null as checked, r.warnings,
          r.portal_export_done_at is not null as "portalExportDone", r.created_at::text as "createdAt"
        from school_certificate_request r join person p on p.org_id = r.org_id and p.id = r.student_person_id
        where r.org_id = app_current_org() and r.institution_id = ${institutionId}
        order by r.created_at desc limit 300`)),
    ];
  });
}

export type CertificateDetail = CertificateSummary & {
  fields: [string, string][];
  leavingDate: string | null;
  leavingReason: string | null;
  purpose: string | null;
  checkedBy: string | null;
  approvedBy: string | null;
  issuedAt: string | null;
  version: number | null;
  verificationCode: string | null;
  downloadUrl: string | null;
};

export async function certificateDetail(
  deps: CertificateDeps,
  actor: Actor,
  requestId: string,
): Promise<CertificateDetail> {
  return withTenant(deps.db, actor.orgId, async (tx) => {
    const r = await loadReq(tx, requestId);
    const i = await institutionInfo(tx, r.institutionId);
    await deps.permissions.assertCan(tx, actor, 'school.certificate.request', {
      orgId: actor.orgId,
      place: { campusId: i?.campusId ?? '', institutionId: r.institutionId },
      subjectPersonId: r.studentId,
    });
    const [d] = await tx.execute<Omit<CertificateDetail, 'downloadUrl'>>(sql`
      select r.id::text, r.kind, r.state, r.student_person_id::text as "studentId", p.legal_name as student, r.number,
        r.due_by::text as "dueBy", r.checked_at is not null as checked, r.warnings, r.portal_export_done_at is not null as "portalExportDone",
        r.created_at::text as "createdAt", r.fields, r.leaving_date::text as "leavingDate", r.leaving_reason as "leavingReason",
        r.purpose, c.legal_name as "checkedBy", a.legal_name as "approvedBy", r.issued_at::text as "issuedAt",
        d.version, d.verification_code as "verificationCode"
      from school_certificate_request r
      join person p on p.org_id = r.org_id and p.id = r.student_person_id
      left join person c on c.org_id = r.org_id and c.id = r.checked_by_person_id
      left join person a on a.org_id = r.org_id and a.id = r.approved_by_person_id
      left join issued_document d on d.org_id = r.org_id and d.id = r.issued_document_id
      where r.org_id = app_current_org() and r.id = ${requestId}`);
    if (!d) throw new CertificateError('request_not_found');
    return {
      ...d,
      downloadUrl: r.documentId ? await issuedDocumentUrl(tx, deps.store, r.documentId) : null,
    };
  });
}
