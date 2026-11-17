# school/syllabus

Syllabus and lesson plans (docs/specs/SYLLABUS.md). Years, sections, subjects and who teaches what come from school/setup (`teachingPlan`, `teaches`, `yearsOf`).

| Use case                             | What                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `classSubjects`, `syllabusPlan`      | This year's classes and subjects (yours marked); one class and subject's units with each section's ticks and coverage |
| `saveUnit`, `moveUnit`, `deleteUnit` | Units for subjects you teach in that class (`school.syllabus.teach`) or any (`.manage`); in-use units aren't deleted  |
| `tickUnit`                           | Done (or undone) for a section you teach, dated today or earlier this year                                            |
| `schoolCoverage`, `syllabusFigures`  | Covered against expected by planned month, sections behind                                                            |
| `lessonPlans`, `saveLessonPlan`      | One plan per section, subject and day; editable until the day after                                                   |
| `previewCopy`, `commitCopy`          | Last year's units into this year for class-subjects with none (months moved on a year)                                |
| `syllabusTools`                      | Verse AI `syllabus.coverage` (counts) and `syllabus.unit.complete` (act)                                              |

**Owns:** `school_syllabus_unit`, `school_syllabus_progress`, `school_lesson_plan`. **Events:** `school.syllabus.unit_completed.v1`.

**Not yet:** parents' weekly view, spreadsheet import, lesson plan review, linking homework and exams to units, the teacher app.
