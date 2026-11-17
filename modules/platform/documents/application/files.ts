import { withTenant, type Db, type Tx } from '@campusverse/db';
import { command, type Consumer } from '@campusverse/platform-events';
import type { Actor, Resource, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { contentMatches, isAllowedType, MAX_BYTES, type AllowedType } from '../domain/files.js';
import type { ObjectStore } from '../infrastructure/store.js';

type Permissions = ReturnType<typeof createPermissions>;

export const FILE_UPLOADED = 'platform.file.uploaded.v1';
const UPLOAD_TTL_SECONDS = 10 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/** Malware scanner adapter: GuardDuty in AWS (infrastructure/guardduty.ts), devScanner locally. */
export type Scanner = {
  name: string;
  scan(bytes: Uint8Array, key: string): Promise<{ clean: boolean; note?: string }>;
};

/**
 * Development only: catches the EICAR test file and nothing else. Refuses to exist in
 * production, so a real scanner can't be skipped by accident.
 */
export function devScanner(appEnv: 'development' | 'test' | 'production'): Scanner {
  if (appEnv === 'production') throw new Error('devScanner cannot run in production');
  const eicar = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
  return {
    name: 'dev-eicar',
    scan: async (bytes) => {
      const found = Buffer.from(bytes).includes(eicar);
      return found ? { clean: false, note: 'eicar_test_signature' } : { clean: true };
    },
  };
}

export type UploadTicket = { fileId: string; uploadUrl: string; headers: Record<string, string> };

/** Registers a file and returns a signed URL the browser or phone uploads to directly. */
export async function createUpload(
  db: Db,
  permissions: Permissions,
  store: ObjectStore,
  actor: Actor,
  input: { purpose: string; fileName: string; contentType: string; sizeBytes: number },
): Promise<UploadTicket> {
  if (!isAllowedType(input.contentType))
    throw new Error('Only PDF, JPEG and PNG files are accepted');
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
    throw new Error('Files must be between 1 byte and 10 MB');
  }
  const key = `${actor.orgId}/files/${randomUUID()}`;
  const fileId = await command(
    db,
    permissions,
    actor,
    { permission: 'platform.file.upload', resource: { orgId: actor.orgId } },
    async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into stored_file (org_id, purpose, file_name, content_type, size_bytes,
          storage_key, created_by_account_id)
        values (app_current_org(), ${input.purpose}, ${input.fileName}, ${input.contentType},
          ${input.sizeBytes}, ${key}, ${actor.accountId})
        returning id::text`);
      if (!row) throw new Error('createUpload: insert returned no row');
      return {
        result: row.id,
        audit: {
          action: 'platform.file.upload',
          entityType: 'stored_file',
          entityId: row.id,
          dataClass: 'personal',
          detail: {
            purpose: input.purpose,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
          },
        },
      };
    },
  );
  return {
    fileId,
    uploadUrl: await store.signedUpload(
      key,
      input.contentType,
      input.sizeBytes,
      UPLOAD_TTL_SECONDS,
    ),
    headers: { 'content-type': input.contentType, 'content-length': String(input.sizeBytes) },
  };
}

/** Called once the upload finishes. Queues the scan; the file stays unreadable until it is clean. */
export async function completeUpload(
  db: Db,
  permissions: Permissions,
  store: ObjectStore,
  actor: Actor,
  fileId: string,
): Promise<void> {
  await command(
    db,
    permissions,
    actor,
    { permission: 'platform.file.upload', resource: { orgId: actor.orgId } },
    async (tx) => {
      const [file] = await tx.execute<{ key: string; size: number }>(sql`
        select storage_key as key, size_bytes::int as size from stored_file
        where org_id = app_current_org() and id = ${fileId} and scan_status = 'awaiting_upload'
          and created_by_account_id = ${actor.accountId}
        for update`);
      if (!file) throw new Error('completeUpload: no upload awaiting completion');
      if ((await store.size(file.key)) !== file.size)
        throw new Error('completeUpload: file missing or wrong size');
      await tx.execute(sql`
        update stored_file set scan_status = 'pending', uploaded_at = now()
        where org_id = app_current_org() and id = ${fileId}`);
      return {
        result: undefined,
        audit: {
          action: 'platform.file.upload',
          entityType: 'stored_file',
          entityId: fileId,
          dataClass: 'personal',
        },
        events: [{ type: FILE_UPLOADED, payload: { fileId } }],
      };
    },
  );
}

/** Scans every pending upload event. Repeat-safe: only a still-pending file is updated. */
export function scanConsumer(store: ObjectStore, scanner: Scanner): Consumer {
  return {
    name: 'documents.scan',
    queue: 'documents',
    events: [FILE_UPLOADED],
    afterCommit: async (db, event) => {
      const fileId = String(event.payload.fileId);
      const file = await withTenant(db, event.orgId, async (tx) => {
        const [row] = await tx.execute<{ key: string; size: number; type: string }>(sql`
          select storage_key as key, size_bytes::int as size, content_type as type
          from stored_file where org_id = app_current_org() and id = ${fileId} and scan_status = 'pending'`);
        return row ?? null;
      });
      if (!file) return;

      const bytes = await store.get(file.key);
      let status: 'clean' | 'infected' | 'rejected';
      let note: string | null = null;
      if (!bytes || bytes.length !== file.size) [status, note] = ['rejected', 'size_mismatch'];
      else if (!contentMatches(file.type as AllowedType, bytes))
        [status, note] = ['rejected', 'type_mismatch'];
      else {
        const result = await scanner.scan(bytes, file.key);
        status = result.clean ? 'clean' : 'infected';
        note = result.note ?? scanner.name;
      }
      const sha = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
      await withTenant(db, event.orgId, (tx) =>
        tx.execute(sql`
          update stored_file set scan_status = ${status}, scan_note = ${note}, sha256 = ${sha},
            scanned_at = now()
          where org_id = app_current_org() and id = ${fileId} and scan_status = 'pending'`),
      );
    },
  };
}

/** A five-minute download link, only for clean files. Every download is audited. */
export async function fileDownloadUrl(
  db: Db,
  permissions: Permissions,
  store: ObjectStore,
  actor: Actor,
  input: { fileId: string; subjectPersonId?: string; reason?: string },
): Promise<string> {
  const file = await command(
    db,
    permissions,
    actor,
    {
      permission: 'platform.file.read',
      resource: {
        orgId: actor.orgId,
        ...(input.subjectPersonId ? { subjectPersonId: input.subjectPersonId } : {}),
      },
    },
    async (tx) => {
      const [row] = await tx.execute<{ key: string; name: string }>(sql`
        select storage_key as key, file_name as name from stored_file
        where org_id = app_current_org() and id = ${input.fileId} and scan_status = 'clean'`);
      if (!row) throw new Error('fileDownloadUrl: file not found or not cleared by the scan');
      return {
        result: row,
        audit: {
          action: 'platform.file.read',
          entityType: 'stored_file',
          entityId: input.fileId,
          dataClass: 'personal',
          ...(input.reason ? { reason: input.reason } : {}),
        },
      };
    },
  );
  return store.signedDownload(file.key, file.name, DOWNLOAD_TTL_SECONDS);
}

/**
 * A five-minute link to a clean file the caller has already decided this person may see (as for
 * cleanFileBytes), for apps that open files outside the page, such as a PDF on a phone.
 */
export async function cleanFileLink(
  db: Db,
  store: ObjectStore,
  orgId: string,
  fileId: string,
): Promise<string> {
  const file = await withTenant(db, orgId, async (tx) => {
    const [row] = await tx.execute<{ key: string; name: string }>(sql`
      select storage_key as key, file_name as name from stored_file
      where org_id = app_current_org() and id = ${fileId} and scan_status = 'clean'`);
    return row ?? null;
  });
  if (!file) throw new FileRefused('file_not_ready');
  return store.signedDownload(file.key, file.name, DOWNLOAD_TTL_SECONDS);
}

export class FileRefused extends Error {
  constructor(readonly code: 'file_type' | 'file_size' | 'file_not_ready') {
    super(`documents: ${code}`);
    this.name = 'FileRefused';
  }
}

/**
 * Stores bytes the API received (photos, logos, documents): checked for type and size here,
 * written to private storage, then scanned by the worker before anyone can read them. Runs under
 * the caller's own permission (who may change this photo or record), not a generic upload right.
 */
export async function storeFile(
  db: Db,
  permissions: Permissions,
  store: ObjectStore,
  actor: Actor,
  check: { permission: string; resource: Resource },
  input: { purpose: string; fileName: string; contentType: string; bytes: Uint8Array },
): Promise<string> {
  if (!isAllowedType(input.contentType) || !contentMatches(input.contentType, input.bytes))
    throw new FileRefused('file_type');
  if (input.bytes.length === 0 || input.bytes.length > MAX_BYTES)
    throw new FileRefused('file_size');
  const key = `${actor.orgId}/files/${randomUUID()}`;
  // Stored before the row exists: an orphan object is harmless, a row without bytes is not.
  await store.put(key, input.bytes, input.contentType);
  return command(db, permissions, actor, check, async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into stored_file (org_id, purpose, file_name, content_type, size_bytes, storage_key,
        scan_status, created_by_account_id, uploaded_at)
      values (app_current_org(), ${input.purpose}, ${input.fileName.slice(0, 200) || 'file'},
        ${input.contentType}, ${input.bytes.length}, ${key}, 'pending', ${actor.accountId}, now())
      returning id::text`);
    if (!row) throw new Error('storeFile: insert returned no row');
    return {
      result: row.id,
      audit: {
        action: 'platform.file.store',
        entityType: 'stored_file',
        entityId: row.id,
        dataClass: 'personal',
        detail: {
          purpose: input.purpose,
          contentType: input.contentType,
          sizeBytes: input.bytes.length,
        },
      },
      events: [{ type: FILE_UPLOADED, payload: { fileId: row.id } }],
    };
  });
}

