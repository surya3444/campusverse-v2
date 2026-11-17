# shared/hostel

Hostels for any institution type (docs/specs/HOSTEL.md). Students come from people/records (`searchMembers`, `memberKind`, `studentFacts` for gender, `pickupGuardians`); a student's class through `AcademicPlacementPort`; who may collect a child through shared/gate's `collectorCheck`. Never reads academic tables.

| Use case                                                                                                      | What                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostels`, `saveHostel`, `rooms`, `saveRoom`                                                                  | Hostels (boys, girls, mixed) and rooms with numbered beds; a room can't lose a bed in use (`hostel.room.manage`)                                  |
| `findStudents`, `allocate`, `moveStudent`, `vacate`                                                           | One bed per student and one student per bed (exclusion constraints); the right hostel for the student's gender; moves keep the old record's dates |
| `rollCallSheet`, `saveRollCall`                                                                               | Today's roll call (night or morning): every resident marked, those out on a pass start on leave; corrections the same day                         |
| `outpasses`, `issueOutpass`, `requestOutpass`, `decideOutpass`, `outpassLeft`, `outpassBack`, `cancelOutpass` | Parents ask in the app or the warden issues; never a restricted guardian, checked again when the child leaves; overdue when not back by the day   |
| `childHostel`                                                                                                 | A guardian's view: bed, the last roll calls, outpasses, who may collect                                                                           |
| `hostelFigures`, `hostelAudience`, `hostelJobs`, `hostelTools`                                                | Figures; residents as a fee and notice audience; absent, decided, left and back messages (kind `hostel`); Verse AI `hostel.today`                 |

**Owns:** `hostel`, `hostel_room`, `hostel_allocation`, `hostel_roll_call`, `hostel_roll_mark`, `hostel_outpass`. **Events:** `hostel.rollcall.submitted.v1`, `hostel.outpass.requested.v1`, `hostel.outpass.decided.v1`, `hostel.outpass.left.v1`, `hostel.outpass.returned.v1`.

**Not yet:** mess menu and attendance, hostels shared by a campus's schools, wardens limited to their own hostel, room inventory and damage charges, visitors to residents, sick bay, bulk allocation from a spreadsheet.
