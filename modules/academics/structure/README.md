# academics/structure

The academic engine (rule book §12.3, §12.4 decisions 2–3, §13.2 Academic Structure, P0 item 3). Two of the three linked trees; the organisation tree is platform/organisation.

- **Curriculum:** program → regulation → courses. A regulation is a numbered version (`R25 v1`, `R25 v2`). A draft is edited course by course (code, title, term, type, L-T-P, credits, and optionally its internal assessment components: up to eight, each with maximum marks and a weight, weights adding up to 100, `validCiePlan`; migration 0073); publishing freezes it, and a database trigger refuses any later change. A new version starts as a copy of the latest published one.
- **Cohort:** batch → term → section → enrolment. A batch is created on a published regulation and keeps it for life. It advances one term at a time (`advanceTerm`, guarded by the term the person saw); after the last term it completes and its enrolments end as completed. Nothing is copied into a new year.
- **Checks:** `checkRegulation` adds credits per term and in total against the program's credit framework from `packages/rules` (`CREDIT_FRAMEWORKS`: UGC UG 3 and 4 years with exit awards, UGC PG). Courses outside the program's terms block publishing; load and exit-credit gaps are warnings a person decides on.
- **Parity:** `coursesForBatchTerm` gives a batch only its current term's courses, so registration can never list the wrong semester parity (rule book §17, demo defect 2).
- **Enrolment:** `enrolStudent` creates the lifelong learner record through people/records (person, student profile, institution membership from the term's first day) and the enrolment from the current term.

Schools keep classes and sections in school/setup for now (`school_uses_classes`); they move onto this engine later.

| Permission                   | Who (templates)                                  |
| ---------------------------- | ------------------------------------------------ |
| `academics.structure.read`   | owner, administrator, principal, office, teacher |
| `academics.structure.manage` | owner, administrator, principal                  |
| `academics.enrolment.manage` | owner, administrator, principal                  |

**Owns:** `academic_program`, `academic_regulation`, `academic_course`, `academic_curriculum`, `academic_batch`, `academic_term`, `academic_section`, `academic_enrolment` (migration 0055).

**Events:** `academics.regulation.published.v1`, `academics.batch.created.v1`, `academics.term.advanced.v1`, `academics.student.enrolled.v1`.

**Not yet:** electives baskets, prerequisites, lateral entry and re-entry, moving a student between sections, undoing a term advance, schools on the engine, college role templates (Dean, HoD, CoE).

**Students from a file** (`enrolFromFile`, `domain/enrolments.ts`): a batch's students from a CSV (Name, Register number, Section, Date of birth; headings matched loosely, Indian or ISO dates). Every row is checked first (a known section with room, a register number neither repeated nor already in the batch); with `apply`, the ready rows are enrolled in one transaction and rows with a problem are left out.

**Placement for shared modules** (`academicPlacement`): implements people/records `AcademicPlacementPort` for colleges and universities ("BECS 2026–30 · Semester 1 · A", the register number as reference), registered beside the school's, so Students, transport, hostel, library, gate and helpdesk show where a college student is.
