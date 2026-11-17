# Hostel: spec

Status: **step 1 built** (10 November 2026); step 2 when schools ask. Written from the platform map (Operations → Hostel, build order item 5, "for residential schools") and what wardens keep on paper today: a room register, a night roll call book and an outpass book. Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

The warden knows every bed: who sleeps in it since when, and which are free. The night roll call takes two minutes on a phone, and the guardians of a child who isn't there hear at once. A child leaves the hostel only on an approved outpass, never with a restricted guardian, and the family hears when the child leaves and when they're back. Parents ask for an outpass from the app.

## Module

**`modules/shared/hostel`**, shared because colleges run hostels the same way.

- A hostel belongs to one institution (schools first; a hostel shared by a campus's schools waits for step 2).
- Students are found through people/records (`searchMembers`, `memberKind`, `studentFacts` for gender); a student's class comes through `AcademicPlacementPort`.
- Who may collect a child reuses the gate's rule (`collectorCheck` from shared/gate, with `pickupGuardians`).
- Messages go through communications from the worker, with a new kind `hostel` (app first, WhatsApp after 5 minutes).
- Residents are an audience (`hostelAudience`), so a fee plan can bill "Hostel: Boys hostel residents" and a notice can reach them, always within the school's own students.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table               | Holds                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostel`            | Institution, name (unique there), kind (`boys`, `girls`, `mixed`), active                                                                                                                         |
| `hostel_room`       | Hostel, room number (unique there), floor, beds (1–20), active                                                                                                                                    |
| `hostel_allocation` | Student, room and bed, `valid_during` (a move is a new row, like enrolment), who allocated, why it ended                                                                                          |
| `hostel_roll_call`  | Hostel, date, session (`night`, `morning`), who took it and when                                                                                                                                  |
| `hostel_roll_mark`  | Roll call, student, `present` / `absent` / `on_leave`                                                                                                                                             |
| `hostel_outpass`    | Student, leaves on, back by, reason, who collects (a guardian on record, or a named person with relation and phone), state, who asked, who decided and the note, left and returned (when and who) |

**Rules the database enforces:** a student has one bed at a time, and a bed one student at a time (exclusion constraints on `valid_during`); a bed number is within the room's beds (checked on allocating); one roll call per hostel, date and session; back-by is on or after leaves-on; a rejection has a note; an outpass collected by someone else has a name, relation and phone.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `hostel`):

- `hostel.resident.read`: owner, school admin, principal, office, warden; parents for their own children (relation `guardian`).
- `hostel.room.manage`: owner, school admin, principal, warden. Hostels, rooms, allocation.
- `hostel.rollcall.mark`: owner, school admin, principal, warden.
- `hostel.outpass.decide`: owner, school admin, principal, warden. Issue, approve, reject, let out, mark back.
- `hostel.outpass.request`: parents for their own children (relation `guardian`).
- A new **Hostel warden** role (`warden`) holds the four staff permissions, plus the self grants every staff role has.

**Events:** `hostel.rollcall.submitted.v1`, `hostel.outpass.requested.v1`, `hostel.outpass.decided.v1`, `hostel.outpass.left.v1`, `hostel.outpass.returned.v1`.

## Decisions (_Default_, 10 November 2026)

1. **Rooms and beds:** a room has numbered beds (1 to its bed count). Lowering a room's beds below a bed in use is refused.
2. **Allocating:** pick a free bed, find the student by name or admission number. The student must be enrolled in the hostel's school. A boys' hostel takes students recorded as male, a girls' hostel female; a student whose gender isn't recorded can go anywhere (the warden decides). A student already in a bed is **moved**, never given two beds. **Vacating** frees the bed from tomorrow (today if they were allocated before today) with a reason.
3. **Roll call:**
   - The warden picks the hostel and session (night by default); every resident starts unmarked, and residents out on an outpass start as on leave.
   - Saving needs every resident marked. The roll call can be corrected the same day.
   - Guardians of each child marked absent are told once per roll call: "Omkar wasn't at the hostel's night roll call on 10 Nov. The warden is checking." This ignores the academic-messages opt-out: it's a safety message.
4. **Outpasses:**
   - **Parents ask** in the app: dates, reason, and who collects (themselves, another guardian, or someone else by name, relation and phone). The warden approves or rejects with a note; the parent is told.
   - **The warden issues** one directly (already approved), for a parent who phoned.
   - **Leaving:** the warden taps Left when the child goes; the collector is checked again, and a restricted guardian is refused, however typed. Guardians are told.
   - **Back:** the warden taps Back. A child not back by the end of the back-by day is **overdue** and shows on the list until back. Guardians are told when the child is back.
   - A request can be cancelled by the parent or the warden until the child has left.
5. **Fees:** residents are a fee audience; the hostel fee is a normal fee plan in finance, so receipts and dues stay in one place.

## Screens

| Screen       | Behaviour                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hostel (web) | Key figures (residents, free beds, out on outpass, absent at the last roll call). **Rooms**: hostels, then each room with its beds; a free bed allocates, an occupied one moves or vacates. **Add hostel** and **Add room** (modals) |
| Roll call    | Hostel, session, today; every resident with Present, Absent, On leave; Save                                                                                                                                                          |
| Outpasses    | Requests, Approved, Out, Overdue; **Issue outpass** (modal); Approve, Reject, Left, Back, Cancel                                                                                                                                     |
| Parent app   | A **Hostel** button on each child: room and bed, the last roll calls, outpasses, and **Ask for an outpass**                                                                                                                          |

## Steps

1. Hostels, rooms and beds, allocation with moves and vacating, the night roll call with absent alerts, outpasses requested by parents or issued by the warden with the collector check, overdue returns, residents as a fee and notice audience, the warden role, the parent app, Verse AI `hostel.today` (counts only), tests (allowed and refused, end to end).
2. Mess menu and attendance, a hostel shared by a campus's schools, wardens limited to their own hostel, room inventory and damage charges, visitors to residents through the gate, sick bay, bulk allocation from a spreadsheet (preview, then commit).
