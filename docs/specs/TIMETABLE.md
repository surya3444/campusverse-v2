# Timetable: Milestone 19 spec

Status: **steps 1 to 4 built** (8–9 November 2026); separate bell schedules wait until a school asks (decision 2). Written from the Schools Release spec (M7: "Manual timetable and substitution. Auto-generation later"; "Grid editor with clash checks; versions by effective date"; states draft, published, superseded), the Build Guide (timetable is separate by institution type) and what Subjects already holds (periods per week per class, dated subject-teacher allocations). Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

Every section knows what it has each period, every teacher knows where to be, and when a teacher is away the office covers each period in two taps. A clash (one teacher, two rooms) never reaches a published timetable.

## Module

`modules/school/timetable` (school only; college and university timetables differ and come with them). It reads classes, sections, offerings and subject teachers through the setup contract (`teachingPlan`), never setup's tables. Staff absences for cover come from `shared/staff-attendance` (step 2).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                             | Holds                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `school_timetable`                | A version for one institution and year: name, state (`draft`, `published`), effective from, working days                                                                   |
| `school_timetable_period`         | The bell schedule of a version: number, start, end, kind (`class`, `break`), label                                                                                         |
| `school_timetable_slot`           | Section, weekday, period, subject, teacher (optional), room (optional). Unique per section, day, period                                                                    |
| `school_timetable_group` (step 4) | A teaching group of a version: name; its sections in `school_timetable_group_section`. A group's lesson is a slot with the group instead of a section, one row per subject |
| `school_cover` (step 2)           | Date, period, section, absent teacher, covering teacher (or "combined / supervised"), by, at                                                                               |

**Clash rules, enforced by the database where they can be:** one teacher one place per day and period in a version (unique index); one room one section (unique index); the same teacher in another institution's published timetable at overlapping times blocks publishing (checked at publish, listed by name, period and school).

**States:** `draft` (editable), `published` (read-only, in effect from its date). A published version is _superseded_ once a later published version's date has come; it stays as history and is never edited. Changing a published timetable = **Copy to a new draft**, edit, publish from a chosen date.

**Permissions** (SCHOOL_ROLES, migration, access catalogue): `school.timetable.read` (every staff role), `school.timetable.manage` (school admin, principal; the owner holds all). Parents see their own child's (guardian relation) from step 3.

**Events:** `school.timetable.published.v1`, `school.cover.assigned.v1` (step 2).

## Decisions (_Default_, 8 November 2026)

