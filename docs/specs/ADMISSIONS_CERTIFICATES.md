# Admissions and Certificates: Milestone 12 spec

Status: **draft for owner review**, written 5 November 2026 from the Schools Release spec ("Admissions", "Certificates and TC"), the Build Guide (Milestone 12) and what Milestones 1–11 built. _Default_ marks a proposal that stands unless the owner changes it.

**Exit check (guide):** an enquiry becomes an enrolled student, then later receives a TC.

## Part 1: Admissions

**Job:** one pipeline from enquiry to enrolment, with the school's decision method set by class.

### States

enquiry → contacted → applied → documents pending → under review → offered → confirmed → enrolled; or waitlisted, lost, withdrawn, rejected. Every move is recorded with who and when; moves that end an application (lost, withdrawn, rejected) need a reason.

### What the school does

| Screen      | First release                                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline    | Columns by state, filtered by class and source; the count of seats left per class on top                                                                                                                             |
| Enquiry     | Quick add: child's name, date of birth, class wanted, guardian name and phone, source, next follow-up date. A guardian phone already on file is shown as a possible sibling or duplicate, never merged automatically |
| Application | The rest of the details, the document checklist (from the student record's document kinds), and the age check                                                                                                        |
| Seats       | Seats per class and category (general, RTE, staff, management) for the coming year; RTE seats are filled only from the RTE source                                                                                    |
| Offer       | Offer with the class's published fee plan shown in full (fee disclosure), and an expiry date. _Default:_ 7 days                                                                                                      |
| Enrol       | One action: the student record, the guardian (with app access), the enrolment in a section, the fee invoices, and a handover checklist                                                                               |

### Rules

| Rule                 | Behaviour                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Age                  | The rule pack works out eligibility for the class and year (CBSE: age on 31 March of the admission year, verified: false). Outside the range needs an override with a reason and an order reference |
| Screening            | No test or interview step at entry classes (pre-primary and Class 1) by default; the school can't turn it on there                                                                                  |
| Documents            | Admission up to Class 8 can proceed with documents pending; the student record keeps the checklist                                                                                                  |
| Fee disclosure       | An offer can't be sent without a published fee plan for the class, and shows every head and instalment                                                                                              |
| Sibling              | A guardian phone matching a current student's guardian is flagged as a sibling. Any sibling discount is a concession with its own approval (Milestone 11)                                           |
| RTE                  | Applications from the RTE source carry the RTE category: their concession on RTE-exempt heads is requested automatically and needs approval                                                         |
| Seats                | Confirming takes a seat; a seat can't go below zero. An offer that lapses frees its seat, and the next waitlisted applicant for that class is offered automatically                                 |
| Class 10 or 12 entry | Allowed with a warning and principal approval of the offer                                                                                                                                          |
| Rejected data        | _Default:_ a cleanup at the end of the cycle plus 90 days deletes personal details of rejected, lost and withdrawn applications (a scheduled job; Milestone 16 runs it)                             |

**Out of scope now:** online application fee (the public online form arrived later: docs/specs/ONLINE_APPLICATIONS.md), merit lists and lotteries, two-campus linking, twins as one joint application, Class 11 streams.

**Events:** `school.admission.confirmed.v1`, `school.admission.enrolled.v1`.

## Part 2: Certificates

**Job:** request, check, issue and verify a document in minutes, with a permanent register.

### Kinds in this milestone

| Kind                      | Fields                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer Certificate (TC) | Name, date of birth (figures and words), parents' names, admission number and date, class and section at leaving, date of leaving, reason, working days and days present in the year, conduct, dues cleared (yes or no), APAAR status, board registration where the school records it |
| Bonafide                  | Name, class, section, year, purpose                                                                                                                                                                                                                                                   |
| Fee paid                  | Name, year, total paid in the year from receipts                                                                                                                                                                                                                                      |

Conduct and migration certificates, report card reissue and DigiLocker come later.

### TC flow

request (office, or a parent from the app later) → **clearance**: fee dues, attendance figures and pending documents shown as warnings → **draft** auto-filled from the record → **class teacher check** → **principal approval** → **numbered issue**: frozen PDF with QR → the enrolment ends on the leaving date and the student is marked left → an export task for the state portal is recorded.

### Rules

| Rule                  | Behaviour                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dues                  | Up to Class 8: a warning, never a block. Above Class 8: a school setting, _default_ warning only, because blocking needs legal advice |
| Timer                 | A state pack sets a deadline from request (Karnataka 7 days, unverified); the request shows days left                                 |
| Numbering             | Per institution, by kind and academic year, e.g. `TC/2026-27/0001`; numbers are never reused, cancelled or not                        |
| Issued copy           | Frozen: PDF hash and QR verification (platform documents)                                                                             |
| Correction            | A new version with the same number, a reason, and a link to the old one, which shows as superseded                                    |
| Duplicate             | A reprint for a lost copy is the same document marked DUPLICATE, as a new version                                                     |
| Sensitive fields      | Caste and religion are not stored by the product today, so they are not printed                                                       |
| Attendance incomplete | A warning; the principal enters a reasoned value                                                                                      |
| External TC           | When a state portal must issue the TC, the school records the portal's number and uploads the file                                    |

**Public verification:** `/verify/<code>` (no login) shows kind, number, version, issue date and whether it is valid or superseded. Nothing about the student.

**Script:** certificates print in English this milestone. Regional scripts need a PDF engine with complex-script shaping (pdf-lib can't shape Kannada, Telugu, Tamil or Devanagari), so _default:_ English only until a board or state requires otherwise.

**Events:** `school.certificate.requested.v1`, `school.certificate.issued.v1`, `school.student.left.v1`.

## Permissions

| Permission                   | Who                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `school.admission.manage`    | School administrator, principal, office                                                                  |
| `school.admission.offer`     | School administrator, principal                                                                          |
| `school.admission.enrol`     | School administrator, principal, office                                                                  |
| `school.certificate.request` | School administrator, principal, office; guardian (own child, later in the app)                          |
| `school.certificate.check`   | Class teacher of the student's section (relation checked in the module), school administrator, principal |
| `school.certificate.approve` | Principal, school administrator                                                                          |
| `school.certificate.issue`   | Principal, school administrator, office                                                                  |

## Open questions for the owner

1. Offer expiry: 7 days?
2. TC above Class 8 with dues: warning only (default) or a block?
3. Certificate number format: `TC/2026-27/0001`, or the school's own prefix?
4. Should parents request bonafide certificates from the app in this milestone, or later?
5. Public application form: later (default) or now?