export type FileState = 'pending' | 'clean' | 'infected' | 'rejected' | 'awaiting_upload';

/** A file's scan state, for "Checking the file…" while the scanner runs. Call inside the tenant. */
export async function fileState(tx: Tx, fileId: string): Promise<FileState | null> {
  const [row] = await tx.execute<{ s: FileState }>(sql`
    select scan_status as s from stored_file where org_id = app_current_org() and id = ${fileId}`);
  return row?.s ?? null;
}

export type FileInfo = { fileId: string; fileName: string; contentType: string; state: FileState };

/** Name, type and scan state of files, for listing attachments. Call inside the tenant. */
export async function filesInfo(tx: Tx, fileIds: string[]): Promise<FileInfo[]> {
  if (fileIds.length === 0) return [];
  return [
    ...(await tx.execute<FileInfo>(sql`
      select id::text as "fileId", file_name as "fileName", content_type as "contentType", scan_status as state
      from stored_file where org_id = app_current_org() and id = any(${`{${fileIds.join(',')}}`}::uuid[])`)),
  ];
}

/**
 * The bytes of a clean file, for showing a photo or logo the caller has already decided this
 * person may see. Never returns a file still being scanned or refused by the scan.
 */
export async function cleanFileBytes(
  db: Db,
  store: ObjectStore,
  orgId: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  const file = await withTenant(db, orgId, async (tx) => {
    const [row] = await tx.execute<{ key: string; type: string; name: string }>(sql`
      select storage_key as key, content_type as type, file_name as name from stored_file
      where org_id = app_current_org() and id = ${fileId} and scan_status = 'clean'`);
    return row ?? null;
  });
  if (!file) throw new FileRefused('file_not_ready');
  const bytes = await store.get(file.key);
  if (!bytes) throw new FileRefused('file_not_ready');
  return { bytes, contentType: file.type, fileName: file.name };
}
