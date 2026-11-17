# platform/consent — Campus Core › Privacy & Consent

Rule book §13.12, §15 and §16.5. The consent ledger, and the Data Protection Officer's console.

- `publishNotice` / `publishNextNotice`: versioned notices per purpose and language, with a SHA-256 of the text. Earlier versions stay, so every decision points at the exact text the guardian saw.
- `recordConsent`: appends a decision (`granted` or `withdrawn`). In the app a guardian decides only for themselves and only for their own child, through the permission's guardian relation. Office staff record paper forms, but only for a current guardian of the student.
- `currentConsent`: the latest decision per guardian.
- `studentConsent`: one student's purposes (with a notice or a decision), the latest notice per language and each current guardian's decision. A guardian sees their own child through the guardian relation (the parent app's Privacy and consent screen); office staff see any student and record paper forms (Guardians tab › Consent).
- `privacyOverview`: coverage per purpose (the catalogue in `domain/privacy.ts` plus any purpose with a notice) over students with a current guardian; a student's status is their latest guardian decision. Also open and overdue requests, open and late breaches.
- `verifyGuardian` / `revokeGuardianCheck` / `guardianChecks`: guardian verification (DPDP s.9, Rule 10; rule book §17.5 gate). Office staff (`platform.consent.verify_guardian`) record that a current guardian was checked as an identifiable adult, from the institution's records or an identity document seen; only the document's kind is kept, never its number. A verification made in error is undone with a reason. A guardian's grant counts in coverage only while they are verified; until then it shows as awaiting verification, and the parent app says so. A DigiLocker token (`digilocker_token`) is reserved for the Integrations Hub.
- `recordRightsRequest` / `setRightsRequestState` / `rightsRequests`: DPDP data-rights requests (access, correction, erasure, grievance, nomination, withdrawal), due 30 days after receipt as an internal target; closing needs a written outcome.
- `recordBreach` / `markBreachStep` / `breaches`: the breach register with the CERT-In 6-hour check, and when the Board and the people affected were told.

The console needs `platform.privacy.manage` (sensitive) at organisation scope. The core-data legal basis and statutory periods are counsel questions, so nothing is labelled "exempt".

**Owned tables:** `consent_notice`, `consent_record` (append-only, migration 0003); `consent_rights_request`, `consent_breach` (migration 0049); `consent_guardian_check` (append-only, migration 0060).

**Events:** `platform.consent.changed.v1` (record id, student, guardian, purpose, notice version, decision; Communications sends the guardian a receipt), `platform.consent.notice_published.v1`, `platform.privacy.request_recorded.v1`, `platform.privacy.request_closed.v1`, `platform.privacy.breach_recorded.v1`, `platform.consent.guardian_verified.v1`.

**Not yet:** DigiLocker age tokens; adult students (18 and over) consenting for themselves; whether a verification should expire; counsel to confirm the verification methods meet Rule 10.
