// Public API of school homework and the class diary (docs/specs/HOMEWORK.md).
export {
  DIARY_WRITTEN,
  HOMEWORK_DUE_CHANGED,
  HOMEWORK_SET,
  HomeworkError,
  childHomework,
  editDiary,
  editHomework,
  homeworkFile,
  homeworkUploadCheck,
  markDone,
  myClasses,
  sectionHomework,
  setHomework,
  withdrawHomework,
  writeDiary,
  type ChildHomework,
  type DiaryEntry,
  type DueWarning,
  type Homework,
  type HomeworkDeps,
  type HomeworkFile,
  type HomeworkInput,
  type MyClass,
} from './application/homework.js';
export { homeworkJobs } from './application/jobs.js';
export { homeworkSummary, homeworkTools } from './application/verse.js';
