# Transport: Milestone 18 spec

Status: **built** (all six steps, 8 November 2026). The owner asked for less back and forth, so the five decisions below were taken with the safest simple default; each can still be changed.

## Job

Every child who boards a school bus is accounted for until a guardian or the school has them, and every parent knows where their child's bus is without phoning the office. The worst failure in this domain is a child left on a parked bus, so the end-of-trip empty-bus check is not optional.

## Who and where

| Person              | Where                    | Does                                                                                                |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| Transport in-charge | Web                      | Routes, stops, vehicles, documents, assignments, today's trips, exceptions                          |
| Bus attendant       | Expo app, attendant mode | Marks boarding and drop at each stop, offline; runs the empty-bus check                             |
| Driver              | Expo app, driver mode    | Starts and ends the trip, shares location, SOS. **Never marks children** (spec: driver only drives) |
| Parent              | Expo app (existing)      | Bus status sentence, boarded and dropped alerts, live position during the trip, change requests     |
| Principal, office   | Web (Today, Day Line)    | Sees the Transport lane: trips running, late, not empty, documents expiring                         |

## Module

`modules/shared/transport` (shared, Build Guide). It never reads academic tables: labels such as "Class 5-A" come from `AcademicPlacementPort.getPlacements`, so one bus can carry school and college students (Build Guide: "Transport assigns person IDs to a trip"). Fees go through `shared/finance`; messages through `shared/communications`. Rules (attendant required, speed limit, document types) come from `packages/rules`, never `if (state === …)`.

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table                        | Holds                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport_vehicle`          | Registration number, kind (bus, van, auto), seats, owner (school or contractor), campus, active                                                     |
| `transport_vehicle_document` | Kind (registration, fitness, insurance, permit, pollution), number, valid until, file id (platform/documents)                                       |
| `transport_route`            | Name, campus, direction (`pickup` / `drop`), usual vehicle, driver and attendant, active dates                                                      |
| `transport_stop`             | Name, landmark, latitude/longitude (optional), fare zone                                                                                            |
| `transport_route_stop`       | Route, stop, sequence, planned time                                                                                                                 |
| `transport_assignment`       | Person, route, stop, direction, `valid_during` (dated: a change is a new row, like enrolment)                                                       |
| `transport_trip`             | Route, date, direction, actual vehicle, driver, attendant, state (`planned`, `running`, `ended`, `cancelled`), started/ended at                     |
| `transport_boarding_event`   | Append-only: trip, person, `boarded` / `dropped` / `not_boarded` / `handed_to_school`, stop, at, by, device event id (accepted once, decision 0009) |
| `transport_position`         | Trip, at, latitude, longitude, speed. Retention: _Default_ 30 days                                                                                  |
| `transport_trip_check`       | Empty-bus check: trip, by, at, outcome (`empty` / `child_found`), note                                                                              |

**Events:** `transport.trip.started.v1`, `transport.student.boarded.v1`, `transport.student.dropped.v1`, `transport.trip.ended.v1`, `transport.trip.not_cleared.v1` (critical), `transport.document.expiring.v1`, `transport.assignment.changed.v1`.

**Permissions** (add to `SCHOOL_ROLES`, a migration for existing schools, and the access catalogue, decision 0008): `transport.route.manage`, `transport.vehicle.manage`, `transport.assignment.manage`, `transport.trip.read` (also covers seeing vehicles, stops and routes), `transport.trip.attend` (attendant), `transport.trip.drive` (driver). Parents read their own child's trip through the guardian relation. New roles: `bus_attendant`, `driver`, `transport_incharge`.

## The day

1. **Trips are made the night before** from active routes (a worker task), skipping holidays and routes with no assigned riders. Holidays come through a `CalendarPort` the school module implements (school: `school_holiday`), because a shared module never imports a school one.
2. **Driver starts the trip** in the app. Location sharing starts with it and stops when the trip ends; there is no tracking outside a trip.
3. **Attendant marks at each stop.** The screen shows one stop at a time with photo tiles of the children expected there (Build Guide), large tap targets, sound on each mark. Everyone starts "expected"; a tap marks boarded; "Didn't come" marks not boarded. Works offline; marks sync once.
4. **Parents get one alert per change:** boarded, dropped, or "not on the bus today". Channel plan: push first, WhatsApp if push fails (the existing communications `PLANS`). A not-boarded alert waits _Default_ 5 minutes in case of a late tap correction.
5. **At school:** "handed to school" for everyone on board in one action; the school's own attendance stays separate (a child on the bus is not marked present in class by transport).
6. **Drop trips:** a child is dropped only to the listed guardian or authorised pickup. _Default:_ for children up to Class 5, if nobody is at the stop the child stays on the bus and returns to school; the attendant taps "nobody at stop", the office and guardians are alerted. Older children follow the school's setting.
7. **Ending the trip requires the empty-bus check:** the attendant walks the bus and confirms "Bus is empty", or records "child found" (which alerts the in-charge and principal at once). A trip can't end without it. If a trip is still running _Default_ 30 minutes after its last planned stop time, the in-charge and principal are alerted (`transport.trip.not_cleared.v1`).

## Setup screens (web)

| Screen      | Behaviour                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicles    | List with document status (valid, expires in 30 days, expired). Expired fitness, insurance or permit blocks assigning that vehicle to a trip; the in-charge can override once with a reason (audited) |
| Routes      | Route editor: stops in order with planned times, drag to reorder; the usual vehicle, driver and attendant. Shows seats used vs seats on the vehicle                                                   |
| Assignments | Per student: route, stop, direction, from date. Bulk import from Excel with **preview then commit**. Over-capacity and missing-attendant warnings appear in the preview                               |
| Today       | Every trip: state, last position time, riders boarded / expected, exceptions. Swap vehicle or driver for today only (breakdowns), with a reason                                                       |
| Reports     | Daily boarding log per trip, monthly ridership, document expiry list. All downloadable through `exportCsv` (logged)                                                                                   |

## Fees

Transport fees use the existing finance module. Each stop has a **fare zone**; transport offers its zones to finance as an `AudiencePort`, so a fee plan can apply to "Zone 2 riders" the way it applies to classes today. Issuing invoices, instalments, concessions, receipts and dues stay exactly as built.

- A student who starts transport mid-year is billed from the next instalment (finance already skips instalments already due for later joiners).
- _Default:_ stopping transport mid-year doesn't refund automatically. The office raises a concession or refund through the existing approval flow.
- One-way riders: _Default_ the school sets a one-way share per zone (for example 60%) in the plan.

## Parent app

- **Status sentence** first: "Asha's bus left school at 3:42 pm. About 12 minutes to your stop." / "Asha was dropped at Gandhi Nagar at 4:05 pm." / "Asha is not on the bus today."
- **Live map** of the child's bus only, only while that trip runs. Never other children, never the bus outside a trip.
- ETA is a simple estimate from planned stop times and the last position. _Default:_ no paid maps routing API in this milestone.
- **Change requests:** "Not taking the bus today" and "Different pickup today" (to another listed guardian or stop on the same route). The attendant sees the change on that stop's list. Permanent changes go to the office.

## Edge cases

| Case                                    | Behaviour                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bus breaks down                         | In-charge swaps the vehicle for today; riders and marks move with the trip; parents get one notice                                                                                             |
| Substitute driver or attendant          | Assigned for one trip with a reason; they see only that trip                                                                                                                                   |
| No attendant available                  | The trip shows a warning. _Verify:_ whether the state or board requires an attendant (and a woman attendant when girls ride); if the rule pack says required, the trip can't start without one |
| Child boards the wrong bus              | The attendant can add an unexpected rider by search; the in-charge is alerted                                                                                                                  |
| Sibling on another route                | Each child has their own assignment; the parent app shows both                                                                                                                                 |
| School and college students share a bus | Assignment is by person; labels come from each institution's placement port                                                                                                                    |
| Phone offline for the whole trip        | Marks queue on the device; parents get alerts when it syncs. The Today screen shows "last seen" time                                                                                           |
| Two attendants mark the same child      | First mark wins; a different later mark is kept as a conflict for the in-charge (as attendance does)                                                                                           |
| Guardian restricted by court order      | Never listed as an authorised pickup; the restriction rule from people/records applies                                                                                                         |
| Holiday declared late                   | Planned trips for that date are cancelled; parents get the holiday notice that already goes out                                                                                                |

## Rules to verify (rule pack `transport`, all `verified: false` until checked)

- CBSE and state school-bus safety guidelines: speed governor limit, GPS, CCTV, first-aid box, fire extinguisher, emergency exit, attendant and woman attendant requirements, driver experience and licence badge, police verification. _Verify_ each against the official circular or state order for AP, TS, KA and TN, with source and date (as H2 in RISKS.md does for academics).
- Vehicle document kinds and renewal periods per state (fitness, permit, pollution).

## Privacy and safety

- Bus position is operational data while a trip runs; it becomes personal once tied to a child, so parents see only their own child's bus. Positions are deleted after the retention period.
- Driver and attendant phone numbers are never shown to parents. Calls go through the school office. _Default:_ no in-app calling in this milestone.
- Boarding events are append-only; corrections are new events with a reason (as attendance).
- Children's photos on the attendant screen come from `person.photo_file_id` (cleaned bytes only) and are cached on the device only for that day's trip.

## Build order

1. Vehicles, documents, stops, routes (web), with tests for document expiry blocking.
2. Assignments with bulk import (preview, commit, undo) and the fare-zone audience for finance.
3. Trip generation and the attendant app (offline marks, empty-bus check), with the `not_cleared` alert.
4. Driver app: start and end, location sharing, SOS to the in-charge and principal.
5. Parent app: status sentence, alerts, live map during a trip, change requests.
6. Reports, Day Line Transport lane, Verse AI tool (`transport.trips_today`, operational data only).

## Acceptance tests

- A trip can't end without an empty-bus check; a trip running 30 minutes past its last stop raises `transport.trip.not_cleared.v1` once.
- A parent sees only their own child's bus, only while the trip runs; another school's parent gets 403 (RLS suite covers every new table in both directions).
- An attendant marks a stop offline; the sync accepts each event once; the parent gets exactly one boarded alert.
- A driver can't mark a child (403).
- A vehicle with expired fitness can't be assigned to a trip without an audited override.
- A mid-year rider is billed from the next instalment only; one fee plan per zone issues invoices to that zone's riders and nobody else.
- A child up to Class 5 with nobody at the stop is not dropped; the office and guardians are alerted.
- Allowed and denied cases for every permission; loading, empty, error, offline and denied states on every screen; axe clean at desktop and 360 px.

## Decisions (taken 8 November 2026, owner may change)

1. **Attendant:** every trip is run by a person with `transport.trip.attend` (the new Bus attendant role, or office, principal, school admin, owner). Nobody else can start, mark or end a trip, so no trip runs unattended in the system. The state rule pack check (woman attendant, etc.) stays open in RISKS.md.
2. **Drop rule:** for **every** child, any class: nobody at the stop means the child stays on the bus and comes back to school; guardians (urgent) and the in-charge are told. No class threshold to configure, no "may go alone" consent yet.
3. **Location retention:** 30 days (applies when step 4 records positions).
4. **ETA:** planned stop times only; no paid maps routing.
5. **Contractor buses:** the school's own people run every trip. A contractor's attendant can be added as staff and given the Bus attendant role; no separate contractor sign-in.

### How step 3 was built (simple on purpose)

- A trip is made when the attendant presses **Start trip** (one per route per day), not by a night-before job. A route with no riders today doesn't show.
- The attendant's sheet is a web page that works on a phone (`/transport/trip/<route>`). Taps go through the existing offline sync queue (`transport.mark` events, accepted once by event id). The Expo attendant mode can reuse the same endpoint later.
- The empty-bus check is part of ending: "Bus is empty" is refused while any child is still marked on board; "Child found" needs a note and alerts everyone who manages routes on the campus at once.
- A trip still open 30 minutes after its last planned stop (or its length plus 30 minutes after a late start) alerts the in-charge once.
- "Not on the bus today" waits 5 minutes, so a corrected tap sends nothing.
- Expired fitness, insurance or permit: the trip starts only with a reason, kept with the trip and in the audit.

### How step 4 was built

- The driver's screen is `/transport/drive`, a phone web page: choose the bus (remembered on the phone), **Start trip**, and the browser's location is shared every 15 seconds, sent in batches every 30 seconds, kept through dead zones (up to 30 minutes), only while the trip runs. The screen is kept awake (Wake Lock); a browser can't share in the background, so the Expo app's driver mode remains for later.
- Drivers (new **Driver** role, `transport.trip.drive`) see today's buses without children's names, can start a trip and raise an SOS, and can never open the attendant's sheet or mark a child. Only the attendant ends the trip.
- SOS (driver or attendant): an urgent message to everyone who manages routes on the campus, with the bus's last position as an OpenStreetMap link (no maps account).
- The Today tab shows when each running bus was last seen, with a map link, and any SOS.
- Positions older than 30 days are deleted with each new batch.

### How step 5 was built

- The parent app's home card shows a **Bus** part for each child who rides: one sentence per direction ("Asha's bus comes to Gandhi Nagar at about 7:25 am", "Asha's bus left at 7:05 am. About 12 minutes to your stop.", boarded, dropped, at school, not on the bus, coming back to school). Words in all six app languages (non-English drafts need native review, as the rest of the app).
- The ETA is the planned time at the child's stop, shifted by how late the trip started (decision 4); shown only while the bus is on its way to the child's stop.
- **Open map** (OpenStreetMap, no maps account) appears only while that child's trip runs, with when the bus was last seen. Parents never see other children or the bus outside a trip. The home screen refreshes every 30 seconds while a bus runs.
- **Not taking the bus today** (and Undo, until the trip starts): the attendant's tile says "Parent says: not taking the bus today", and no "not on the bus" alert goes out. The API takes any day up to 30 days ahead; the app offers today.
- Parents read through `transport.trip.read` with the guardian relation, so a parent's grant never opens staff screens.
- Not in this step: "different pickup today" (another guardian or stop); the in-app live map (the map link opens the phone's browser).

### How step 6 was built

- **Reports** tab on Transport: the day's boarding log (every trip with its check, SOS and paper override; every tap with class, admission number, stop and who marked), monthly riders per route (riders, days run, boardings, no-shows, children found), and papers due (expired, expiring in 30 days, or fitness, insurance or permit never recorded). Each downloads as CSV, logged in the school's activity.
- **Paper reminders**: checked whenever a trip starts on the campus. Everyone who manages routes hears once at 30 days or less, once at 7 days, and once when expired (urgent). No nightly job: a campus that runs no buses doesn't need them.
- **Today**: a Transport lane on the Day Line (each bus planned, running or done; red for SOS, child found or not cleared), and attention items for SOS, child found, a bus open 30 minutes past its last stop, and papers due.
- **Verse AI**: `transport.trips_today` answers "which buses are running late?" with counts only (state, on board, didn't come, late, SOS, papers missing, last seen); no children's names.

- Not built yet: adding an unexpected rider by search, swapping a vehicle for the day, the conflict view for two attendants (the latest tap wins), undo for an import batch.

## Later

GPS hardware integration (instead of the driver's phone), RFID or QR boarding cards, route optimisation, fuel and maintenance logs, contractor billing.
