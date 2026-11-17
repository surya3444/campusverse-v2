// Public API of Academics › Attendance for colleges and universities (rule book §13.2).
// Schools keep school/attendance.
export {
  ATTENDANCE_TAKEN,
  AttendanceError,
  CONDONE as ATTENDANCE_CONDONE,
  MARK as ATTENDANCE_MARK,
  READ as ATTENDANCE_READ,
  SHORTAGE_CONDONED,
  attendanceBoard,
  attendanceSheet,
  courseStandings,
  decideCondonation,
  requestCondonation,
  takeAttendance,
  type AttendanceBoard,
  type AttendanceDeps,
  type AttendanceErrorCode,
  type AttendanceSheet,
  type CourseStanding,
  type StandingRow,
} from './application/attendance.js';
export {
  MAY_SIT,
  attendedBasisPoints,
  standing,
  type MarkStatus,
  type Standing,
} from './domain/attendance.js';
