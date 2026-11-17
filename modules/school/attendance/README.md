# school/attendance

A class teacher marks attendance in under a minute, even offline, and the school can prove later what happened (Schools Release spec, "Attendance and leave").

| Area        | Functions                                                                                                        | Notes                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marking     | `submitAttendance`, `acceptSyncEvents`, `markingSheet`, `attendanceDay`                                          | Everyone starts present; approved leave shows; the teacher sends only the exceptions. Device events are accepted once by `event_id`                                                         |
| Corrections | `correctAttendance`                                                                                              | New event with reason and editor; the original stays. A wrong absence alert gets a correction message                                                                                       |
| Conflicts   | `openConflicts`, `resolveConflict`                                                                               | A later, different submission for a taken day is kept for review, never applied silently                                                                                                    |
| Sign-off    | `signOff`                                                                                                        | Competent authority after the teacher; `sign_off_required` in settings                                                                                                                      |
| Substitutes | `assignSubstitute`                                                                                               | Marks one section on one day                                                                                                                                                                |
| Leave       | `requestLeave`, `decideLeave`, `pendingLeave`                                                                    | Parents ask for their own child; the class teacher decides. Approval turns marked absences in the range into leave                                                                          |
| Calendar    | `previewHoliday`, `declareHoliday`, `attendanceSettings`, `updateAttendanceSettings`                             | Preview then commit. Taken marks become holiday, pending alerts don't fire, parents get a notice                                                                                            |
| Shortage    | `shortageReport`, `sendShortageNotice`, `noticeProof`, `openCondonation`, `decideCondonation`, `monthlyRegister` | Threshold from the board rule pack in force (`boardRulesAt` in platform/rulepacks). A notice keeps its message ids; their delivery status is the proof. Condonation needs a note either way |

**Student record:** `studentAttendance` gives one student's year-so-far percentage, working days and latest absences, under `school.attendance.read` (guardian relation included).

**Who may mark:** `school.attendance.mark` plus being the section's class teacher or that day's substitute, or holding `school.attendance.manage`.

**Percentage:** half-days attended over working days (days the section took attendance, holidays excluded), in integer basis points, rounded down.

**Alerts:** `school.attendance.confirmed.v1` → the worker schedules `school.attendance.absence-alert` after the school's delay (default 30 min). The task alerts each still-absent student once.

**Owned tables:** `school_attendance_event` (append-only), `school_attendance_session`, `school_attendance_day` (read model), `school_attendance_conflict`, `school_leave_request`, `school_holiday`, `school_attendance_substitute`, `school_attendance_settings`, `school_attendance_notice` (append-only), `school_condonation_case` (migration 0007).

**Events:** `school.attendance.submitted.v1`, `school.attendance.confirmed.v1`, `school.attendance.corrected.v1`, `school.attendance.shortage_reached.v1`, `school.attendance.holiday_declared.v1`.

**Not yet:** the Expo app (Milestone 10), period-wise attendance, RFID or biometric sources, holiday removal, condonation document upload screen, regional-language messages, and working days by class group.
