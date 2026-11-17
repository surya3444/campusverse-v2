// Public API of the syllabus (docs/specs/SYLLABUS.md): units per class and subject, progress per
// section, coverage, lesson plans and copying last year's syllabus.
export {
  SyllabusError,
  UNIT_COMPLETED,
  classSubjects,
  commitCopy,
  deleteUnit,
  lessonPlans,
  moveUnit,
  previewCopy,
  saveLessonPlan,
  saveUnit,
  schoolCoverage,
  syllabusFigures,
  syllabusPlan,
  tickUnit,
  type ClassSubjects,
  type CoverageRow,
  type LessonPlan,
  type SectionCoverage,
  type SyllabusDeps,
  type UnitInput,
  type UnitRow,
} from './application/syllabus.js';
export { syllabusTools } from './application/verse.js';
export { coverage, monthOf, nextYearMonth, planEditable } from './domain/syllabus.js';
