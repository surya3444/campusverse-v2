# Exams, Section Planner and Year Rollover: Milestone 13 spec

Status: **draft for owner review**, written 5 November 2026 from the Schools Release spec ("Exams and report cards", "Students, sections and year rollover"), the Build Guide (Milestone 13) and what Milestones 1–12 built. _Default_ marks a proposal that stands unless the owner changes it.

**Exit check (guide):** a test school finishes one full year: set up, enrol, attend, pay, sit exams, get report cards, and roll over into the next year.

## Part 1: Exams and report cards

**Job:** marks enter once and become accurate report cards, while each board's rules stay in data.

### Model

- **Exam**: a name per class group (e.g. "Term 1" for Classes 1–5, "Half-yearly" for 6–8), the classes it covers, dates, and a state: planned → marks open → marks locked → published (or cancelled).
- **Paper**: one subject of one class in an exam, with its maximum marks (numeric, two decimals) and an optional date.
- **Mark**: one student, one paper: a value, or a code instead of a value.

| Code    | Meaning                                       | Counts as                                  |
| ------- | --------------------------------------------- | ------------------------------------------ |
| (blank) | Not entered                                   | Blocks publishing: **blank is never zero** |
| AB      | Absent                                        | Zero, shown as AB                          |
| ML      | Medical                                       | Left out of the total, with a note         |
| UFM     | Unfair means                                  | Zero, shown as UFM                         |
| EX      | Exempt (e.g. language exemption, with reason) | Left out of the total                      |
| NA      | Not applicable (joined mid-year)              | Left out of the total, with a note         |

### Locks

1. The subject teacher (or class teacher) enters marks and **submits** the paper.
2. The principal **locks** the exam: every paper submitted, no blanks.
3. A change after the lock is a **request** with a reason by one person, **approved** by a different person; both stay in the history.

### Grading and results

- The board's grading scheme comes from the rule pack and its **version is saved with each result** (CBSE eight-point scale A1–E, unverified until checked against the bye-laws).
- A subject's percentage is marks over the maximum of the papers that count. _Default:_ rounded down to two decimals; the rounding method is stated in the pack with sample tests.
- _Default_ pass mark 33% per subject (CBSE practice, unverified). Grace marks, moderation and compartment are **not** applied this milestone: the research didn't confirm them.

### Publishing

Publishing an exam freezes its results, makes a report card PDF per student (frozen, QR-verifiable, through platform documents), and tells parents in the app. _Default:_ publish now; scheduled release comes later. Dues never block results.

**Report card:** school, student, class, exam, each subject with marks, maximum, percentage and grade, overall percentage, attendance for the year so far, and the class teacher's remark.

## Part 2: Section planner

**Job:** place a class's students into sections fairly, without spreadsheets.

1. Choose the class in the coming year, and how many sections (they are created from the year's structure).
2. **Generate**: students are dealt into sections to balance size, gender and marks (a snake draft by the last published result), keeping apart any pairs the school lists.
3. The **balance score** per section is shown: size, gender split and average marks.
4. Move any student to another section by hand; broken keep-apart pairs and capacity are flagged.
5. The plan feeds the rollover commit.

Sensitive factors (caste, religion, income) are never used. _Default:_ no merit-ranked sections: the planner always mixes marks.

## Part 3: Year rollover

**Job:** move every student into the next year without retyping anything.

1. **Checklist:** next year's structure exists; every exam of the year is published or cancelled (_default:_ warning, not a block, so a school can roll over before results are final).
2. **Preview:** one row per student: outcome and next class, from the rule pack:
   - Up to Class 8: promoted (no-detention by default); the school can mark **detained** with a reason.
   - Classes 9 and 11: promoted if every subject's percentage is at least the pass mark in the last published exam, otherwise **review**; the school decides with a reason.
   - Classes 10 and 12: **passed out** (board exams decide outside the school's system this milestone).
   - The last class of the school: passed out.
3. **Overrides** with reasons.
4. **Sections** from the planner, or _default_ the same section letter.
5. **Commit:** old enrolments end on the year's last day with status promoted, detained or passed out; new enrolments start on the next year's first day; roll numbers by name. Fee dues stay on the old year as arrears.
6. **Undo** while the new year is unused (no attendance taken and no fee invoices issued on the new enrolments).

**Events:** `school.exam.published.v1`, `school.rollover.committed.v1`, `school.rollover.undone.v1`.

## Permissions

| Permission                | Who                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `school.exam.manage`      | Principal, school administrator                                                                  |
| `school.exam.enter_marks` | Teacher (their own classes and subjects, checked in the module), principal, school administrator |
| `school.exam.lock`        | Principal, school administrator                                                                  |
| `school.exam.publish`     | Principal, school administrator                                                                  |
| `school.exam.read`        | Principal, administrator, teacher; guardian (own child, published only)                          |
| `school.rollover.manage`  | Principal, school administrator                                                                  |

## Out of scope this milestone

Datesheet clash check, hall tickets, seating and invigilation, co-scholastic areas and HPC, grace and compartment, scheduled release and acknowledgement of results, board lists for upload, regional-script report cards, Class 11 streams, campus transfers during rollover.

## Open questions for the owner

1. Pass mark 33% per subject for promotion review in Classes 9 and 11?
2. Should rollover be blocked until every exam is published?
3. Which exam's results feed the rollover: the last published exam (default) or a weighted year total?
4. Report card remarks: class teacher only (default), or subject teachers too?
