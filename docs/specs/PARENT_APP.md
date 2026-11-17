# Parent App and Notices: Milestone 10 spec

Status: **draft for owner review**, written 4 November 2026 from the Schools Release spec ("Parent app and Communications"), the Build Guide (Milestone 10, UI rules) and what Milestones 1–9 already built. Anything marked _Default_ is a proposal that stands unless the owner changes it.

## Job

Every important message demonstrably reaches a guardian, and a parent can see their child's day in one glance. Missing notifications were the most repeated complaint in competitor reviews, so delivery proof is the selling point.

## Who and where

| Person             | Where                                                           | Does                                                                       |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Parent or guardian | Expo app (Android first, iOS, and a web build used for testing) | Sees each child's day, reads and acknowledges notices, applies for leave   |
| Class teacher      | Same Expo app, teacher mode                                     | Marks attendance offline (same sync protocol as the web, decision 0009)    |
| Principal, office  | Web                                                             | Composes notices, approves them, watches delivery per guardian and channel |

One app, role-based: the signed-in profile decides parent or teacher mode. A person who is both (a teacher who is also a parent) switches profile.

## Sign-in

- Phone OTP, as built (Milestone 3). _Default:_ WhatsApp OTP backup is designed in but off until a WhatsApp provider account exists; SMS-only delivery of codes until then.
- Trusted device after the first sign-in (built). Tokens live in the device's secure store (Keychain / Android Keystore via `expo-secure-store`), never in plain storage.
- **Shared phones:** after OTP, a profile picker lists every profile on that number (for example, mother at two schools, or a teacher who is also a parent). Built in the API; the app adds the picker.
- Recovery never needs a school visit unless the number is unknown. _Default:_ number change is out of scope for this milestone (needs a verified update flow with the office); listed under Later.

## Parent home

- **Child switcher** at the top: each child, plus "All children".
- **Status sentence first**, then the next action (Build Guide: "One child-status sentence, then the next action"). Examples: "Asha is marked present today." / "Asha was marked absent today. Apply for leave?" / "No attendance yet today."
- **Feed:** messages to this guardian, newest first: absence alerts, corrections, notices, circulars, holiday notices, shortage warnings. Each shows unread / read / acknowledged.
- Dues, homework, pay and teacher chat appear when their modules arrive (Fees in Milestone 11; teaching later). _Default:_ hidden, not shown as "coming soon".

## Reading and acknowledging

- Opening a message in the app records **read** for the app (push) channel. That counts as reached for circulars.
- A notice marked "needs acknowledgement" shows an **Acknowledge** button. Acknowledging moves the guardian's message to **acknowledged**, audited, once.
- A restricted guardian sees nothing and receives nothing (built rule).

## Leave from the app

Parents apply for leave or medical leave for their own child (API built in Milestone 9: `school.attendance.leave_request`, guardian relation). They see each request's status (pending, approved, rejected with the teacher's note).

## Notices (school side, web)

| Step    | Behaviour                                                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose | Title and body per language (English required, plus any of the school's parent languages); kind: notice, circular, urgent; audience: whole school, classes or sections; "needs acknowledgement" flag |
| Approve | Whole-school notices and circulars need a principal or delegate (`communications.notice.approve`). Urgent messages from named roles (principal, school administrator) skip approval                  |
| Preview | Preview Canvas: recipient count by language, guardians with no reachable channel, cost estimate for WhatsApp and SMS; preview text in each recipient language                                        |
| Send    | Scheduled with a short undo window. _Default:_ 2 minutes. Cancel inside the window → cancelled, nothing sent                                                                                         |
| Track   | Per guardian: message state and each channel's state and time. Counts: queued, sent, delivered, read, acknowledged, failed. The school can export this as proof                                      |

**Message states** (spec): draft, approved, scheduled, queued, sent, delivered, read, acknowledged, failed, fallback sent, cancelled. Draft, approved and scheduled belong to the notice; queued onward to each guardian's message.

**Channel rules** are the existing plans (shared/communications `PLANS`): urgent on push, WhatsApp and SMS together; notices on app and WhatsApp; circulars in the app with WhatsApp if unread after 24 hours; SMS as last resort for parents with no smartphone. Each guardian has their own delivery status.

## Languages

- App and message languages: English, Kannada, Telugu, Tamil, Hindi; Urdu with right-to-left layout as a test language (spec: Telangana "Urdu to test").
- Each guardian has a preferred language. _Default:_ chosen in the app on first sign-in, editable in settings; the school can set it on import later.
- A notice goes out in the guardian's language when the school wrote that version; otherwise English.
- _Default:_ the app's own interface text is drafted by Claude and marked **needs native-speaker review** before any pilot. Notice text is always written by the school.
- Fonts: Noto Sans Kannada, Telugu, Tamil, Devanagari and Naskh Arabic, with per-language line height.

## Delivery proof (exit check)

"Delivery status is correct for every channel":

- Push, WhatsApp and SMS each move only forward: queued → sending → sent → delivered → read, or failed. Late and repeated provider callbacks never move a status back.
- Fallback follows each kind's plan, and the message shows **fallback sent**.
- An uninstalled app (push token rejected) marks push unreachable and falls back.
- In-app open = read on push; acknowledgement = acknowledged on the message.
- Two guardians of one child: two messages, two independent statuses.
- The school's tracking screen and the parent's feed agree with these states.

Tested by integration tests driving each channel through provider callbacks, plus an end-to-end test where a notice is composed, approved and sent, a parent reads and acknowledges it in the app (web build), and the school screen shows the result.

## Permissions

| Permission                          | Who                                        |
| ----------------------------------- | ------------------------------------------ |
| `communications.notice.compose`     | School administrator, principal, office    |
| `communications.notice.approve`     | School administrator, principal            |
| `communications.notice.send_urgent` | School administrator, principal            |
| `communications.notice.track`       | School administrator, principal, office    |
| `communications.message.read_own`   | Parent (self relation: their own messages) |

## Out of scope for Milestone 10 (later)

Teacher chat, fee dues and payment (Milestone 11), homework, phone number change, WhatsApp OTP and real push/WhatsApp/SMS providers (need accounts: FCM, a WhatsApp BSP, an SMS gateway with DLT templates), per-school message budgets, digests, recall of a sent notice, printed notices, Maestro device tests (need simulators on the owner's machine).

## Open questions for the owner

1. Undo window for sending: 2 minutes?
2. Should office staff send urgent messages, or only principal and administrator?
3. Which languages must be in the first pilot? (Default: English plus the pilot school's state language.)
4. Who reviews the drafted Kannada, Telugu, Tamil, Hindi and Urdu interface text?
5. Store accounts: Google Play developer account and Apple developer account, and FCM project, when ready.
