# Staff leave and payroll inputs: spec

Status: **steps 1 and 2 built** (9 November 2026). Step 3 (salary runs) is not planned until a paying school and a CA ask. Written from the Schools Release spec (M16 HR: "Leave: types, balance, approval and cover trigger"; "Payroll decision": defer statutory payroll, "export attendance, leave and salary inputs for the school's accountant or payroll tool"), Institution Depth (staff attendance register) and the platform map's build order ("Staff leave → payroll"). Anything marked _Default_ stands unless the owner changes it; the owner asked for fewer questions, so every open point has one.

## Job

A teacher asks for leave in two taps and sees what they have left. The principal approves it, and from then on the register shows them on leave and the cover screen offers their periods. At month end the office downloads one sheet per school with paid days and loss-of-pay days for each staff member, ready for the accountant's payroll tool.

## Module

Leave lives in **`modules/shared/staff-attendance`**, not a new module: an approved leave writes the attendance register in the same transaction, and the register is that module's table. Shared, so it works for any institution type. It never reads academic tables. School holidays come through a **`HolidaysPort`** (`holidaysBetween(tx, institutionId, from, to)`), which school/attendance implements; colleges will bring their own.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                    | Holds                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff_leave_type`       | Organisation-wide: code, name, paid or unpaid, days a year (blank = no limit), most days carried into next year, half days allowed, active                            |
| `staff_leave_request`    | Person, institution, type, from, to, half day, days counted, reason, state (`pending`, `approved`, `rejected`, `cancelled`), asked by and at, decided by and at, note |
| `staff_leave_adjustment` | Append-only balance changes: person, type, leave year, days (+ or −), reason, by, at (opening balances, corrections, extra days granted)                              |
| `staff_attendance_day`   | Gains `leave_request_id`: the days an approved leave wrote                                                                                                            |

**Permissions** (SCHOOL_ROLES, migration, access catalogue):

- `staff.leave.apply`: own leave (relation `self`), every staff role.
- `staff.leave.manage`: office, school admin and principal. Covers leave types, adjustments, asking on someone's behalf, every request and balance, and the payroll-inputs sheet.
- `staff.leave.approve`: school admin and principal. Covers approving and rejecting.
- The owner holds all of them.
- Nobody decides their own leave; a database check enforces it.

**Events:** `staff.leave.requested.v1`, `staff.leave.decided.v1`, `staff.leave.cancelled.v1`.

## Decisions (_Default_, 9 November 2026)

1. **Leave types are organisation-wide.** New schools start with these, all editable:

   | Type              | Days a year | Paid | Carry forward |
   | ----------------- | ----------- | ---- | ------------- |
   | Casual leave (CL) | 12          | yes  | none          |
   | Sick leave (SL)   | 12          | yes  | up to 30 days |
   | Earned leave (EL) | 15          | yes  | up to 45 days |
   | Loss of pay (LOP) | no limit    | no   | none          |

   A type with requests is retired, not deleted. Because types cover the whole organisation, only roles held organisation-wide (the owner, an organisation-wide school admin) edit them; every staff member sees them.

2. **Leave year runs April to March,** the financial year that payroll uses. A request can't cross 31 March; ask for two.
3. **Days counted:** each date in the range, except Sundays and the school's holidays (from its holiday calendar). A single day can be a half day when the type allows it (0.5). A range with no working days is refused.
4. **Balance:**
   - The figure is this year's days, plus what carried over, plus adjustments, minus approved days, minus pending days. Pending days hold their place, so two requests can't spend the same day.
   - Carried over is last year's balance, capped at the type's limit and never below zero.
   - A new joiner gets the full year; the office corrects it with an adjustment, which needs a reason.
   - A request beyond the balance is refused with what's left; the person can choose Loss of pay instead.
5. **Overlaps:** one person can't have two pending or approved leaves on the same day.
6. **Approving** marks each counted day in the school's register as `on_leave`. A half day is marked `half_day`, because the person is in for half. The note reads "Leave: CL".
   - From then on, the cover screen lists them with their periods, because it reads the register. That's the cover trigger.
   - Any day the office already marked is overwritten. The audit keeps the old mark.
7. **Rejecting** needs a reason.
8. **Cancelling:**
   - A pending leave can be cancelled by its person or a manager.
   - An approved leave can be cancelled only before it starts; its register days are removed.
   - Once leave has started it stands, and the office corrects single days in the register.
9. **Payroll inputs** (the month sheet, one row per staff member, CSV):
   - Columns: working days, present, on duty, half days, paid leave, unpaid leave, absent, not marked, **loss-of-pay days**, **paid days**.
   - Loss of pay = unpaid leave + absent + ½ for each half day that isn't a half-day leave.
   - Paid days = calendar days − loss of pay. Sundays and holidays are paid.
   - Past working days nobody marked are listed as _not marked_ (so is a day marked on leave with no approved leave behind it) and not counted as loss of pay. The screen warns, so the office fixes them before downloading.
   - Staff on the roll on the 1st or at month end are listed, so a leaver's last month and a joiner's first appear; days outside their time with the school show as not marked.
   - Salaries, PF, ESI and tax stay in the payroll tool (Schools Release payroll decision). Campus Verse holds no salary figures.
10. **Weekly off is Sunday.** Second Saturdays and the like come from the holiday calendar.

## Screens

| Screen         | Behaviour                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff leave    | Waiting for a decision first (Approve; Reject with a reason), then this year's requests. **Ask for leave** opens a modal (type, from, to, half day, reason) showing days counted and what's left |
| My leave       | For every staff member, on the same page: what's left of each type, and their own requests with Cancel                                                                                           |
| Balances       | Staff by type for the leave year; **Adjust** opens a modal (days ±, reason)                                                                                                                      |
| Leave types    | List; New and Edit in a modal                                                                                                                                                                    |
| Payroll inputs | Month picker, the sheet, not-marked warning, **Download CSV**                                                                                                                                    |

## Steps

1. Types, balances, requests, approval into the register, cancel, adjustments, payroll-inputs sheet, web screens, tests (allowed and denied, the balance and month arithmetic, end to end).
2. The app: teachers see what's left on the home screen and ask for leave, with the days it counts and Cancel (`apps/mobile/app/staff/leave.tsx`); Verse AI `staff.leave.today`: how many staff are on leave today and in the next 7 days, and how many requests wait (counts only, for people who keep or decide leave).
3. Not planned until a paying school and a CA ask: salary structures, payslips, statutory deductions.
