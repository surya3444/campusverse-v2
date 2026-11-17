// Public API of school exams: papers, marks with codes, locks, post-lock changes, frozen results
// and report cards. Owns school_exam* tables.
export {
  createExam,
  decideMarkChange,
  EXAM_PUBLISHED,
  ExamError,
  examDetail,
  latestResult,
  listExams,
  lockExam,
  marksSheet,
  publishExam,
  requestMarkChange,
  saveMarks,
  setRemark,
  studentResults,
  submitPaper,
  type ExamDeps,
  type ExamDetail,
  type ExamSummary,
  type MarksSheet,
  type StudentResult,
} from './application/exams.js';
export { CODES, type Code } from './domain/results.js';
export { examTools } from './application/verse.js';
export {
  dateSheet,
  examAnalysis,
  papersOn,
  schedulePaper,
  type DateSheet,
  type ExamAnalysis,
  type PaperOn,
  type PaperSchedule,
} from './application/exams.js';
export type { PaperStats } from './domain/analysis.js';
