# Verse AI first: spec

Status: **step 1 built** (10 November 2026). Decision 0021 (changes 0015). Builds on docs/specs/VERSE_AI.md.

## Job

A principal, office clerk, librarian or warden opens Campus Verse and just says what they need: "who's waiting for me?", "approve the plumber's bill", "return ACC-0042", "check Ramesh out", "approve Omkar's outpass". Verse AI finds the people and records with the person's own permissions, shows exactly what it will do, and does it when they tap Confirm. Everything it does goes through the same code, checks and audit as the screens.

## How an action works

1. The person asks. The gateway offers only tools they hold the permission for (as before).
2. For an `act` tool the model calls, the gateway runs its **prepare** step: read-only, it finds the record and returns a preview (a title, the lines that will change, the button word, and a tone: normal or money). The model is told "prepared for the person to confirm; nothing has changed yet".
3. The answer shows an **action card**: the preview, **Confirm** and **Not now**.
4. **Confirm** (`POST /verse/actions/:id/confirm`): the proposal must belong to this person, be under 15 minutes old and not used; the tool's permission is checked again; its **execute** runs the module's normal use case as that person. The card then shows what happened, or why not (the module's own error, in words).
5. Every proposal is a `verse_action` row (proposed, done, failed, dismissed, expired), with the request it came from; confirming writes `platform.verse.act` to the audit beside the module's own audit row.

## Tools in step 1

| Tool                       | Kind | Module                  | Does                                                                  |
| -------------------------- | ---- | ----------------------- | --------------------------------------------------------------------- |
| `people.find`              | read | people/records          | Students and staff by name, admission number or employee code (names) |
| `gate.inside`              | read | shared/gate             | Visitors inside now (names, purpose, since)                           |
| `gate.visitor.check_out`   | act  | shared/gate             | Check a visitor out                                                   |
| `library.loan.return`      | act  | shared/library          | Take a book back by accession number (fine shown if late)             |
| `library.loan.issue`       | act  | shared/library          | Issue a book by accession number to a student or staff member         |
| `expenses.bills.waiting`   | read | shared/expenses         | Bills waiting for approval or payment (payee, amount, category)       |
| `expenses.bill.decide`     | act  | shared/expenses         | Approve or reject a bill (money: shown with the budget position)      |
| `hostel.outpasses.waiting` | read | shared/hostel           | Outpass requests and approved passes (student, dates, collector)      |
| `hostel.outpass.decide`    | act  | shared/hostel           | Approve or reject an outpass                                          |
| `staff.leave.waiting`      | read | shared/staff-attendance | Leave requests waiting (staff name, dates, type)                      |
| `staff.leave.decide`       | act  | shared/staff-attendance | Approve or refuse a leave request                                     |

Added in step 2 (11 November 2026):

| Tool                        | Kind | Module            | Does                                                                          |
| --------------------------- | ---- | ----------------- | ----------------------------------------------------------------------------- |
| `finance.reminders.send`    | act  | shared/finance    | Fee reminders to guardians of students overdue by N days (preview, then send) |
| `school.attendance.correct` | act  | school/attendance | Correct one student's day, with a reason; the original stays in the history   |
| `school.leave.waiting`      | read | school/attendance | Parents' leave requests waiting                                               |
| `school.leave.decide`       | act  | school/attendance | Approve or reject a parent's leave request                                    |
| `homework.set`              | act  | school/homework   | Set homework for a class and subject named in words                           |

Added with the new modules (11–12 November 2026): `syllabus.coverage` (read) and `syllabus.unit.complete` (act), `helpdesk.summary` (read, names) and `helpdesk.ticket.reply` (act), `assets.summary` (read), `appraisal.progress` (read, counts only: ratings and comments never reach the model).

Every act tool takes an id or a name (`pickOne`): the card shows exactly which record it found, and Confirm runs on that record (`confirmInput`).

Existing tools stay (counts and summaries, help, the notice draft).

## Screens

| Screen                 | Behaviour                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verse AI home (`/ask`) | Where sign-in lands. A large ask box; **Needs you** (bills, outpasses, leave, visitors inside, overdue books: whatever the person can see) with "Ask Verse" on each; suggestions for the role; recent conversations |
| Conversation           | Questions and answers in order, sources, drafts and action cards; follow-ups keep the context                                                                                                                       |
| Panel                  | A **Verse AI** button in every page's header opens the same conversation in a side panel, told which page the person is on; Ctrl K's "Ask Verse AI" opens it too                                                    |

## Defaults

- Proposals expire after 15 minutes; a second confirm does nothing.
- Follow-ups see the last 6 questions and answers of the conversation.
- The offline development model understands a few fixed phrasings ("return ACC-…", "check out …", "who is waiting") so the home works without a key; with a key, the real model is used.
- The answer and every card say they come from Verse AI.

## Steps

1. The above: actions with confirm, names, the home, the panel, conversations, tests (allowed, refused, expired, someone else's proposal, permission removed before confirming).
2. More act tools (attendance corrections, homework, notices sent after review, fee reminders), voice input, Kannada and Hindi phrasings in the offline model, a daily briefing, multi-step plans confirmed together.
