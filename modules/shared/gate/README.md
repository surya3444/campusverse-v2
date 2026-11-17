# shared/gate

Visitors and the gate for any institution type (docs/specs/VISITORS_GATE.md). Staff, students and guardians come from people/records (`searchMembers`, `memberKind`, `pickupGuardians`); a student's class comes through `AcademicPlacementPort`; messages go through communications from the worker. Never reads academic tables.

| Use case                                                 | What                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `visitorByPhone`, `checkIn`, `checkOut`                  | Visitors known by mobile number across the organisation; a walk-in or an expected visit checked in (barred visitors refused, a host must be staff), then out |
| `expectVisitor`, `myExpected`, `cancelExpected`          | Any staff member expects a visitor on a day and is the host; they see theirs without phones; only they or the gate cancel                                    |
| `barVisitor`, `liftBar`, `barredVisitors`                | Bar a visitor on every campus, lift a bar, both with a reason (`gate.visitor.bar`)                                                                           |
| `pickupOptions`, `issuePass`, `passLeft`, `cancelPass`   | Early-leave passes for today: a guardian on record or a named person; a restricted guardian never, however typed, and checked again at the gate              |
| `gateToday`, `gateFigures`, `visitHistory`, `findPeople` | Inside now, expected today, today's passes and the figures; a day's visits searchable by name, phone or vehicle; staff or students to pick                   |
| `gateJobs`                                               | The host is told their visitor is here; every unrestricted guardian is told when the child leaves (a safety message: opt-outs don't apply). Kind `gate`      |
| `gateTools`                                              | Verse AI `gate.today`: counts only                                                                                                                           |

**Owns:** `gate_visitor` (one per phone in the organisation), `gate_visit`, `gate_pass`. **Events:** `gate.visit.checked_in.v1`, `gate.pass.left.v1`.

**Not yet:** visitor photo and ID type, printed badges with a QR code, parents pre-approving a pickup person in the app, a pass marking the child "left early" in attendance, clearing visit details after 12 months, deliveries and staff movement registers.
