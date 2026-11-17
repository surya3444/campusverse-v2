// Public API of the school timetable (docs/specs/TIMETABLE.md, Milestone 19). Owns the
// school_timetable* tables. Sections, subjects and teachers come from school-setup's contract.
export {
  TIMETABLE_PUBLISHED,
  TimetableError,
  copyTimetable,
  createTimetable,
  dayPlan,
  deleteGroup,
  listTimetables,
  publishTimetable,
  saveGroup,
  setGroupSlot,
  setSlot,
  timetableDetail,
  updateSchedule,
  type Clash,
  type DayExam,
  type DayLesson,
  type DayPlan,
  type Group,
  type GroupInput,
  type GroupSlotInput,
  type Period,
  type ScheduleInput,
  type Slot,
  type SlotInput,
  type TimetableDetail,
  type Version,
} from './application/timetable.js';
export {
  COVER_ASSIGNED,
  assignCover,
  cancelCover,
  coverDay,
  freeTeachers,
  type CoverDay,
  type CoverKind,
  type CoverLesson,
  type FreeTeachers,
} from './application/cover.js';
export {
  childWeek,
  type ChildExam,
  type ChildLesson,
  type ChildTimetableDay,
  type ChildWeek,
} from './application/child.js';
export { timetableTools } from './application/verse.js';
export {
  TIMETABLE_GENERATE,
  generation,
  generationJobs,
  placeGeneration,
  requestGeneration,
  rulesOf,
  saveRules,
  type Generation,
  type GenerationResult,
} from './application/generate.js';
export {
  DEFAULT_RULES,
  type Rules,
  type SubjectRule,
  type TeacherRule,
} from './domain/generate.js';
export { coverJobs } from './application/jobs.js';
export { rankCover, type Candidate } from './domain/cover.js';
export {
  checkPeriods,
  targets,
  versionStatus,
  weekday,
  type PeriodInput,
  type Target,
  type VersionStatus,
} from './domain/timetable.js';
