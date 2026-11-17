# school/homework

Homework and the class diary (docs/specs/HOMEWORK.md). School only. Who teaches what comes from school-setup (`teaches`, `classTeacherSections`, `teachingPlan`); a child's section from school-enrolment (`sectionOf`, `sectionRoster`); holidays from school-attendance (`holidayOn`); files from platform/documents; messages to guardians through communications (`notifyGuardians`, kind `homework`: app only).

| Use case                                    | What                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setHomework`                               | One homework for one or more sections, due today to 60 days ahead, with up to 3 photos or PDFs (`school.homework.set`; teachers only where they teach, managers anywhere). Returns a Sunday or holiday warning |
| `editHomework`, `withdrawHomework`          | By whoever set it, or `school.homework.manage`. A new due date tells guardians again; withdrawn homework leaves the parent app but stays on record                                                             |
| `myClasses`, `sectionHomework`              | A teacher's sections with the subjects they can set; one section's homework (done counts per section) and the last week's diary                                                                                |
| `childHomework`, `markDone`, `homeworkFile` | Guardians: the child's open homework with ready attachments and their done tick (`school.homework.done`); attachments open only for staff or a guardian of a child in its sections                             |
| `writeDiary`, `editDiary`                   | The class diary: entries per section and day by its teachers (general notes by the class teacher); writer edits the same day, managers any time                                                                |
| `homeworkTools`, `homeworkSummary`          | Verse AI `homework.summary`: the last 7 days by class, classes with none, due next, done share (counts only)                                                                                                   |
| `homeworkJobs`                              | Worker: one app message per child's guardians when homework is set, and when its date moves (deduplicated)                                                                                                     |

**Owns:** `school_homework`, `school_homework_section`, `school_homework_file`, `school_homework_done`, `school_diary_entry`. **Events:** `school.homework.set.v1`, `school.homework.due_changed.v1`, `school.diary.written.v1`.

The teacher app sets homework (with a camera photo) and writes the diary through the same API.

**Not yet:** submissions and grading, a weekly digest for parents, lesson-plan links.
