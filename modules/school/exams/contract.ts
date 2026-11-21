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
  setSubjectParts,
  type PartInput,
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
export {
  AREA_GRADES,
  coScholasticAreas,
  DEFAULT_AREAS,
  reportCardSheet,
  saveArea,
  saveReportCard,
  type Area,
  type AreaGrade,
  type ReportCardSheet,
} from './application/report-card.js';
export {
  FINAL_PUBLISHED,
  publishResultPlan,
  resultPlanDetail,
  resultPlans,
  saveResultPlan,
  type ResultPlanDetail,
  type ResultPlanInput,
  type ResultPlanSummary,
} from './application/final.js';
export type { FinalSubject } from './domain/results.js';
