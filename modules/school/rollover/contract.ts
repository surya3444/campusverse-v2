// Public API of school rollover: the section planner and the year end (preview, commit, undo).
// Owns school_section_plan and school_rollover.
export {
  commitRollover,
  listRollovers,
  previewRollover,
  ROLLOVER_COMMITTED,
  ROLLOVER_UNDONE,
  RolloverError,
  saveSectionPlan,
  sectionPlan,
  undoRollover,
  type Outcome,
  type Override,
  type Preview,
  type Row,
  type RolloverDeps,
  type RolloverSummary,
  type SectionPlanView,
} from './application/rollover.js';
