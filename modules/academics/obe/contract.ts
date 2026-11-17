// Public API of Academics › OBE (rule book §13.2; P1 item 17).
export {
  OBE_MANAGE,
  OBE_READ,
  ObeError,
  attainment,
  courseOutcomes,
  draftOutcomeSet,
  outcomeSets,
  publishOutcomeSet,
  saveCourseOutcomes,
  saveOutcomeSet,
  type AttainmentView,
  type CourseOutcome,
  type CourseOutcomesView,
  type ObeDeps,
  type ObeErrorCode,
  type Outcome,
  type OutcomeSet,
} from './application/obe.js';
export {
  coAttainment,
  levelOf,
  outcomeAttainment,
  type CoResult,
  type Settings,
  type Side,
  type StudentMarks,
} from './domain/attainment.js';
