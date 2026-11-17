// Public API of Academics › Exams & Results for colleges and universities (rule book §13.2).
export {
  ABC_COLUMNS,
  ExamError,
  abcCreditFile,
  RESULTS_PUBLISHED,
  decideResults,
  examBoard,
  gradeCard,
  marksSheet,
  saveMarks,
  sendResults,
  setCourseLock,
  termMarks,
  type TermMarks,
  type AbcCreditFile,
  type ExamBoard,
  type ExamDeps,
  type ExamErrorCode,
  type GradeCard,
  type MarksSheet,
} from './application/exams.js';
export { termResults, type StudentResult } from './domain/results.js';
export {
  REEXAM_APPROVED,
  decideReexam,
  markReexam,
  reexamBoard,
  requestReexam,
  type ReexamBoard,
  type ReexamItem,
} from './application/reexams.js';
export { reexamGrade, withReexams, type ReexamKind } from './domain/reexam.js';
export {
  HALL_TICKET_ISSUED,
  eligibilityBoard,
  hallTicketUrl,
  issueHallTickets,
  noticeText,
  sendIneligibilityNotices,
  type EligibilityBoard,
  type EligibilityRow,
} from './application/hall-tickets.js';
export { eligibilityOf, type CourseEligibility, type Reason } from './domain/eligibility.js';
