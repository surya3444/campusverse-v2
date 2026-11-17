# school/setup

From signup to first attendance (Schools Release spec, "Setup and Organization").

| Step           | Function                                                              | Notes                                                                                                                        |
| -------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Sign up     | `provisionSchool`                                                     | Campus tree (via platform/organisation), school role templates, owner as organisation-wide school administrator with a login |
| 2–4. Structure | `planStructure` (preview), `applyStructure`                           | Year from the board or state template, classes, sections A, B, … and default subjects from `packages/rules`. Idempotent      |
| 5. Import      | `previewImport` → `commitImport` → worker → `getImport`; `undoImport` | Students with guardians, staff with roles, class teachers and subjects                                                       |
| 6. Invite      | `previewInvites` → `sendInvites` → worker                             | Logins for staff and guardians, plus a welcome message each                                                                  |
| Ready?         | `setupReadiness`                                                      | Every section has students, a class teacher, and that teacher a login                                                        |

**Campusverse V1 importers (rule book §17 P0 item 16):** `previewImport` with `source: 'v1'` takes an export of V1's `students` or `staff` collection (a JSON array, or one document per line as mongoexport writes it) and turns it into the template's rows (`domain/v1.ts`): admission number, name, date of birth (the calendar day in India), class and section, roll number and up to two parents; staff by employee code, phone, email, teacher or office. Records no longer active in V1 are left out and counted. From there it is the same checks, dry run, commit and undo, and the batch is marked `source = 'v1'`. The Data Import centre (Campus Core › Data import) offers both sources and the history. Staff import needs no school year, so colleges and universities use it too (lecturer, professor and registrar are read as roles); their students are enrolled into a batch in Academic Structure.

**Years over time:** a year's status is read from its dates (`YEAR_STATUS`: planned, active, ended) unless it is closed. `closeYear` locks an ended year; `reopenYear` needs a reason (Activity Log). `assertYearOpen` is called by attendance (submitting and changing a day) and exams (every exam step), which refuse a closed year with `year_closed`. Events `school.year.closed.v1`, `school.year.reopened.v1`. The Academic years page (/years) shows the life of each year and its counts.

**Next year and the classes view:** `setUpNextYear` creates the year after the latest one (from the day after it ends, for a year), copying its sections (names, capacities) and subject offerings with periods a week; teachers are assigned again in Subjects. It is refused while a year that hasn't started exists (`next_year_exists`). Year end offers it as a button. `classesOverview` lists every year's classes, sections, class teachers and headcounts (counted today in the running year, on the last day of a past one, the first day of a future one); headcounts come from the enrolment contract (`sectionHeadcounts`). The Classes page (/classes) shows it and links each section of the running year to the filtered student list.

**Import rules**

- `.xlsx` only, up to 5 MB, 5,000 rows, and at most 60 MB once unpacked (zip-bomb guard). Permission is checked before the file is opened.
- Headings are matched by common wordings; unknown columns are listed and ignored. Classes accept `5`, `V`, `Class 5` or `Std. V`.
- Dates: day/month/year unless the column proves month/day; dates that could go either way are flagged as ambiguous.
- Each row is `valid`, `invalid` (errors per field) or `duplicate` (flagged, never merged). Only valid rows are committed.
- A person is matched by phone **and** name: siblings share their parent, a teacher who is also a parent stays one person, and a shared family phone holds separate people.
- A commit runs in a worker, exactly once and all-or-nothing. If the school changed since the preview, the batch fails with a reason.
- After commit, the preview's copy of the file is cleared.
- Undo deletes only what the batch created; database policies allow the app to delete nothing else. Once the data is in use (invites sent, attendance taken), undo is refused.

**Owned tables:** `school_year`, `school_class`, `school_section`, `school_subject`, `school_subject_offering`, `school_teacher_allocation`, `import_batch`, `import_row` (migrations 0004, 0005).

Enrolments belong to school/enrolment and people to people/records. Imports write through their contracts. Setup ends a leaver's class-teacher and subject allocations when `people.staff.exited.v1` arrives (`staffExitConsumer`).

**Events:** `school.structure.applied.v1`, `school.import.commit_requested.v1`, `school.import.committed.v1`, `school.import.undone.v1`, `school.invites.requested.v1`.

**Subjects (Milestone 21):** `subjectsOverview`, `addSubject`, `updateSubject` (rename, type, retire; marks keep a retired subject), `setOffering` (per class this year, periods per week), `assignTeacher` (subject or class teacher per section; the previous allocation ends, never deleted). Logo and signature: `setInstitutionImage`, `institutionImage`.

**Not yet:** V1 attendance, marks, fees and status history (only current students and staff move across so far); cohorts and teaching groups, terms, state language rules, Class 11–12 streams. Readiness, overview and invite reports still read other modules' tables directly; they should move to contract queries.
