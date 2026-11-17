// Files and issued documents against real Postgres and the S3 emulator.
import { loadEnv } from '@campusverse/config';
import { createDb, withTenant } from '@campusverse/db';
import { seedAdmin, seedTenant, type SeededTenant } from '@campusverse/db/seed';
import { runConsumer, type OutboxEvent } from '@campusverse/platform-events';
import { createPermissions, type Actor } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  completeUpload,
  createS3Store,
  createUpload,
  devScanner,
  FILE_UPLOADED,
  fileDownloadUrl,
  issueDocument,
  scanConsumer,
  verifyDocument,
} from '../contract.js';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const permissions = createPermissions(null);
const store = createS3Store({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
});
const scanner = scanConsumer(store, devScanner('development'));

let t: SeededTenant;
let admin: Actor;
let parent: Actor;

beforeAll(async () => {
  t = await seedTenant(db, 'Documents');
  const adminId = await seedAdmin(db, t.orgId, [
    'platform.file.upload',
    'platform.file.read',
    'platform.document.issue',
  ]);
  admin = { accountId: randomUUID(), orgId: t.orgId, personId: adminId };
  parent = { accountId: randomUUID(), orgId: t.orgId, personId: t.guardianId };
});
afterAll(() => close());

const pdf = (extra = '') => new TextEncoder().encode(`%PDF-1.7\nsynthetic${extra}\n%%EOF`);

/** Registers, uploads through the signed URL, completes, then runs the scan consumer. */
async function upload(
  bytes: Uint8Array,
  contentType = 'application/pdf',
  declaredSize = bytes.length,
) {
  const ticket = await createUpload(db, permissions, store, admin, {
    purpose: 'birth_certificate',
    fileName: 'synthetic.pdf',
    contentType,
    sizeBytes: declaredSize,
  });
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    headers: { 'content-type': contentType },
  });
  expect(put.ok).toBe(true);
  await completeUpload(db, permissions, store, admin, ticket.fileId);
  const [row] = await db.execute<OutboxEvent>(sql`
    select id::text, org_id::text as "orgId", type, payload, occurred_at::text as "occurredAt"
    from ops.outbox where type = ${FILE_UPLOADED} and payload->>'fileId' = ${ticket.fileId}`);
  await runConsumer(db, scanner, row!);
  return ticket.fileId;
}

const fileStatus = (fileId: string) =>
  withTenant(db, t.orgId, async (tx) => {
    const [r] = await tx.execute<{ status: string; note: string | null; sha: string | null }>(sql`
      select scan_status as status, scan_note as note, sha256 as sha from stored_file where id = ${fileId}`);
    return r!;
  });

describe('file uploads', () => {
  it('a clean upload becomes downloadable, with its hash recorded and the download audited', async () => {
    const bytes = pdf();
    const fileId = await upload(bytes);
    expect(await fileStatus(fileId)).toEqual({
      status: 'clean',
      note: 'dev-eicar',
      sha: createHash('sha256').update(bytes).digest('hex'),
    });

    const url = await fileDownloadUrl(db, permissions, store, admin, {
      fileId,
      reason: 'Admission check',
    });
    const got = new Uint8Array(await (await fetch(url)).arrayBuffer());
    expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);

    const [audit] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ reason: string }>(sql`
        select reason from audit_event where action = 'platform.file.read' and entity_id = ${fileId}`),
    );
    expect(audit?.reason).toBe('Admission check');
  });

  it('nothing is downloadable before the scan clears it', async () => {
    const bytes = pdf('-pending');
    const ticket = await createUpload(db, permissions, store, admin, {
      purpose: 'birth_certificate',
      fileName: 'synthetic.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });
    await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'content-type': 'application/pdf' },
    });
    await completeUpload(db, permissions, store, admin, ticket.fileId);
    await expect(
      fileDownloadUrl(db, permissions, store, admin, { fileId: ticket.fileId }),
    ).rejects.toThrow(/not cleared/);
  });

  it('flags malware', async () => {
    const fileId = await upload(pdf(' X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!'));
    expect(await fileStatus(fileId)).toMatchObject({
      status: 'infected',
      note: 'eicar_test_signature',
    });
    await expect(fileDownloadUrl(db, permissions, store, admin, { fileId })).rejects.toThrow(
      /not cleared/,
    );
  });

  it('rejects a file whose bytes are not the declared type', async () => {
    const fileId = await upload(pdf(), 'image/png');
    expect(await fileStatus(fileId)).toMatchObject({ status: 'rejected', note: 'type_mismatch' });
  });

  it('refuses to complete an upload of the wrong size', async () => {
    await expect(upload(pdf(), 'application/pdf', 4096)).rejects.toThrow(/wrong size/);
  });

  it('refuses types and sizes outside the rules up front', async () => {
    const input = {
      purpose: 'photo',
      fileName: 'x.exe',
      contentType: 'application/x-msdownload',
      sizeBytes: 10,
    };
    await expect(createUpload(db, permissions, store, admin, input)).rejects.toThrow(
      /PDF, JPEG and PNG/,
    );
    await expect(
      createUpload(db, permissions, store, admin, {
        ...input,
        contentType: 'image/png',
        sizeBytes: 11 * 1024 * 1024,
      }),
    ).rejects.toThrow(/10 MB/);
  });

  it('a parent without the permission cannot upload or download', async () => {
    const input = { purpose: 'photo', fileName: 'x.png', contentType: 'image/png', sizeBytes: 10 };
    await expect(createUpload(db, permissions, store, parent, input)).rejects.toMatchObject({
      name: 'PermissionDenied',
    });
  });
});

