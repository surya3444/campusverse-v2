# Helpdesk: spec

Status: **step 1 built** (11 November 2026); step 2 when schools ask. From the platform map (Operations → Helpdesk: "requests from parents and staff, routed with time limits") and how school offices work today: phone calls, notes on paper and WhatsApp messages nobody can track. Anything marked _Default_ stands unless the owner changes it.

## Job

A parent asks a question or reports a problem from the app, about their child; a staff member does the same on the web. Each request lands with the right person for its category, with a time to answer. Everyone can see what's open, who has it and what's overdue; the person who asked hears every reply and when it's resolved. Nothing gets lost in a WhatsApp group.

## Module

**`modules/shared/helpdesk`**, shared because colleges and universities take requests the same way. The child's class comes through `AcademicPlacementPort`; names through people/records; messages through communications from the worker (new kind `helpdesk`: app first, WhatsApp after an hour).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table               | Holds                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `helpdesk_category` | Organisation-wide: name, hours to answer, default assignee (a staff member, optional), who may use it (parents, staff or both), active |
| `helpdesk_counter`  | The next request number per institution                                                                                                |
| `helpdesk_ticket`   | Number, category, raised by, about which child (parents), subject, priority (`normal`, `urgent`), state, assignee, due at, resolved at |
| `helpdesk_message`  | Ticket, author, body, internal (staff-only note), at                                                                                   |

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `helpdesk`):

- `helpdesk.ticket.raise`: every staff role (their own requests, relation `self`); parents for their own children (relation `guardian`).
- `helpdesk.ticket.handle`: owner, school admin, principal, office. See every request here, reply, assign, change state, write internal notes. Anyone a request is assigned to can work it too, with this permission or not.
- `helpdesk.setup.manage`: owner, school admin, principal. Categories, hours and default assignees.

**Events:** `helpdesk.ticket.raised.v1`, `helpdesk.ticket.replied.v1`, `helpdesk.ticket.resolved.v1`, `helpdesk.ticket.assigned.v1`.

## Decisions (_Default_, 11 November 2026)

1. **Categories** start as Fees and payments (24 hours), Transport (8), Academics and homework (48), Facilities and repairs (72, staff only), IT and logins (24), Other (48). Schools change names, hours and assignees; a category with requests is switched off, never deleted.
2. **Due time** is raised-at plus the category's hours (urgent: half), counted on the clock, not school days. A request not resolved by then is **overdue**; overdue shows first.
3. **States:** `open` → `in_progress` (someone replied or took it) → `waiting` (asked the requester something) → `resolved`; the requester can **reopen** a resolved request within 7 days with a reply; `closed` after that (step 2 closes automatically; in step 1 resolved is the end unless reopened).
4. **Internal notes** are never shown to the requester or sent to them.
5. **Messages:** the requester hears each public reply and the resolution; the assignee hears when a request is assigned to them. Parents' messages go in their language's app inbox (English text in step 1).
6. **Parents** see only requests they raised; **staff** see only their own unless they handle requests.

## Screens

| Screen         | Behaviour                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Helpdesk (web) | Key figures (open, overdue, waiting on the requester, resolved this week). Lists: Open, Assigned to me, Overdue, Resolved; **New request** (modal). A request opens in a side panel: the thread, reply (public or internal note), assign, change state |
| Categories     | Name, hours, default assignee, who may use it; add and edit (modal)                                                                                                                                                                                    |
| My requests    | For any staff member: their own requests and replies                                                                                                                                                                                                   |
| Parent app     | **Help** on the home: their requests with replies, **Ask for help** (category, child, subject, details), reply, reopen                                                                                                                                 |

## Steps

1. Categories with hours and assignees, requests from staff and parents, threads with internal notes, assign and states, overdue, messages to requester and assignee, the parent app, Verse AI `helpdesk.summary` (counts) and `helpdesk.ticket.reply` (act), tests (allowed and refused, end to end).
2. Per-school assignees for a category, automatic closing after 7 days, satisfaction rating, attachments, escalation to the principal when overdue, canned replies, reports by category and time to resolve.
