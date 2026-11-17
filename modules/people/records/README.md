# people/records

Shared student and staff records (Schools Release spec, "Students and Staff"). One person, one record, across every institution in the organisation. This module never reads academic tables. Where a student sits comes from `AcademicPlacementPort`, which each academic module implements (school: `schoolPlacement` in school/enrolment). Lists use its batch `getPlacements`, so the student list loads the whole school in two queries and shows the admission number (`reference`).

| Area       | Functions                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives | `createPerson`, `findByPhoneAndName`, `addPhone`, `linkGuardian`, `ensureStudentProfile`, `ensureStaffProfile`, `addMembership`, `removeImportedPeople` (for other modules, inside their transaction) |
| Students   | `listStudents`, `studentRecord`, `updateStudent`, `correctName`, `setApaar`, `setAadhaar`, `setPen`, `setAbcId`, `revealIdentifier`, `setGuardianLink`, `setDocument`                                 |
| Staff      | `listStaff`, `staffRecord`, `updateStaff`, `exitStaff`, `revealPan`                                                                                                                                   |
| Signed-in  | `whoAmI`                                                                                                                                                                                              |

**Rules**

- A record is shaped by permission. A teacher sees the overview and placement. Guardians and history need `people.student.update`, and documents need `people.student.read_full`. A parent sees only their own child.
- Aadhaar (Verhoeff-checked) and PAN are sealed with AES-256-GCM (`packages/crypto`) and shown as the last four digits. A full reveal needs permission and a reason of at least 5 characters, and is audited as restricted.
- APAAR is present, refused or not generated (with a reason). It never blocks anything.
- The lifelong learner record (rule book §13.5): PEN (UDISE+, 11 digits) is kept in clear because the transfer certificate prints it, and is unique in the organisation; the ABC ID (12 digits) is sealed like APAAR and can be revealed the same way. Both are optional (migrations 0051, 0052).
- Name corrections keep the old name and its source (`person_name` is append-only).
- A restricted guardian loses access at once.
- Staff exit ends staff memberships and every role after the last day, then emits `people.staff.exited.v1`. Academic modules end their own data from that event.

**Owned tables:** `person_name`, `student_profile`, `staff_profile`, `institution_membership`, `person_document` (migration 0006). It also writes `person`, `person_phone` and `guardian_link`.

**Photos and my profile (Milestone 19):** `photoCheck`, `setPhoto`, `photoOf`: one's own photo with `people.profile.update_own` (a 'self' grant on every role); a student's or staff member's with the right to update their record; seen by whoever may read that record, guardians included. `myProfile`, `updateMyProfile`: email and preferred language. `displayNames` resolves names for "who did this".

**Staff and documents (Milestone 20):** `createStaff` (`people.staff.create`; the same name and mobile number on staff is refused; codes EMP-0001 onwards), `staffDetails`, `updateStaffDetails` (Aadhaar and bank account sealed, last four in clear, audited as restricted). `listDocuments`, `addDocument`, `checkDocument`, `openDocument`: documents in folders with versions (`record_document`); staff papers need `people.staff.documents`, a student's follow the record's read and update permissions; every opening is audited. `staffAt` lists who is on staff at an institution on a day.

`listStudents` takes an optional `onDate`: who was on the rolls that day, placed where they were then (the student list's year picker). `photoFilesOf` gives photo files for printing ID cards.

**Staff of every kind and safety checks (migration 0079):** `createStaff` takes a `workRole` (teacher, office, driver, bus attendant, security, warden, nurse, or none for support staff without app access); it gives that role at the institution and sets `staff_profile.category` (teaching, administrative, support). Administrators and principals are still given in Access. `staff_check` (append-only) holds police verification, driving licence, medical fitness and PSV badge checks; the latest of a kind counts. `REQUIRED_CHECKS` (domain/checks.ts) says which checks each role needs (to be confirmed with counsel); `checkState` is missing, expired, expiring (30 days) or ok. `recordStaffCheck` (`people.staff.update`), `staffChecks` (`people.staff.read`); the staff list carries each person's roles, category and checks due; `checksFailing` lets transport refuse crew without valid checks. **Event:** `people.staff.check_recorded.v1`.

**Events:** `people.student.updated.v1`, `people.guardian.changed.v1`, `people.staff.exited.v1`, `people.profile.changed.v1`, `people.staff.created.v1`, `people.document.added.v1`.

**Tests:** `modules/school/setup/tests/people-records.db.test.ts`, which runs against a real school (it lives there so this shared module never depends on a school module).
