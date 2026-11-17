# Homework and class diary: spec

Status: **steps 1 and 2 built** (9 November 2026). Step 3 waits until schools ask.

Sources:

- The Schools Release spec, M8 Teaching:
  - "Homework: text, photo or PDF; parent app; due date"; later: submission and grading.
  - "Class Diary: daily entry and parent view".
  - Homework messages go "App only", with no approval.
  - Edge case: "Attachment fails on a slow network: shows retry and keeps text".
- The platform map's build order.

Anything marked _Default_ stands unless the owner changes it. The owner asked for fewer questions, so every open point has one.

## Job

A teacher sets homework for their classes in under a minute, with a photo of the board or a worksheet if they like. Parents see it in the app that evening with the due date, and tick it done. The class diary tells parents what was covered each day. Nobody chases homework on WhatsApp groups.

## Module

**`modules/school/homework`** is school only. Teaching differs by institution type, and colleges get their own.

- It reads sections, subjects and who teaches what through the setup contract (`teaches`, `sectionInfo`, `sectionsOn`, `classTeacherSections`).
- It reads which section a child is in through enrolment (`sectionOf`), and holidays through school attendance (`holidayOn`).
- Files are stored through platform/documents (`storeFile`, served with `cleanFileBytes` only after the scan).
- Messages go out through communications (`notifyGuardians`, kind `homework`: app only, no fallback).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                     | Holds                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `school_homework`         | Institution, subject, title, details, set on, due on, set by, state (`open`, `withdrawn`), edited at |
| `school_homework_section` | The sections a homework is for (one homework, several sections of the same subject)                  |
| `school_homework_file`    | Up to 3 attachments (stored file ids) in order                                                       |
| `school_homework_done`    | A guardian's "done" tick for one child: by and at. Undo removes it                                   |
| `school_diary_entry`      | Section, date, subject (blank = a general note from the class teacher), text, written by, edited at  |

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `homework`):

| Permission               | Who                                                                          |
| ------------------------ | ---------------------------------------------------------------------------- |
| `school.homework.read`   | Every staff role; parents for their own children (relation `guardian`)       |
| `school.homework.set`    | Teachers, principal, school admin. Teachers: only where they teach           |
| `school.homework.manage` | Principal, school admin: any section, and others' homework and diary entries |
| `school.homework.done`   | Parents, for their own children (relation `guardian`)                        |

The owner holds every permission in the catalogue.

**Events:**

- `school.homework.set.v1`: guardians are told.
- `school.homework.due_changed.v1`: guardians are told the new date.
- `school.diary.written.v1`.

## Decisions (_Default_, 9 November 2026)

1. **Who sets homework:**
   - A teacher sets homework for a section and subject they teach on that date: the subject teacher, or the class teacher for any subject of their section.
   - Principal and school admin set it for any section.
   - The same rule applies to diary entries.
2. **One homework, several sections.** A teacher with 6-A and 6-B picks both. Parents of both see it, and each section counts its own done ticks.
3. **Dates:**
   - It's set today and due on a date from today to 60 days ahead. The default is the next school day.
   - A due date on a Sunday or a school holiday gives a warning, not a block.
   - Homework can't be backdated.
4. **Telling parents:**
   - On setting, each guardian with academic messages on gets one app message per child: "Homework: Mathematics, due Friday 14 Nov".
   - If the due date changes, they get one more message.
   - Other edits show as "edited" without a message.
   - Withdrawn homework disappears from the parent app, with no message.
5. **Attachments:**
   - Up to 3 photos (JPEG, PNG) or PDFs per homework, each under the platform's file size limit.
   - Parents see a file once its scan is clean.
   - If an upload fails, the text is kept and the screen offers a retry.
6. **Done:**
   - A guardian ticks "done" for their child, and can undo it.
   - The teacher sees "12 of 30 done" for each section.
   - There is no submission or grading yet.
7. **Who changes what:**
   - Whoever set the homework, or a manager, can edit or withdraw it. The audit keeps every version's dates and title.
   - Diary entries can be edited by their writer on the same day, and by a manager at any time.
8. **Class diary:**
   - Any number of entries for a section on a day (each teacher writes theirs), up to 1,000 characters each.
   - Parents see the child's diary day by day, with no message (a daily digest can come later).
   - Entries are dated today or a past school day in the current year.
9. **A child's homework is their current section's:** a child who joins mid-week sees the section's open homework, and one who leaves stops seeing it.
10. **Withdrawn homework** stays for the record and in the audit, never deleted.

## Screens

| Screen               | Behaviour                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homework (web)       | Opens on **My classes**: the sections the person teaches, each with this week's homework (due date, done count) and today's diary. **Set homework** and **Write in the diary** open modals. Managers pick any section |
| Section week         | One section: homework by due date and the diary by day, with Edit and Withdraw                                                                                                                                        |
| Parent app           | A **Homework** button per child: open homework by due date (attachments, Done tick) and the diary for the last school days                                                                                            |
| Teacher app (step 2) | Set homework and write in the diary from the phone, with a photo from the camera                                                                                                                                      |

## Steps

1. Homework (sections, subject, due date, attachments, edit, withdraw), done ticks, messages to guardians, class diary, the web screen, the parent app, tests (allowed and denied, end to end).
2. The teacher app (`apps/mobile/app/staff/homework.tsx`): set homework for a class they teach with a photo from the camera or gallery (`expo-image-picker`), see done counts, write in the diary. Verse AI `homework.summary`: homework set in the last 7 days by class, classes with none, what's due next, and the share ticked done (counts only).
3. Later, when schools ask: submissions and grading, a weekly digest for parents, lesson-plan links.
