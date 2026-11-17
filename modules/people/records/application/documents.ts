// Milestone 20: a person's documents in folders, with versions and verification. Staff papers
// need people.staff.documents (HR); a student's are seen by those who read the full record and
// added or checked by those who update it. Every opening of a document is audited.
import { withTenant, type Tx } from '@campusverse/db';
import { command } from '@campusverse/platform-events';
import type { Actor, Resource } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { PeopleError, personResource, type PeopleDeps } from './records.js';

export const DOCUMENT_ADDED = 'people.document.added.v1';
export const FOLDERS = [
  'identity',
  'academic',
  'qualifications',
  'employment',
  'payroll',
  'medical',
  'transfer',
  'other',
] as const;
export type Folder = (typeof FOLDERS)[number];

export type RecordDocument = {
  id: string;
  folder: Folder;
  kind: string;
  title: string;
  fileId: string;
  version: number;
  status: 'received' | 'verified' | 'rejected' | 'superseded';
  note: string | null;
  expiresOn: string | null;
  uploadedBy: string;
  uploadedAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  contentType: string;
  sizeBytes: number;
};

async function kindOf(tx: Tx, personId: string): Promise<'student' | 'staff'> {
  const [row] = await tx.execute<{ staff: boolean; student: boolean }>(sql`
    select exists (select 1 from staff_profile where org_id = app_current_org() and person_id = ${personId}) as staff,
      exists (select 1 from student_profile where org_id = app_current_org() and person_id = ${personId}) as student`);
  if (row?.staff) return 'staff';
  if (row?.student) return 'student';
  throw new PeopleError('person_not_found');
}

/** Which permission reads or changes this person's documents, and where it is checked. */
export async function documentCheck(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  mode: 'read' | 'change',
): Promise<{ permission: string; resource: Resource }> {
  const kind = await withTenant(deps.db, actor.orgId, (tx) => kindOf(tx, personId));
  const permission =
    kind === 'staff'
      ? 'people.staff.documents'
      : mode === 'read'
        ? 'people.student.read_full'
        : 'people.student.update';
  return { permission, resource: await personResource(deps, actor, permission, personId, kind) };
}

export async function listDocuments(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
): Promise<{ documents: RecordDocument[]; canChange: boolean }> {
  const read = await documentCheck(deps, actor, personId, 'read');
  const change = await documentCheck(deps, actor, personId, 'change');
  return withTenant(deps.db, actor.orgId, async (tx) => {
    await deps.permissions.assertCan(tx, actor, read.permission, read.resource);
    const documents = await tx.execute<RecordDocument>(sql`
      select d.id::text, d.folder, d.kind, d.title, d.file_id::text as "fileId", d.version, d.status, d.note,
        d.expires_on::text as "expiresOn", d.uploaded_by_person_id::text as "uploadedBy",
        d.uploaded_at::text as "uploadedAt", d.checked_by_person_id::text as "checkedBy",
        d.checked_at::text as "checkedAt", f.content_type as "contentType", f.size_bytes::int as "sizeBytes"
      from record_document d join stored_file f on f.org_id = d.org_id and f.id = d.file_id
      where d.org_id = app_current_org() and d.person_id = ${personId}
      order by d.folder, d.kind, d.version desc`);
    return {
      documents: [...documents],
      canChange: (await deps.permissions.can(tx, actor, change.permission, change.resource))
        .allowed,
    };
  });
}

/**
 * Files a stored, scanned-or-scanning file into a folder. The same kind again is a new version;
 * the previous one is kept, marked superseded.
 */
