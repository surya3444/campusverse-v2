// Public API of Academics › Assessments (rule book §13.2; docs/specs/ASSESSMENTS.md).
export {
  AssessmentError,
  archiveQuestion,
  createPaper,
  finalisePaper,
  paperDetail,
  papers,
  questions,
  saveQuestion,
  setPaperQuestions,
  subjects,
  type AssessmentDeps,
  type PaperDetail,
  type PaperItem,
  type PaperRow,
  type QuestionInput,
  type QuestionRow,
} from './application/assessments.js';
export {
  BLOOM,
  DIFFICULTIES,
  QUESTION_KINDS,
  blueprint,
  type Bloom,
  type Blueprint,
  type Difficulty,
  type QuestionKind,
} from './domain/assessments.js';
