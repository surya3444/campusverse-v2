import type { Db, Tx } from '@campusverse/db';
import { command, emit } from '@campusverse/platform-events';
import type { Actor, createPermissions } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { printableLatin } from '../domain/files.js';
import type { ObjectStore } from '../infrastructure/store.js';

type Permissions = ReturnType<typeof createPermissions>;

export const DOCUMENT_ISSUED = 'platform.document.issued.v1';

export type DocumentInput = {
  kind: string;
  number: string;
  title: string;
  /** Label and value rows, already formatted for print. */
  lines: [string, string][];
  subjectPersonId?: string;
  /** Issue a corrected version of this document; it keeps the number and gains a version. */
  supersedesId?: string;
  reason?: string;
};

export type IssuedDocument = {
  id: string;
  version: number;
  sha256: string;
  verificationCode: string;
};

const NAVY = rgb(4 / 255, 38 / 255, 109 / 255);

async function renderPdf(
  input: DocumentInput,
  version: number,
  verifyUrl: string,
): Promise<Uint8Array> {
  const texts = [input.title, input.number, ...input.lines.flat()];
  if (!texts.every(printableLatin)) {
    throw new Error('Document text uses a script the PDF fonts cannot draw yet (Milestone 12)');
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.title} ${input.number}`);
  pdf.setProducer('Campusverse');
  pdf.setCreator('Campusverse');
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText(input.title, { x: 56, y: 770, size: 20, font: bold, color: NAVY });
  const ref = version > 1 ? `${input.number}  (version ${version})` : input.number;
  page.drawText(`No. ${ref}`, { x: 56, y: 744, size: 11, font: regular });

  let y = 700;
  for (const [label, value] of input.lines) {
    page.drawText(label, { x: 56, y, size: 11, font: bold });
    page.drawText(value, { x: 220, y, size: 11, font: regular, maxWidth: 320 });
    y -= 22;
  }

  const qr = await pdf.embedPng(
    await QRCode.toBuffer(verifyUrl, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    }),
  );
  page.drawImage(qr, { x: 56, y: 72, width: 96, height: 96 });
  page.drawText('Scan to verify this document', { x: 164, y: 120, size: 10, font: regular });
  page.drawText(verifyUrl, { x: 164, y: 104, size: 8, font: regular, color: NAVY });
  return pdf.save();
}

/**
 * The issuing step, inside the caller's transaction (a certificate numbers, issues and closes the
 * enrolment in one go). Renders once, hashes, stores privately, registers the QR code. The row can
 * never change; a correction is a new version that supersedes it. The caller checks permission.
 */
export async function issueDocumentIn(
  tx: Tx,
  store: ObjectStore,
  actor: Actor,
  opts: { verifyBaseUrl: string },
  input: DocumentInput,
): Promise<IssuedDocument> {
  let version = 1;
  if (input.supersedesId) {
    const [old] = await tx.execute<{ version: number; number: string; kind: string }>(sql`
      select version, number, kind from issued_document
      where org_id = app_current_org() and id = ${input.supersedesId}`);
    if (!old || old.kind !== input.kind || old.number !== input.number) {
      throw new Error('issueDocument: a correction must keep the original kind and number');
    }
    version = old.version + 1;
  }

  const code = randomBytes(18).toString('base64url');
  const bytes = await renderPdf(input, version, `${opts.verifyBaseUrl.replace(/\/$/, '')}/${code}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `${actor.orgId}/documents/${randomUUID()}.pdf`;
  // Stored before commit: if the transaction then fails, an unreferenced object is left, never a row without a file.
  await store.put(key, bytes, 'application/pdf');

  const [row] = await tx.execute<{ id: string; issuedAt: string }>(sql`
    insert into issued_document (org_id, kind, number, version, supersedes_id,
      subject_person_id, sha256, storage_key, verification_code, issued_by_account_id)
    values (app_current_org(), ${input.kind}, ${input.number}, ${version},
      ${input.supersedesId ?? null}, ${input.subjectPersonId ?? null}, ${sha256}, ${key},
      ${code}, ${actor.accountId})
    returning id::text, issued_at::text as "issuedAt"`);
  if (!row) throw new Error('issueDocument: insert returned no row');

  if (input.supersedesId) {
    await tx.execute(sql`
      update ops.document_verification set status = 'superseded', status_changed_at = now()
      where org_id = ${actor.orgId} and document_id = ${input.supersedesId} and status = 'valid'`);
  }
  await tx.execute(sql`
    insert into ops.document_verification
      (code, org_id, document_id, kind, number, version, sha256, issued_at)
    values (${code}, ${actor.orgId}, ${row.id}, ${input.kind}, ${input.number}, ${version},
      ${sha256}, ${row.issuedAt}::timestamptz)`);
  await emit(tx, {
    type: DOCUMENT_ISSUED,
    payload: { documentId: row.id, kind: input.kind, version },
  });
  return { id: row.id, version, sha256, verificationCode: code };
}

/** Issues a frozen PDF as its own use case: permission, the issue, and the audit row. */
export async function issueDocument(
  db: Db,
  permissions: Permissions,
  store: ObjectStore,
  actor: Actor,
  opts: { verifyBaseUrl: string },
  input: DocumentInput,
): Promise<IssuedDocument> {
  return command(
    db,
    permissions,
    actor,
    {
      permission: 'platform.document.issue',
      resource: {
        orgId: actor.orgId,
        ...(input.subjectPersonId ? { subjectPersonId: input.subjectPersonId } : {}),
      },
    },
    async (tx) => {
      const issued = await issueDocumentIn(tx, store, actor, opts, input);
      return {
        result: issued,
        audit: {
          action: 'platform.document.issue',
          entityType: 'issued_document',
          entityId: issued.id,
          dataClass: 'personal',
          ...(input.reason ? { reason: input.reason } : {}),
          detail: { kind: input.kind, number: input.number, version: issued.version },
        },
      };
    },
  );
}

/** A short-lived download link for an issued document's frozen PDF. The caller checks permission. */
export async function issuedDocumentUrl(
  tx: Tx,
  store: ObjectStore,
  documentId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{
    key: string;
    kind: string;
    number: string;
    version: number;
  }>(sql`
    select storage_key as key, kind, number, version from issued_document
    where org_id = app_current_org() and id = ${documentId}`);
  if (!row) return null;
  const name = `${row.kind}-${row.number.replace(/[^\w-]+/g, '-')}${row.version > 1 ? `-v${row.version}` : ''}.pdf`;
  return store.signedDownload(row.key, name, 300);
}

export type Verification = {
  kind: string;
  number: string;
  version: number;
  issuedAt: string;
  status: 'valid' | 'superseded' | 'cancelled';
  sha256: string;
};

/** Public QR check. Shows what the document is and whether it stands; nothing about the student. */
export async function verifyDocument(db: Db, code: string): Promise<Verification | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return null;
  const [row] = await db.execute<Verification>(sql`
    select kind, number, version, issued_at::text as "issuedAt", status, sha256
    from ops.document_verification where code = ${code}`);
  return row ?? null;
}
