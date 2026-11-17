# school/certificates

TC, bonafide and fee-paid certificates, from request to a numbered, frozen, QR-verifiable PDF (spec: `docs/specs/ADMISSIONS_CERTIFICATES.md`, part 2).

**TC flow:** `requestCertificate` (leaving date and reason; clearance warnings; the deadline from the state rule pack in force, `tcDeadlineAt`) → `editDraft` (principal, with a reason) → `checkCertificate` (class teacher, or a principal who then can't approve) → `approveCertificate` → `issueCertificate`: next number (`TC/2026-27/0001`), frozen PDF through `platform/documents` (`issueDocumentIn`), enrolment and membership ended on the leaving date, student marked left. `reissueCertificate` makes a correction or a DUPLICATE as a new version with the same number; the old one shows as superseded on the QR check. `recordPortalExport` notes the state portal's copy.

**Bonafide and fee paid:** request, then issue; no check or approval step.

**Rules:** dues warn and never block up to Class 8; above, a school setting (default warning only). Numbers per institution, kind and year, never reused. The draft prints only what the record holds; nothing sensitive (caste, religion, Aadhaar) is stored or printed.

**Public check:** `GET /api/v1/public/verify/:code` and the web page `/verify/<code>`: kind, number, version, date and status only.

**Owned tables:** `school_certificate_request`; numbers in `school_number_counter` (migration 0010). Issued PDFs live in `platform/documents`.

**Events:** `school.certificate.requested.v1`, `school.certificate.issued.v1`, `school.student.left.v1`.

**Not yet:** conduct and migration certificates, report card reissue, DigiLocker, regional-script PDFs, parent requests from the app, uploading an externally issued TC file.

**ID cards:** `idCards(deps, actor, { sectionId } | { studentId })` prints a section's cards (or one student's) as an A4 PDF, ten to a sheet (`renderIdCards` in platform/documents): photo, class, roll and admission numbers, date of birth, valid till the year's last day. Needs `school.certificate.request`; each print is in the Activity Log (`school.certificate.id_cards`). Health details stay off the card. Latin-script names only for now (`not_printable`); no QR code yet.
