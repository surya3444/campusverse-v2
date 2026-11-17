# Syllabus and lesson plans: spec

Status: **step 1 built** (11 November 2026); step 2 when schools ask. From the platform map (Academics → Syllabus and lesson plans) and what schools keep on paper: a yearly syllabus split by month, a "portion covered" register per class, and a teacher's lesson plan diary the principal signs. Anything marked _Default_ stands unless the owner changes it; the owner asked for decisions without questions.

## Job

Each subject's syllabus for a class is a list of units (chapters) with the month they're planned for. Teachers tick a unit done for their section the day they finish it. The principal sees, for every class and subject, how much is covered against the plan and which sections are behind, without asking anyone. Teachers write short lesson plans for the days they teach, and next year starts from this year's syllabus in one step.

## Module

**`modules/school/syllabus`** (school academics). Years, classes, sections, subjects and who teaches what come from school/setup (`sectionsOn`, `teachingPlan`, `teaches`, `classTeacherSections`).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                      | Holds                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `school_syllabus_unit`     | Year, class, subject, position, title, planned month (first day of the month, optional), periods, notes |
| `school_syllabus_progress` | Unit, section, completed on, completed by, note: one row per unit and section                           |
| `school_lesson_plan`       | Section, subject, unit (optional), date, the plan, written by: one per section, subject and date        |

**Permissions** (SCHOOL_ROLES, migration, access catalogue, new area `syllabus`):

- `school.syllabus.read`: every staff role.
- `school.syllabus.teach`: teacher, principal, school admin. Units for subjects they teach in that class; ticks and lesson plans for sections and subjects they teach (class teachers: any subject of their section).
- `school.syllabus.manage`: principal, school admin. Any class and subject; copying last year's syllabus.

**Events:** `school.syllabus.unit_completed.v1`.

## Decisions (_Default_, 11 November 2026)

1. **Units belong to a class, not a section**: every section of Class 5 follows the same English syllabus; each section ticks its own progress.
2. **Planned month** is optional. **Expected by now** counts units planned for this month or earlier; a section is **behind** when it has ticked fewer than that.
3. **Ticking done** records today (or an earlier school-year date) and who ticked it; untick removes it, audited.
4. **A unit in use** (ticked anywhere or in a lesson plan) can be renamed or moved but not deleted.
5. **Lesson plans** are one per section, subject and day, written by someone who teaches it; editable until the day after, then fixed. The principal sees them; no sign-off step in step 1.
6. **Copy from last year**: for every class and subject with units last year and none this year, copies titles, order and periods, moving planned months on by a year. Preview shows what would be copied; commit does it.

## Screens

| Screen         | Behaviour                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Syllabus (web) | Key figures (units this year, covered, sections behind). **Plan**: class and subject, units in order with planned month and each section's tick; Add unit, Edit (modals); Copy from last year (preview, then commit) |
| Coverage       | Every class and subject: covered against expected, sections behind flagged                                                                                                                                           |
| Lesson plans   | Section, subject and week; write or edit a day's plan (modal)                                                                                                                                                        |

## Steps

1. Units, progress ticks, coverage and behind flags, lesson plans, copy from last year, Verse AI `syllabus.coverage` (counts) and `syllabus.unit.complete` (act), tests (allowed and refused, end to end).
2. Parents see what was covered this week in the app; import a syllabus from a spreadsheet; lesson plan review by the principal; linking homework and exams to units; the teacher app.
