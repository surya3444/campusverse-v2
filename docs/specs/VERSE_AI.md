# Verse AI, Stage A and B (Milestone 15)

Status: draft, 5 November 2026. Written from the build guide (Verse AI, Milestone 15) and the Schools Release spec ("Mitra in the first release"). Open questions at the end carry the defaults that were built.

**Exit check:** Verse AI can't reveal data outside the user's permissions.

## What it does in this milestone

| Stage    | Verse AI can                                 | Example                                                           |
| -------- | -------------------------------------------- | ----------------------------------------------------------------- |
| A: Ask   | Answer from tools, with sources and dates    | "Which classes haven't marked attendance?" "How much is overdue?" |
| A: Guide | Explain how to do a task, linking the screen | "How do I issue a TC?"                                            |
| B: Draft | Prepare a notice for review                  | "Draft a notice that school is closed on Friday"                  |

It never writes. A draft opens the normal screen, pre-filled; the person reviews and sends it themselves.

**Not in this milestone:** confirmed actions (Stage C), nightly checks, translations of existing notices, import mapping, the parent and teacher app, answers about named students.

## Request flow

1. The API authenticates the person (ActorGuard), as for every request.
2. Verse AI is refused if the customer's `verse_ai` flag is off or this month's token budget is spent. The product works without it.
3. The gateway offers only the tools this person's permissions allow at their institution.
4. The model answers or asks for tools. A tool that wasn't offered, or input that fails its schema, is refused.
5. Each tool runs the module's ordinary use case, so `can()` and RLS apply again.
6. Tool output is cleaned (no phone numbers, emails or 12-digit identifiers) and passed back marked as data, never instructions.
7. The question, tools used, their data classes, the answer, tokens and the outcome are logged (append-only).

## Tools at start

| Tool                          | Risk  | Permission                      | Data class  | Returns                                        |
| ----------------------------- | ----- | ------------------------------- | ----------- | ---------------------------------------------- |
| `school.attendance.today`     | read  | `school.attendance.read`        | operational | Sections marked and not marked today, holidays |
| `finance.dues.summary`        | read  | `finance.invoice.read`          | operational | Overdue totals by age (no names)               |
| `school.exams.progress`       | read  | `school.exam.read`              | operational | Exams, papers submitted, state                 |
| `help.search`                 | read  | none                            | public      | How-to articles with links to the screen       |
| `communications.notice.draft` | draft | `communications.notice.compose` | operational | A notice draft for review                      |

Only `public` and `operational` tools are offered. Tools that return personal data (names, marks of named students) stay off until the model's hosting and data terms are reviewed (guide: "send no student data to a model without review").

## Model

- Claude through the Anthropic API (`claude-opus-5-5` by default, low effort), when `ANTHROPIC_API_KEY` is set.
- Development without a key uses a small offline model that picks tools by keywords, so the whole flow works and is testable without sending anything anywhere.
- Every answer is labelled AI, shows its sources and the date they were read, and replies in the language of the question.

## Budgets and switches

- A monthly token budget per plan (`control.plan.ai_monthly_tokens`): Pilot 2 million, Standard 10 million. Over budget, Verse AI says so and the product carries on.
- The `verse_ai` feature flag (Milestone 14) turns it on or off per customer.

## Evaluations

- Always run (offline model): wrong-tenant access, a tool that wasn't offered, a denied permission, prompt injection in tool output, sensitive-field removal, budget and off switch, logging.
- Live (real model, only when a key is set and `VERSE_LIVE_EVAL=1`; costs money): the same questions answered by Claude, checked for refusals, injection, regional language answers and no leaked data.

## Open questions for the owner

1. Model hosting: the Anthropic API (default here), or Claude on AWS Bedrock in Mumbai for Indian-region inference? The guide says to confirm before any student data is sent.
2. When may tools return personal data (names, marks), and after which review?
3. Are 2 million and 10 million tokens a month the right budgets for Pilot and Standard?
4. Should Verse AI's questions be kept for one year like other access logs, or less?