export async function addDocument(
  deps: PeopleDeps,
  actor: Actor,
  personId: string,
  input: { folder: Folder; kind: string; title: string; fileId: string; expiresOn?: string | null },
): Promise<string> {
  const check = await documentCheck(deps, actor, personId, 'change');
  return command(deps.db, deps.permissions, actor, check, async (tx) => {
    const [prev] = await tx.execute<{ v: number }>(sql`
      select coalesce(max(version), 0)::int as v from record_document
      where org_id = app_current_org() and person_id = ${personId} and kind = ${input.kind}`);
    const version = (prev?.v ?? 0) + 1;
    await tx.execute(sql`
      update record_document set status = 'superseded'
      where org_id = app_current_org() and person_id = ${personId} and kind = ${input.kind} and status <> 'superseded'`);
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into record_document (org_id, person_id, folder, kind, title, file_id, version, expires_on, uploaded_by_person_id)
      values (app_current_org(), ${personId}, ${input.folder}, ${input.kind}, ${input.title.trim()}, ${input.fileId},
        ${version}, ${input.expiresOn ?? null}::date, ${actor.personId})
      returning id::text`);
    if (!row) throw new Error('addDocument: insert returned no row');
    return {
      result: row.id,
      audit: {
        action: 'people.document.add',
        entityType: 'person',
        entityId: personId,
        dataClass: 'personal',
        detail: { documentId: row.id, folder: input.folder, kind: input.kind, version },
      },
      events: [{ type: DOCUMENT_ADDED, payload: { personId, documentId: row.id } }],
    };
  });
}

/** Marks a document checked: verified, or rejected with a reason. */
export async function checkDocument(
  deps: PeopleDeps,
  actor: Actor,
  documentId: string,
  input: { status: 'verified' | 'rejected'; note?: string | null },
): Promise<void> {
  if (input.status === 'rejected' && !input.note?.trim()) throw new PeopleError('reason_required');
  const personId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [d] = await tx.execute<{ p: string }>(sql`
      select person_id::text as p from record_document where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new PeopleError('document_not_found');
    return d.p;
  });
  const check = await documentCheck(deps, actor, personId, 'change');
  await command(deps.db, deps.permissions, actor, check, async (tx) => {
    const r = await tx.execute(sql`
      update record_document set status = ${input.status}, note = ${input.note?.trim() || null},
        checked_by_person_id = ${actor.personId}, checked_at = now()
      where org_id = app_current_org() and id = ${documentId} and status <> 'superseded'`);
    if (r.count === 0) throw new PeopleError('document_not_found');
    return {
      result: undefined,
      audit: {
        action: `people.document.${input.status === 'verified' ? 'verify' : 'reject'}`,
        entityType: 'person',
        entityId: personId,
        dataClass: 'personal',
        ...(input.note?.trim() ? { reason: input.note.trim() } : {}),
        detail: { documentId },
      },
    };
  });
}

/** Opening a document: checked, then audited as a read, then the caller serves the bytes. */
export async function openDocument(
  deps: PeopleDeps,
  actor: Actor,
  documentId: string,
): Promise<{ fileId: string; title: string }> {
  const personId = await withTenant(deps.db, actor.orgId, async (tx) => {
    const [d] = await tx.execute<{ p: string }>(sql`
      select person_id::text as p from record_document where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new PeopleError('document_not_found');
    return d.p;
  });
  const check = await documentCheck(deps, actor, personId, 'read');
  return command(deps.db, deps.permissions, actor, check, async (tx) => {
    const [d] = await tx.execute<{ fileId: string; title: string }>(sql`
      select file_id::text as "fileId", title from record_document
      where org_id = app_current_org() and id = ${documentId}`);
    if (!d) throw new PeopleError('document_not_found');
    return {
      result: d,
      audit: {
        action: 'people.document.read',
        entityType: 'person',
        entityId: personId,
        dataClass: 'personal',
        detail: { documentId },
      },
    };
  });
}

/**
 * Inside another module's command (admissions enrolment, which has checked its own permission
 * and writes the audit row): files a document into a person's folder as it stood there.
 */
export async function fileDocument(
  tx: Tx,
  input: {
    personId: string;
    folder: Folder;
    kind: string;
    title: string;
    fileId: string;
    uploadedBy: string;
    uploadedAt: string;
    status: 'received' | 'verified' | 'rejected';
    note: string | null;
    checkedBy: string | null;
    checkedAt: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into record_document (org_id, person_id, folder, kind, title, file_id, status, note,
      uploaded_by_person_id, uploaded_at, checked_by_person_id, checked_at)
    values (app_current_org(), ${input.personId}, ${input.folder}, ${input.kind}, ${input.title}, ${input.fileId},
      ${input.status}, ${input.note}, ${input.uploadedBy}, ${input.uploadedAt}::timestamptz, ${input.checkedBy},
      ${input.checkedAt}::timestamptz)
    on conflict (org_id, person_id, kind, version) do nothing`);
}

/** Staff papers waiting for a check, by folder: counts only. Call inside the tenant, after the HR check. */
export async function staffDocumentsAwaitingCheck(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx.execute<{ folder: string; n: number }>(sql`
    select d.folder, count(*)::int as n from record_document d
    join staff_profile s on s.org_id = d.org_id and s.person_id = d.person_id
    where d.org_id = app_current_org() and d.status = 'received' and s.status <> 'left'
    group by d.folder`);
  return Object.fromEntries(rows.map((r) => [r.folder, r.n]));
}
