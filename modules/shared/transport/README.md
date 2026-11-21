# shared/transport

School transport for any institution type (docs/specs/TRANSPORT.md, Milestone 18). Everything belongs to a campus, so one bus can carry school and college students.

| Use case             | What                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transportSetup`     | The campus's vehicles (with each document's status and whether the vehicle can run), stops and routes, in one read (`transport.trip.read`)                                                   |
| `saveVehicle`        | Adds or changes a vehicle (`transport.vehicle.manage`). Registration numbers are stored without spaces and are unique in the organisation                                                    |
| `addVehicleDocument` | Records registration, fitness, insurance, permit or pollution papers. Append-only; the one valid longest counts. Missing or expired fitness, insurance or permit means the vehicle can't run |
| `saveStop`           | A stop with landmark, optional location and fare zone (`transport.route.manage`)                                                                                                             |
| `saveRoute`          | A route (pickup or drop) with its usual vehicle and stops in time order; the stops are replaced as a whole                                                                                   |

| `listRiders` | Everyone riding a route on the campus on a date, with class and admission number from the placement port |
| `assignRider`, `endRider` | Puts a student on a route from a stop from a date (`transport.assignment.manage`); with `also`, on the other trip of the day too (morning pickup and afternoon drop are two routes, usually with the same name), in one step and billed once (`same_direction` if both are the same way). Any earlier route that way ends the day before. Only students of a school on the campus |
| `previewRiderImport`, `commitRiderImport` | A sheet of admission no., route, direction, stop: row-by-row preview (problems, seats over capacity), then the clean rows as one batch |
| `transportAudience` | Fee zones and routes as audience groups. `combineAudiences` (communications) keeps them to the institution's own students, so fee plans and notices can target them. A student's fee zone is the zone of their morning pickup stop, else of their afternoon drop stop: one bus fee each, never two (owner's decision, 21 Nov 2026). `shares` tells finance that a student on one trip only pays half the zone fee (`ONE_WAY_SHARE_BP`); bills already made stay as they were |
| `todayTrips`, `tripSheet` | Every bus on the campus today (trip state, where its riders are, papers), and one route's sheet stop by stop (`transport.trip.read`) |
| `startTrip` | Today's trip for a route (`transport.trip.attend`); starting twice returns the same trip. A vehicle without fitness, insurance or permit runs only with a reason (audited) |
| `recordMark`, `acceptMarks` | One tap of the attendant (boarded, didn't come, dropped, nobody at stop, at school), accepted once by the device's event id; `acceptMarks` answers the offline sync batch (`transport.mark`) |
| `endTrip` | The empty-bus check: "empty" is refused while a child is marked on board; "child found" needs a note |
| `recordPositions` | The driver's batch of positions while the trip runs (`transport.trip.drive`); one point per moment, points before the start dropped, positions past 30 days deleted |
| `raiseSos` | Driver or attendant on a running trip: urgent message to the in-charge with the last position |
| `childBus` | A parent's view of their own child's bus today (guardian relation): sentence data, ETA from planned times, position only while the trip runs |
| `skipRide` | "Not taking the bus today" (or a day up to 30 ahead), and undo (`transport.ride.skip`, guardian relation); shown on the attendant's tile, stops the "not on the bus" alert |
| `boardingLog`, `ridership` | The day's trips and taps; a month per route (`transport.trip.read`). Papers due come from `transportSetup` |
| `transportTools` | Verse AI `transport.trips_today`: counts only |
| `transportJobs` | Guardian alerts (boarded, dropped, at school; "not on the bus" after 5 minutes; nobody at stop, urgent) and in-charge alerts (child found, nobody at stop, trip not cleared 30 minutes after its last stop) |

Rules that need no database live in `domain/vehicle.ts` (document status, readiness, stop order) and `domain/trip.ts` (where a child is from the marks, which marks fit a direction, the empty-bus rule).

**Owns:** `transport_vehicle`, `transport_vehicle_document` (append-only), `transport_stop`, `transport_route`, `transport_route_stop`, `transport_fare_zone`, `transport_assignment` (dated; one route per direction at a time), `transport_trip` (one per route per day, with the empty-bus check), `transport_boarding_event` (append-only; id = device event id), `transport_position` (30 days), `transport_skip` (parent's "not today"; undone rows stay). **Events:** `transport.vehicle.saved.v1`, `transport.route.saved.v1`, `transport.assignment.changed.v1`, `transport.trip.started.v1`, `transport.student.marked.v1`, `transport.trip.ended.v1`, `transport.trip.sos.v1`, `transport.ride.skipped.v1`.

A route's driver and attendant must have valid safety checks (people/records `checksFailing`): a driver their licence, police verification and medical fitness, an attendant police verification. Only a change of crew is checked (`crew_checks`, with the missing checks); the crew pickers show who isn't ready.

Two trips a day: a bus's morning pickup and afternoon drop are two routes with the same name. The routes screen makes the drop from the pickup (same stops reversed, same gaps between times, leaving school at a chosen time), and the students screen shows each student's two trips side by side.

A stop can't leave a route while children board there, and a route with riders can't change direction.

**Not yet (extras beyond the spec's six steps):** background location (Expo driver mode), an in-app map, "different pickup today", the in-charge role, adding an unexpected rider, swapping a vehicle for a day, undoing an import batch (rows carry `import_batch_id`), uploading document scans (the API takes `fileId`).
