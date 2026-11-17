# school/exams

Exams from creation to published report cards (spec: `docs/specs/EXAMS_ROLLOVER.md`, part 1).

**Flow:** `createExam` (year, classes, maximum marks; one paper per subject the class takes) → `saveMarks` (grid autosave and paste; subject teacher, class teacher's section, or exam managers) → `submitPaper` (refused while anyone is blank) → `lockExam` (every paper submitted) → `requestMarkChange` / `decideMarkChange` (after the lock; the person who asked can't approve, also a CHECK constraint) → `publishExam`: results frozen with the grading scheme id, one report card PDF per student through `platform/documents` (`issueDocumentIn`, QR-verifiable), guardians told.

**Rules:** marks are `numeric`, handled as hundredths in code (`domain/results.ts`). Codes: AB and UFM count as zero; ML, EX and NA are left out of the total, with a note. Blank is never zero. Percentages round down to two places. Grades come from the board rule pack in force on the exam day (`boardRulesAt`; CBSE 8-point built in, unverified); a later pack version freezes as `id/vN`. Fee dues never hold back results.

**Reads for others:** `latestResult(tx, studentId)` (the last published result; rollover uses it), `studentResults`.

**Owned tables:** `school_exam`, `school_exam_paper`, `school_exam_mark`, `school_exam_mark_change`, `school_exam_remark`, `school_exam_result` (append-only). Migration 0011.

**Events:** `school.exam.published.v1`.

**Screens:** `/exams`, `/exams/<id>`, `/exams/<id>/marks?paper=&section=` (one subject and section per grid; a change request form after the lock).

**Date sheet and analysis (Milestone 22):** `dateSheet`, `schedulePaper` (date, start, length, room, invigilator from staff; a class can't sit two papers at once and an invigilator can't be in two rooms; while marks are open, `school.exam.manage`), `papersOn` (the papers sat on a date, for the timetable's exam days; the caller checks), `examAnalysis` (per paper: average, pass rate by the board's pass mark, highest, lowest, absentees, blanks, grades; per class: the top five among complete results; `domain/analysis.ts`, integer arithmetic only). Verse AI: `school.exams.results` (class and subject aggregates, no names).

**Not yet:** remarks on screen (API only: `POST /school/exams/:id/remarks`), weighted term totals, co-scholastic grades, report cards in the parent app, regional-script PDFs.