1. **Working days:** Monday to Saturday; the school unticks days per version (for example second Saturdays come from the holiday calendar, not the timetable).
2. **One bell schedule per version** for the whole school. Classes that finish early leave their last periods empty. Separate bell schedules for primary and secondary come with step 4 if schools ask.
3. **Teacher per slot** defaults to the section's subject teacher (from Subjects); it can be changed for that slot. A slot may have no teacher (games, library) but never a clash.
4. **Rooms are optional** free text ("Lab 2"). Two sections in one room at once is refused.
5. **Periods per week** from Subjects show as a target on each section ("Maths 5 of 6"); short or over is a warning, never a block.
6. **Holidays and exam days:** today's periods are empty on a school holiday. Exam overlay comes with step 4.
7. **Cover (step 2):** free teachers ranked by: free that period, teaches the subject, teaches that class, fewest cover periods this week. The office confirms; the covering teacher is told in the app.
8. **Exam days (step 4):** on a day a class sits a paper (from the exam date sheet), that class has no lessons that day; its teachers' lessons there need no cover, and the invigilator is busy for the paper's time (all day if the paper has no time yet). Today shows the papers on an Exams lane; parents see the paper in the child's timetable.
9. **Generating (step 4):** one button, **Generate timetable**, with every rule on screen and saved with the draft:
   - _What:_ fill the empty periods (keep everything placed) or rebuild every section's lessons (teaching groups always stay).
   - _School:_ how many times a subject comes in a section's day (default once; a double counts once), a teacher's most periods a day (6) and most in a row (3).
   - _Per subject:_ double periods a week (two periods together, never across a break), morning, afternoon or any time (both halves of a double), its own times a day, and the rooms it needs ("Lab 1, Lab 2": a free one is given; a room is never in two places at once, lessons already placed included).
   - _Per teacher:_ days they aren't in, periods they aren't available every day (such as no first period, or gone after period 6), particular times they aren't available (a days-by-periods grid, such as Monday period 1 or Saturday after the break), their own most a day.
   - Hard rules are never broken (one place at a time for sections and teachers, plus all of the above). The time of day, spreading a subject over the week and an even day for each teacher order the choices.
   - The search: backtracking over the combinations, the most constrained subject first, identical lessons in one order so the same arrangement isn't tried twice, restarted with new seeds; up to 20 seconds. A teacher with more periods than their week can hold, or rooms booked beyond their week, are caught up front. If no complete timetable exists under the rules, the fullest one found is offered with what didn't fit, by section and subject.
   - It runs on the worker (the API answers 202); the screen shows the result in the Preview Canvas (lessons, what doesn't fit, subjects with no teacher, how many lessons kept their time of day) and **Place N lessons** writes exactly that result. If the draft's lessons changed meanwhile it is refused and asks to generate again.
10. **Teaching groups (step 4):** sections that come together in a period and split by subject (second language, electives), each subject with its teacher and room. The same clash rules apply; a section in a group can't have its own lesson then. A group's lesson counts toward each of its sections' periods per week. Which student takes which subject isn't recorded yet, so parents see the group's subjects.

## Screens

| Screen         | Behaviour                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timetable      | Versions (draft, published from a date, superseded). The current one opens by default. New version (bell schedule and days) in a modal; Copy to new draft; Publish from a date (with the clash check) |
| Section view   | Grid of days by periods for one section; each cell opens a modal (subject from the class's offerings, teacher defaulting from Subjects, room). Targets per subject. On a phone: one day at a time     |
| Teacher view   | The same grid for one teacher across sections, with their periods per week                                                                                                                            |
| Today (home)   | A Classes lane on the Day Line with the periods; a teacher sees their own periods                                                                                                                     |
| Cover (step 2) | Absent teachers today and each of their periods, with ranked free teachers; Assign; combined or supervised when nobody is free                                                                        |

All screens: loading, empty, error, offline and denied states; axe clean at desktop and 360 px.

## Build order

1. Versions, bell schedule, grid editor with clash checks (teacher, room, across institutions at publish), publish by date, section and teacher views, periods on the Today screen.
2. Cover for absent teachers (from staff attendance and leave), ranked suggestions, assign and notify, cover count per teacher.
3. Teacher's day in the mobile app; the child's timetable in the parent app; Verse AI `timetable.free_teachers` and `timetable.today`.
4. Teaching groups across sections (languages, electives), exam-day overlay, separate bell schedules, auto-generation.

## How step 2 was built

- **Who is away** comes from the staff register (absent, on leave, on school duty), as staff attendance already records it. The Cover tab can mark someone away on the spot (it writes the same register; a later day takes on leave or on duty only).
- **Cover tab** (Timetable → Cover, for school admin, principal and office): each away teacher's lessons that day, and for each, the three best free teachers as one-tap buttons, saying why ("teaches this subject · teaches this class · 1 cover this week · 3 lessons today"). Combine or Supervise when nobody fits. Change and Undo keep the history (a change cancels the old row).
- **Free** means: on the staff, not away, no lesson of their own that period, not covering another lesson then. The database refuses one teacher covering two lessons at once.
- **The covering teacher is told** in the app ("Cover: Class 5-A English, period 3", with the time, whose lesson and any note). Their Today screen shows the lesson on the Classes lane, marked "(cover)".
- **Today** shows "N lessons need cover today" for people who arrange cover, leading straight to the Cover tab.
- Not in this step: suggesting from staff of another school on the campus, splitting a class across teachers, a cover report for the month (the rows are kept for it).

## How step 3 was built

- **Teacher's day in the app:** the home screen lists "Your lessons today" (time, class, subject, period, room), including lessons they cover and leaving out their own lessons someone else covers. Same rule as the web Today screen.
- **The child's timetable for parents:** a Timetable button on each child's card opens today and the coming school days (days off left out, holidays said), with the teacher of each lesson, or the covering teacher marked "Cover", or "Combined with another class" / "Supervised study". Parents hold `school.timetable.read` for their own children only (migration 0029). Words in all six app languages (non-English drafts need native review).
- **Verse AI:** `timetable.today` (the asker's own lessons, and the school's lessons and covers that day) and `timetable.free_teachers` (how many are free in a period, for people who arrange cover). _Default:_ no teacher names go to the model (decision 0015 keeps personal data out until it is cleared); the answer links to the Cover tab, which shows who.
- Not in this step: a student login, push reminders before each lesson.

## How step 4 was built

- **Teaching groups:** a Teaching groups list under the grid (draft: new, edit, remove). In a section's free cell, "Place a group here" opens the group's period: subjects, each with teacher and room, starting from the group's usual subjects elsewhere in the week. The grid shows the group's name and subjects; a teacher's week shows the group's name. Copying a version copies its groups. Database: `school_timetable_group` and its sections (migration 0030), group lessons as slots with `group_id`, so the teacher and room unique indexes cover both kinds.
- **Exam days:** the timetable reads the day's papers through the exams contract (`papersOn`). See decision 8.
- **Generate timetable:** rules saved on the version (`generate_rules`), each run kept in `school_timetable_generation` (migration 0031) with the rules and a fingerprint of the draft; the worker's `school.timetable.generate` job runs the search in `domain/generate.ts`; Place writes the stored result (decision 9). A 30-section school (46 periods each, a double for science) takes about 3–4 seconds.
- **Not built:** separate bell schedules (decision 2: when a school asks), recording which student takes which group subject, exam-day changes to the bell, soft teacher preferences ("rather not", as opposed to "not available").

## Acceptance tests

- A teacher can't be placed in two sections in the same period of a version; a room can't hold two sections; the error names the other section.
- Publishing is refused while a shared teacher overlaps another school's published timetable; the problem names the teacher, day and period.
- A published version can't be edited; Copy to new draft and publish from a later date keep the old version in effect until then.
- Today's periods come from the version in effect that day and are empty on a holiday.
- Allowed and denied cases for read and manage.
