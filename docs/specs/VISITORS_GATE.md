# Visitors and gate: spec

Status: **step 1 built** (10 November 2026); step 2 when schools ask. Written from the platform map (Operations → Visitors and gate, build order item 5) and what school gates keep on paper today: a visitor register at the gate and an early-leave slip from the office. Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

The guard checks a visitor in within seconds: type the phone, and a repeat visitor's name fills itself. The school always knows who is inside right now. Staff tell the gate whom they expect. A child leaves early only with a gate pass from the office, collected by a guardian the school knows, never by one a court or the family has restricted, and the guardians hear the moment the child walks out.

## Module

**`modules/shared/gate`**, shared because colleges and universities run gates the same way.

- Students, staff and guardians are found through people/records (`searchMembers`, `memberKind`, `pickupGuardians`, `displayNames`).
- A student's class comes through `AcademicPlacementPort`.
- Messages go through communications (`requestMessage`, `notifyGuardians`), from the worker.
- The module never reads academic tables.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table          | Holds                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gate_visitor` | One per phone number across the organisation: name, and whether they are barred (reason, by whom, when)                                                                                                                              |
| `gate_visit`   | A visit to an institution: visitor, purpose, note, whom they meet (a staff member, optional), party size, vehicle number, badge, state (`expected`, `in`, `out`, `cancelled`), expected on and by whom, in and out times and by whom |
| `gate_pass`    | An early-leave pass for a student, for today: who collects (a guardian on record, or a named person with relation and phone), reason, issued by, state (`issued`, `left`, `cancelled`), left at and by whom                          |

**Rules the database enforces:** one visitor per phone in the organisation; times and people match the state (`in` has an in time, `out` has both); an expected visit has its day; a pass collected by "someone else" has a name, relation and phone; a cancelled pass has a reason.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `gate`):

- `gate.visitor.read`: owner, school admin, principal, office, security guard.
- `gate.visitor.manage`: the same roles. Check visitors in and out, and let a child with a pass out.
- `gate.visitor.bar`: owner, school admin, principal. Bar a visitor, lift a bar.
- `gate.visit.expect`: every staff role. Tell the gate whom you expect; teachers see only the visits they expect.
- `gate.pass.issue`: owner, school admin, principal, office.
- A new **Security guard** role (`security`) holds `gate.visitor.read` and `gate.visitor.manage`, and nothing else beyond the self grants every staff role has.

**Events:** `gate.visit.checked_in.v1`, `gate.pass.left.v1`.

## Decisions (_Default_, 10 November 2026)

1. **Visitors are known by phone.** An Indian mobile number, one record per number for the whole organisation, so a bar on one campus holds on every campus. The name can be corrected at each visit. ID documents aren't recorded in step 1: no Aadhaar numbers at the gate.
2. **Checking in:** phone, name, purpose (parent meeting, staff meeting, admission enquiry, delivery, vendor, interview, official, other), whom to meet (optional, a staff member), how many people, vehicle number and badge (optional). The host gets a message: "Ramesh Kumar is at the gate to see you."
3. **Barred visitors** can't be checked in. The guard sees the bar and its reason. Only the owner, school admin and principal can bar or lift a bar, always with a reason.
4. **Expected visits:** any staff member can expect a visitor on a day, and is the host. The gate sees today's expected list and checks a visitor in with one tap. An expected visit not used that day stays in history as expected; the person expecting can cancel it before then.
5. **Checking out** is one tap on the inside list. A visitor still inside at the end of the day stays on the list, marked "since yesterday", until checked out.
6. **Gate passes:**
   - The office issues a pass for a student of the institution, for today only, with a reason.
   - The collector is a guardian on record, picked from the child's guardians, or **someone else**, typed with name, relation and phone.
   - Any unrestricted guardian may collect. Guardians on the school's pickup list (the guardian link's `can_pickup`) are marked, because most schools haven't filled that list in yet; requiring it would stop every pass.
   - A **restricted guardian** (guardian link restricted, as for a court order) is never offered, and can't collect as "someone else" either: a phone matching a restricted guardian is refused.
   - The guard sees today's passes and taps **Left** when the child walks out with the collector. Guardians are told at once: "Omkar left school at 11:40 with Ramesh Kumar (father). Reason: doctor's appointment." This message ignores the academic-messages opt-out: safety messages always go.
   - A pass can be cancelled with a reason until the child has left. Yesterday's unused passes can't be used.
7. **Messages** use a new kind, `gate`: app first, WhatsApp if the push doesn't arrive in 5 minutes, as bus alerts do.
8. **Keeping visitor data:** visits are kept for 12 months, then the details are cleared in step 2 (DPDP Act); until then, RISKS.md carries it.

## Screens

| Screen     | Behaviour                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate (web) | Key figures (inside now, visitors today, expected today, passes today). **Gate**: Check in (modal), Inside now with Check out, Expected today with Check in. Built for a phone at the gate. |
| Passes     | Issue pass (modal: student search, guardians to pick or someone else, reason); today's passes with Left and Cancel                                                                          |
| History    | Visits by day, searchable by name, phone or vehicle                                                                                                                                         |
| Barred     | Barred visitors with reason; Bar a visitor, Lift bar (both with a reason)                                                                                                                   |
| Expected   | For any staff member: Expect a visitor (modal) and the visits they expect, with Cancel                                                                                                      |
| Parent app | The guardian's message in the inbox when the child leaves                                                                                                                                   |

## Steps

1. Visitors by phone, check in and out, hosts told, barred visitors, expected visits, gate passes with guardian checks and the leaving message, history, the Security guard role, Verse AI `gate.today` (counts only), tests (allowed and refused, end to end).
2. Visitor photo and ID type at check-in, printed badge with a QR code, parent pre-approves a pickup person in the app, a gate pass marks the child "left early" in attendance, clearing visit details after 12 months, deliveries and vendor log, staff in-out movement register.
