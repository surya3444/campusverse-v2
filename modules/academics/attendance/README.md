# academics/attendance

Academics › Attendance for colleges and universities (rule book §13.2 Attendance: "period-wise (college)"; "Shortage & Condonation: threshold from rule pack (often 75%), alerts, condonation approval, feeds exam eligibility"). Schools keep school/attendance (day-wise).

- **Taking a period** (`attendanceSheet`, `takeAttendance`; `academics.attendance.mark`): a session is one period of a course for a section on a date, within the batch's current term and not in the future. Every student of the section who takes the course (approved registration, else the term's compulsory courses) is marked present, absent or on duty (counts as attended). One course per period; taking it again replaces the marks.
- **Standing** (`attendanceBoard`, `courseStandings`): per student per course for the current term, attended ÷ held, rounded down, against the credits pack's `attendance` (`courseAttendanceAt`; built in 75%, condonable from 65%, unverified): eligible, condonable, short, condoned, no classes yet. `courseStandings` is for exams (eligibility), called inside the tenant.
- **Condonation** (`requestCondonation`, `decideCondonation`): only within the condonable band, with a reason; decided through the workflow engine (`academics.condonation`; default `academics.attendance.condone`; never the person who asked). A refusal needs a note.

**Owns:** `course_attendance_session`, `course_attendance_mark`, `course_attendance_condonation` (migration 0074). **Events:** `academics.attendance.taken.v1`, `academics.attendance.condoned.v1`.

**Not yet:** QR-TOTP, biometric and RFID capture (P1 item 26), offline marking, student, parent and mentor views, alerts to students and parents on shortage, medical leave status from Health Connect, timetable-driven periods, exam eligibility and hall tickets (next, in academics/exams).
