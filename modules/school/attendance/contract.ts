// Public API of school attendance: marking (online and synced from devices), corrections,
// conflicts, leave, holidays, shortage and condonation. Owns the school_attendance_* tables.
export {
  AttendanceError,
  CONFIRMED,
  CORRECTED,
  HOLIDAY_DECLARED,
  SHORTAGE_REACHED,
  SUBMITTED,
  type AttendanceDeps,
} from './application/common.js';
export {
  acceptSyncEvents,
  assignSubstitute,
  attendanceDay,
  attendanceTrend,
  type TrendDay,
  correctAttendance,
  markingSheet,
  attendanceTaken,
  monthlyRegister,
  openConflicts,
  holidayOn,
  holidaysBetween,
  resolveConflict,
  signOff,
  submitAttendance,
  type AttendanceDay,
  type MarkingSheet,
  type OpenConflict,
  type Register,
  type SectionDay,
  type SheetStudent,
  type Submission,
  type SyncEvent,
  type SyncResult,
} from './application/marking.js';
export { decideLeave, pendingLeave, requestLeave, type LeaveItem } from './application/leave.js';
export {
  anyAttendanceFrom,
  attendanceFigures,
  childDay,
  studentAttendance,
  type StudentAttendance,
  type ChildDay,
} from './application/parent.js';
export {
  decideCondonation,
  noticeProof,
  openCondonation,
  sendShortageNotice,
  shortageReport,
  type NoticeProof,
  type ShortageReport,
  type ShortageRow,
} from './application/shortage.js';
export {
  attendanceSettings,
  declareHoliday,
  previewHoliday,
  updateAttendanceSettings,
  type AttendanceSettings,
  type HolidayPreview,
} from './application/calendar.js';
export { ABSENCE_ALERT, attendanceJobs, sendAbsenceAlerts } from './jobs/alerts.js';
export {
  CORRECTABLE,
  DAY_STATUSES,
  MARKABLE,
  type DayStatus,
  type Markable,
} from './domain/attendance.js';
export { attendanceTools } from './application/verse.js';
