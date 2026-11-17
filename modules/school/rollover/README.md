# school/rollover

Year end for one institution: the section planner, the promotion preview, commit and undo (spec: `docs/specs/EXAMS_ROLLOVER.md`, part 2).

**Planner (`domain/planner.ts`, pure):** deals each gender round-robin by last result, smallest sections first, then swaps keep-apart pairs apart. Sizes and gender counts stay within one; sections are never ranked by merit. Only size, gender and marks are used. `problems()` flags over capacity, kept-together pairs and unplaced pupils; a person decides, nothing is blocked.

**Preview:** each student’s outcome from the board rule pack in force (`boardRulesAt` + `promotionFor`) and `latestResult`: promoted (no detention up to Class 8), review (Classes 9 and 11 below the pass mark or without a result), passed out (board classes and the last class). Next section: the saved plan, else the same letter, else the first. Unpublished exams are a warning.

**Commit:** overrides need a reason; every review row needs a decision. Old enrolments get their outcome; promoted and detained students are enrolled from next year's first day with roll numbers by name; leavers' memberships end (`studentLeaves`, status passed out). This year's attendance, dues and results stay where they are.

**Undo:** allowed until the new year is used (any attendance or invoice from its first day); restores outcomes and memberships.

**Owned tables:** `school_section_plan`, `school_rollover`. It writes enrolment, people and membership only through their contract primitives in the same transaction.

**Events:** `school.rollover.committed.v1`, `school.rollover.undone.v1`.

**Screen:** `/year-end`.

**Not yet:** keep-apart pairs on screen (API only), per-section capacity from setup (the planner assumes 40), class-merge and new-section suggestions.
