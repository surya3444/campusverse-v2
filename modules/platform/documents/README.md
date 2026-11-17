# platform/documents

Private file storage and frozen issued documents. Certificates (TC, bonafide) build on this, with their own numbering and templates.

**Uploads:** `createUpload` → signed PUT URL (10 minutes; type and length signed) → `completeUpload` checks the size and queues `platform.file.uploaded.v1` → the `documents.scan` consumer checks the bytes match the declared type, hashes them and scans them. Only `clean` files get a download link (5 minutes, audited). PDF, JPEG and PNG only, up to 10 MB.

**Issued documents:** `issueDocument` (or `issueDocumentIn` inside a caller's transaction, as certificates do) renders an A4 PDF with a QR code, stores it, and records its SHA-256. The row is append-only; a correction is a new version with the same number, and the old one is marked superseded. `verifyDocument(code)` is the public QR check: kind, number, version, date, status and hash, never student details.

**Scanner:** `devScanner` catches only the EICAR test file and refuses to run in production. A real engine is a Milestone 16 item.

**Server-side uploads (Milestone 19):** `storeFile` stores bytes the API received under the caller's own permission (who may change this photo or record), checks the type by its first bytes, and queues the scan; `fileState` reports progress; `cleanFileBytes` returns a file only once it is clean. Photos and logos are served through the API, not signed links, and their views are not audited (they appear on many screens); documents still go through audited signed links.

**Owned tables:** `stored_file`, `issued_document` (append-only), `ops.document_verification` (migration 0003).

**Events:** `platform.file.uploaded.v1`, `platform.document.issued.v1`.
