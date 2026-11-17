# Connected school: spec

Status: **building** (13 November 2026). The owner asked for every module to be connected, for each job to be done in one place, and for the product to be ready for a real school's first day. Anything marked _Default_ stands unless the owner changes it.

## Job

A school office sets up a module once, from that module's own screen, and what it records shows up everywhere it matters: a bus's fee in the student's fees and the fee counter, a driver in the staff list, a hostel bed on the student's record, a teacher's salary, leave and tickets on their staff record. Nobody re-types the same thing in a second screen.

## 1. Transport, set up in one place

The Transport page opens with a **setup guide** until everything is in place. It has five steps, each with its own count and an action that opens a modal on the same page:

| Step                   | Done when                                       | Action on the page                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicles               | At least one active vehicle                     | Add vehicle (existing modal)                                                                                                                                                                 |
| Drivers and attendants | At least one person in each role on this school | **Add driver** / **Add attendant**: name, phone, joining date. They are created as staff (people/records `createStaff`) and given the Driver or Bus attendant role for this school           |
| Stops and fare zones   | At least one active stop with a fare zone       | Add stop (existing modal)                                                                                                                                                                    |
| Routes                 | At least one active route with stops            | Add route: stops in order, the usual vehicle, **usual driver and attendant** (new)                                                                                                           |
| Fees                   | Every fare zone in use has a published fee      | **Set transport fee** per zone: yearly amount and instalments. Finance's `setGroupFee` creates the Transport fee head if missing, the plan for that zone (or a new version) and publishes it |

Riders stay where they are (Riders tab, one at a time or by Excel with preview).

**Rules**

- A route's usual driver and attendant must be staff of the school. They are suggestions for the trip, not access: starting a trip still needs `transport.trip.drive` or `transport.trip.attend` (decision 1 of TRANSPORT.md).
- **Add driver** is two steps (create staff, then grant the role). If the second step fails, the person exists as staff and the screen offers "Give the Driver role" again. Granting needs `platform.role.assign`, like the Roles screen. People who can manage routes but can't assign roles see **Ask the office to add a driver**.
- _Default:_ the Transport fee head is `TRANSPORT` "Transport", education exempt (school transport of students is GST-exempt; a CA reviews it before go-live, as for every head). It isn't waived for RTE students (`rte_exempt = false`), because the RTE Act covers tuition, not transport. The school can change the head on the Fees screen.
- _Default:_ instalment choices are Annual, Two terms (June and November), Three terms (June, September and December) and Monthly (ten months, June to March). Due dates are the 10th of the month in the academic year that holds today.
- One plan per zone ("Transport zone 2"). Setting a new amount makes a new version of the same plan family, so invoices already issued stay as they were.

**Billing riders.** A student put on a route is billed for every published plan that covers them, inside the same transaction as the assignment, by finance's `billStudent` (the API passes it to transport as a port, so transport never imports finance). This applies to one rider and to an Excel import. The rider's start date counts: a student starting next month is billed from the first instalment due on or after the start date. Taking a student off a route never refunds by itself (TRANSPORT.md fees default); the office raises a concession.

**Where it shows**

- Student record: a **Transport** card (route, stop, direction, from, the bus's usual vehicle) and transport invoices in fees.
- Fees counter and student fees: transport invoices appear with every other invoice (they are ordinary invoices).
- Staff list and staff record: drivers and attendants are staff, so they appear there with their role, and the staff record shows the routes they usually run.

## 2. The student record shows the whole student

The student's Overview gets a **Services** panel beside attendance and fees. Each part comes from its own module's contract under the viewer's own permission. A part the viewer may not see is left out, never an error.

| Part      | From                      | Shows                                                              |
| --------- | ------------------------- | ------------------------------------------------------------------ |
| Transport | shared/transport          | Route, stop, direction, from date; "Not on transport" with Assign  |
| Hostel    | shared/hostel             | Hostel, room, bed, from date; outpass out now                      |
| Library   | shared/library            | Books on loan, overdue count                                       |
| Fees      | shared/finance (existing) | Due, overdue, link to the account                                  |
| Requests  | shared/helpdesk           | Open tickets raised about this student (by guardians), with a link |

The API composes these in one call (`GET /people/students/:id/services`), so the screen makes one request.

## 3. The staff record shows the whole person

The staff record gets the same treatment: **This month** (attendance days present, late, absent; leave taken and balance), **Salary** (current monthly gross and net, last payslip; payroll, below), **Appraisal** (latest score and state), **Assets issued** (from assets), **Requests** (helpdesk tickets they raised or are assigned), **Transport duty** (routes where they are the usual driver or attendant). Same rule: each part under the viewer's permission, missing parts left out.

## 4. Payroll

A separate spec: docs/specs/PAYROLL.md.

## Not in this step

Student life cycle events on one timeline (admission, promotion, transfer, certificate) beyond the existing History tab; route optimisation; vendor billing for contractor buses.
