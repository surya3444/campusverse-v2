# platform/verse

Asking Verse AI as a use case (spec: `docs/specs/VERSE_AI.md`). `askVerse(deps, actor, {institutionId, question, page})`:

1. `platform.verse.ask` is checked (staff roles: school administrator, principal, teacher, office).
2. The tools this person may use are chosen with `can()` at their institution (`selectTools`).
3. Off when no model is configured or the customer's `verse_ai` flag is off; refused when this month's tokens (Asia/Kolkata calendar month) reach the plan's `ai_monthly_tokens`.
4. The gateway runs outside any transaction; each tool opens its own, through its module's use case.
5. One `verse_request` row (append-only) and an audit row are written through `command()`.

Answers carry `ai: true`, sources with dates, and drafts (links to the normal screen, pre-filled). `verseUsage` returns this month's tokens and questions.

**Owned tables:** `verse_request` (migration 0013). The budget column `ai_monthly_tokens` is on `control.plan` (platform/control).

**Events:** none.

**Tools today:** `help.search` (packages/verse-ai), `school.attendance.today` (school/attendance), `finance.dues.summary` (shared/finance), `school.exams.progress` (school/exams), `communications.notice.draft` (shared/communications). The API wires them in `apps/api/src/verse.ts`.

**Providers and tools (Milestone 22):** Claude or OpenAI (`openaiModel` in packages/verse-ai translates the conversation to OpenAI chat completions; `VERSE_PROVIDER` picks). New tools, operational data only: `staff.attendance.today`, `school.admissions.summary`, `people.documents.awaiting_check`, `school.subjects.gaps`, `school.exams.results`. Later: `timetable.today`, `timetable.free_teachers`, `staff.leave.today`, `homework.summary` (counts only).

**Verse AI first (decision 0021, docs/specs/VERSE_AI_FIRST.md):** `askVerse` takes a `conversationId` (follow-ups see the last 6 turns) and stores each action an `act` tool prepared as a `verse_action` (migration 0039). `confirmAction` runs it for its own person only, within 15 minutes, once (claimed before running), after checking the tool's permission again; the module's own use case does the change and its audit, and `platform.verse.act` is audited beside it. `dismissAction`, `conversation` and `conversations` complete it. Act tools today: `gate.visitor.check_out`, `library.loan.return`, `library.loan.issue`, `expenses.bill.decide`, `hostel.outpass.decide`, `staff.leave.decide`; read tools with names: `people.find`, `gate.inside`, `expenses.bills.waiting`, `hostel.outpasses.waiting`, `staff.leave.waiting`.

**Owned tables (also):** `verse_action`; `verse_request.conversation_id`.

**Not yet:** the parent and teacher app, nightly checks, translations and import mapping, tools returning personal data, usage shown in the school's settings and the admin portal.
