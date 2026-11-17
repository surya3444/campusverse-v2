# school/enrolment

Which section a student is in, and when. It implements people/records' `AcademicPlacementPort` as `schoolPlacement`.

| Function                   | Notes                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enrol`                    | Inside the caller's transaction (used by setup imports)                                                                                                                                                         |
| `changeSection`            | Ends the old enrolment the day before and starts a new one; same class and year only; history stays. Needs `school.enrolment.change` and a reason                                                               |
| `schoolPlacement`          | Current class, section and admission number for a person on a date; `getPlacements` answers for a whole list in one query; `findByReference` finds people by admission-number prefix (the fee counter's search) |
| `enrolledKeys`             | Students already enrolled in an institution (import duplicate checks)                                                                                                                                           |
| `removeImportedEnrolments` | Import undo                                                                                                                                                                                                     |

**Owned tables:** `school_enrolment` (created in migration 0004).

**Events:** `school.enrolment.section_changed.v1`.