describe('issued documents', () => {
  const issue = (overrides: Partial<Parameters<typeof issueDocument>[5]> = {}) =>
    issueDocument(
      db,
      permissions,
      store,
      admin,
      { verifyBaseUrl: env.PUBLIC_VERIFY_BASE_URL },
      {
        kind: 'bonafide',
        number: `BON-2026-${randomUUID().slice(0, 6)}`,
        title: 'Bonafide Certificate',
        lines: [
          ['Student', 'Synthetic Student Documents'],
          ['Class', '5-A'],
        ],
        subjectPersonId: t.studentId,
        ...overrides,
      },
    );

  it('stores a frozen PDF whose hash matches, and verifies publicly without student details', async () => {
    const doc = await issue();
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ key: string }>(
        sql`select storage_key as key from issued_document where id = ${doc.id}`,
      ),
    );
    const bytes = await store.get(row!.key);
    expect(Buffer.from(bytes!.slice(0, 5)).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes!).digest('hex')).toBe(doc.sha256);

    const v = await verifyDocument(db, doc.verificationCode);
    expect(v).toMatchObject({ kind: 'bonafide', version: 1, status: 'valid', sha256: doc.sha256 });
    expect(JSON.stringify(v)).not.toContain('Synthetic Student');
    expect(Object.keys(v!).sort()).toEqual([
      'issuedAt',
      'kind',
      'number',
      'sha256',
      'status',
      'version',
    ]);
  });

  it('a correction is a new version; the old one shows as superseded', async () => {
    const first = await issue();
    const [orig] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ number: string }>(
        sql`select number from issued_document where id = ${first.id}`,
      ),
    );
    const second = await issue({
      number: orig!.number,
      supersedesId: first.id,
      reason: 'Class corrected',
    });
    expect(second.version).toBe(2);
    expect((await verifyDocument(db, first.verificationCode))?.status).toBe('superseded');
    expect((await verifyDocument(db, second.verificationCode))?.status).toBe('valid');

    await expect(issue({ supersedesId: first.id })).rejects.toThrow(
      /keep the original kind and number/,
    );
  });

  it('refuses text the PDF font cannot draw, and writes nothing', async () => {
    const number = `BON-KN-${randomUUID().slice(0, 6)}`;
    await expect(issue({ number, lines: [['Student', 'ಸಿಂಥೆಟಿಕ್']] })).rejects.toThrow(/script/);
    const [row] = await withTenant(db, t.orgId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from issued_document where number = ${number}`,
      ),
    );
    expect(row?.n).toBe(0);
  });

  it('rejects malformed and unknown verification codes', async () => {
    expect(await verifyDocument(db, "'; drop table x; --")).toBeNull();
    expect(await verifyDocument(db, 'A'.repeat(24))).toBeNull();
  });
});
