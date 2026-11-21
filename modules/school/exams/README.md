# school/exams

Exams from creation to published report cards (spec: `docs/specs/EXAMS_ROLLOVER.md`, part 1).

**Flow:** `createExam` (year, classes, maximum marks; one paper per subject the class takes) → `saveMarks` (grid autosave and paste; subject teacher, class teacher's section, or exam managers) → `submitPaper` (refused while anyone is blank) → `lockExam` (every paper submitted) → `requestMarkChange` / `decideMarkChange` (after the lock; the person who asked can't approve, also a CHECK constraint) → `publishExam`: results frozen with the grading scheme id, one report card PDF per student through `platform/documents` (`issueDocumentIn`, QR-verifiable), guardians told.

**Rules:** marks are `numeric`, handled as hundredths in code (`domain/results.ts`). Codes: AB and UFM count as zero; ML, EX and NA are left out of the total, with a note. Blank is never zero. Percentages round down to two places. Grades come from the board rule pack in force on the exam day (`boardRulesAt`; CBSE 8-point built in, unverified); a later pack version freezes as `id/vN`. Fee dues never hold back results.

**Reads for others:** `latestResult(tx, studentId)` (the last published result; rollover uses it), `studentResults`.

**Owned tables:** `school_exam`, `school_exam_paper`, `school_exam_mark`, `school_exam_mark_change`, `school_exam_remark`, `school_exam_result` (append-only), `school_coscholastic_area`, `school_exam_coscholastic`, `school_result_plan`, `school_result_plan_exam`, `school_final_result` (append-only). Migrations 0011, 0094, 0095.

**Events:** `school.exam.published.v1`, `school.exam.final_published.v1`.

**Screens:** `/exams` (with final results), `/exams/<id>` (Papers, Report card, Date sheet, Analysis), `/exams/final/<id>`, `/exams/<id>/marks?paper=&section=` (one subject and section per grid; a change request form after the lock).

**Date sheet and analysis (Milestone 22):** `dateSheet`, `schedulePaper` (date, start, length, room, invigilator from staff; a class can't sit two papers at once and an invigilator can't be in two rooms; while marks are open, `school.exam.manage`), `papersOn` (the papers sat on a date, for the timetable's exam days; the caller checks), `examAnalysis` (per paper: average, pass rate by the board's pass mark, highest, lowest, absentees, blanks, grades; per class: the top five among complete results; `domain/analysis.ts`, integer arithmetic only). Verse AI: `school.exams.results` (class and subject aggregates, no names).

**Patterns, report card and final result (21 Nov 2026):**

- **Parts:** a subject's marks can be split into 2–4 named parts (Theory 80 + Internal 20). Each part is its own paper (`part`, `part_seq`) with its own grid and submission; `result()` adds the parts up and the report card prints them. `createExam` takes `parts`. `setSubjectParts` changes one subject's split in one class while marks are open and none are entered.
- **Report card entries:** co-scholastic areas per institution (CBSE's four put in on first use; retire, use again) graded A/B/C per student per exam, plus the class teacher's remark (`reportCardSheet`, `saveReportCard`; class teacher or `school.exam.manage`, until published).
- **Remark suggestions:** `suggestRemark` writes them from the student's own marks and attendance on the server. They are deterministic and use no AI model, because a child's marks never go to one.
- **Final result:** a final result plan combines a year's exams with weights that total 100% (`saveResultPlan`). It is previewed once every exam is published (`resultPlanDetail`; `finalResult()` weights only the exams that count a subject, then rounds down). `publishResultPlan` freezes each student's `school_final_result`, issues the year's report card and tells guardians. `latestResult` prefers the newer of the final and the exam result.

**Not yet:** report cards in the parent app, regional-script PDFs, HPC (holistic progress card).
