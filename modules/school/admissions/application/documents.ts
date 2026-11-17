// Milestone 21: an applicant's photo and papers, collected during admission and checked by the
// admissions office; on enrolment they move to the student's record (admissions.ts).
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import { placeOf } from '@campusverse/platform-organisation';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { AdmissionError, type AdmissionsDeps } from './admissions.js';

const MANAGE = 'school.admission.manage';
export type ApplicantFolder = 'identity' | 'academic' | 'medical' | 'transfer' | 'other';

export type ApplicantDocument = {
  id: string;
  folder: ApplicantFolder;
  kind: string;
  title: string;
  fileId: string;
  status: 'received' | 'verified' | 'rejected';
  note: string | null;
  uploadedBy: string;
  uploadedAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  contentType: string;
  sizeBytes: number;
};

async function institutionOf(tx: Tx, applicationId: string): Promise<string> {
  const [a] = await tx.execute<{ i: string }>(sql`
    select institution_id::text as i from school_application where org_id = app_current_org() and id = ${applicationId}`);
  if (!a) throw new AdmissionError('application_not_found');
  return a.i;
}

/** Where an application's papers are checked: its institution, for admissions managers. */
export async function applicationCheck(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<{ permission: string; resource: Resource }> {
  const place = await withTenant(deps.db, actor.orgId, async (tx) =>
    placeOf(tx, await institutionOf(tx, applicationId)),
  );
  if (!place) throw new AdmissionError('application_not_found');
  return { permission: MANAGE, resource: { orgId: actor.orgId, place } };
}

export async function applicationDocuments(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<ApplicantDocument[]> {
  const check = await applicationCheck(deps, actor, applicationId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, check.permission, check.resource);
    return [
      ...(await tx.execute<ApplicantDocument>(sql`
        select d.id::text, d.folder, d.kind, d.title, d.file_id::text as "fileId", d.status, d.note,
          d.uploaded_by_person_id::text as "uploadedBy", d.uploaded_at::text as "uploadedAt",
          d.checked_by_person_id::text as "checkedBy", d.checked_at::text as "checkedAt",
          f.content_type as "contentType", f.size_bytes::int as "sizeBytes"
        from school_application_document d join stored_file f on f.org_id = d.org_id and f.id = d.file_id
        where d.org_id = app_current_org() and d.application_id = ${applicationId}
        order by d.uploaded_at desc`)),
    ];
  });
}

export async function addApplicationDocument(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
  input: { folder: ApplicantFolder; kind: string; title: string; fileId: string },
): Promise<string> {
  const check = await applicationCheck(deps, actor, applicationId);
  return command(deps.db, deps.permissions, actor, check, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into school_application_document (org_id, application_id, folder, kind, title, file_id, uploaded_by_person_id)
      values (app_current_org(), ${applicationId}, ${input.folder}, ${input.kind}, ${input.title.trim()}, ${input.fileId}, ${actor.personId})
      returning id::text`);
    if (!row) throw new Error('addApplicationDocument: no row');
    return {
      result: row.id,
      audit: {
        action: 'school.admission.add_document',
        entityType: 'school_application',
        entityId: applicationId,
        dataClass: 'personal',
        detail: { documentId: row.id, kind: input.kind },
      },
    };
  });
}

export async function checkApplicationDocument(
  deps: AdmissionsDeps,
  actor: Actor,
  documentId: string,
  input: { status: 'verified' | 'rejected'; note?: string | null },
): Promise<void> {
  if (input.status === 'rejected' && !input.note?.trim())
    throw new AdmissionError('reason_required');
  const applicationId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [d] = await tx.execute<{ a: string }>(sql`
      select application_id::text as a from school_application_document where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new AdmissionError('document_not_found');
    return d.a;
  });
  const check = await applicationCheck(deps, actor, applicationId);
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    await tx.execute(sql`
      update school_application_document set status = ${input.status}, note = ${input.note?.trim() || null},
        checked_by_person_id = ${actor.personId}, checked_at = now()
      where org_id = app_current_org() and id = ${documentId}`);
    return {
      result: undefined,
      audit: {
        action: `school.admission.${input.status === 'verified' ? 'verify' : 'reject'}_document`,
        entityType: 'school_application',
        entityId: applicationId,
        dataClass: 'personal',
        ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
        detail: { documentId },
      },
    };
  });
}

/** Opening an applicant's paper: checked, audited as a read, then served by the caller. */
export async function openApplicationDocument(
  deps: AdmissionsDeps,
  actor: Actor,
  documentId: string,
): Promise<{ fileId: string }> {
  const applicationId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [d] = await tx.execute<{ a: string }>(sql`
      select application_id::text as a from school_application_document where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new AdmissionError('document_not_found');
    return d.a;
  });
  const check = await applicationCheck(deps, actor, applicationId);
  return command(deps.db, deps.permissions, actor, check, async (tx) => {
    const [d] = await tx.execute<{ fileId: string }>(sql`
      select file_id::text as "fileId" from school_application_document where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new AdmissionError('document_not_found');
    return {
      result: d,
      audit: {
        action: 'school.admission_document.read',
        entityType: 'school_application',
        entityId: applicationId,
        dataClass: 'personal',
        detail: { documentId },
      },
    };
  });
}

export async function setApplicationPhoto(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
  fileId: string | null,
): Promise<void> {
  const check = await applicationCheck(deps, actor, applicationId);
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    await tx.execute(sql`
      update school_application set photo_file_id = ${fileId}, updated_at = now()
      where org_id = app_current_org() and id = ${applicationId}`);
    return {
      result: undefined,
      audit: {
        action: 'school.admission.set_photo',
        entityType: 'school_application',
        entityId: applicationId,
        dataClass: 'personal',
        detail: { fileId },
      },
    };
  });
}

/** The applicant's photo file, for admissions managers. */
export async function applicationPhoto(
  deps: AdmissionsDeps,
  actor: Actor,
  applicationId: string,
): Promise<string | null> {
  const check = await applicationCheck(deps, actor, applicationId);
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, check.permission, check.resource);
    const [r] = await tx.execute<{ f: string | null }>(sql`
      select photo_file_id::text as f from school_application where org_id = app_current_org() and id = ${applicationId}`);
    return r?.f ?? null;
  });
}
