# Mentoring

Students › Mentoring (rule book §13.5; §16.4 Workflow 3; P1 item 22). For every profile: schools,
colleges and universities.

## Who and what

- **Head of department / principal** (`mentoring.allocation.manage`): gives each student one mentor at a
  time, sees each mentor's load and the students without a mentor, sees every escalation and
  closes it.
- **Mentor** (`mentoring.mentee.mentor`, teachers and faculty): sees only their own mentees, schedules
  check-ins, records what was discussed and a concern level (fine, watch, concern), and escalates.
- **Counsellor** (`mentoring.escalation.counsel`): receives escalations sent to the counsellor.
- **Parents**: hear from the school when a mentor escalates to them, from a template; never the
  mentor's notes.

## Rules

1. One mentor per student at a time (database exclusion); a new mentor ends the old assignment
   today and keeps its history.
2. A mentor must be staff of the institution; a mentee must be its student.
3. Mentors read and write only their own mentees; managers read all.
4. Notes are for school work, never counselling content: counselling stays in Health Connect,
   and nothing from it comes back here (§16.4 step 5).
5. Escalation goes to the head of department (holders of `mentoring.allocation.manage`), the counsellor
   (holders of `mentoring.escalation.counsel`) or the parent (every unrestricted guardian, by template).
6. Every write is audited; escalations emit `mentoring.escalation.raised.v1`.

## Not yet

Verse AI early-warning flags arriving as tasks (§16.4 step 2, with Verse AI Watch, P2); mentor
tasks in My Work; ratios per cadre from HR norms.
