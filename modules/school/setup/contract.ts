// Public API of school setup: signup, structure, Excel import, invites and readiness.
export { SetupError } from './application/common.js';
export {
  commitImport,
  getImport,
  IMPORT_COMMITTED,
  IMPORT_COMMIT_REQUESTED,
  IMPORT_UNDONE,
  importCommitConsumer,
  previewImport,
  readWorkbook,
  undoImport,
  type ImportKind,
  type ImportPreview,
} from './application/imports.js';
export {
  invitesConsumer,
  previewInvites,
  sendInvites,
  type InvitePreview,
} from './application/invites.js';
export { provisionSchool, type NewSchool } from './application/provision.js';
export {
  completeOnboarding,
  type Onboarded,
  type OnboardingInput,
} from './application/onboarding.js';
export { setupReadiness, type ReadinessCheck } from './application/readiness.js';
export { SCHOOL_ROLES } from './application/roles.js';
export {
  applyStructure,
  setUpNextYear,
  staffExitConsumer,
  STRUCTURE_APPLIED,
} from './application/structure.js';
export type { Problem } from './domain/rows.js';
export {
  planStructure,
  type StructureInput,
  type StructurePlan,
  type StructureProblem,
} from './domain/structure.js';
export { importTemplate } from './application/templates.js';
export {
  listInstitutions,
  setupOverview,
  supportSummary,
  type SetupOverview,
  type SupportSummary,
} from './application/overview.js';
export {
  assertYearOpen,
  classesOf,
  classesIn,
  sectionsOfYear,
  yearByLabel,
  classInfo,
  classTeacherSections,
  type ClassInfo,
  schoolAudience,
  sectionInfo,
  sectionsOn,
  subjectsOf,
  teaches,
  yearsOf,
  type YearInfo,
  type YearStatus,
  type SectionInfo,
} from './application/sections.js';
export {
  institutionImage,
  schoolProfile,
  setInstitutionImage,
  updateSchoolProfile,
  type ProfileChange,
  type SchoolProfile,
} from './application/profile.js';
export {
  addSubject,
  assignTeacher,
  classesOverview,
  setOffering,
  subjectsOverview,
  teachingPlan,
  updateSubject,
  type ClassesOverview,
  type SubjectKind,
  type SubjectsOverview,
  type TeachingPlan,
} from './application/subjects.js';
export { setupTools } from './application/verse.js';
export { closeYear, reopenYear, YEAR_CLOSED, YEAR_REOPENED } from './application/years.js';
export {
  addClassToYear,
  addSection,
  removeClassFromYear,
  removeSection,
  sectionInUse,
  setSectionClosed,
  updateSection,
  yearPlanProblems,
  type YearPlan,
} from './application/year-structure.js';
