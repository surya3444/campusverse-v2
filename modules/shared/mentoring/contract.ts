// Public API of Students › Mentoring (rule book §13.5, §16.4; docs/specs/MENTORING.md).
export {
  ESCALATION_RAISED,
  MentoringError,
  allocation,
  assignMentor,
  closeEscalation,
  escalate,
  escalations,
  menteeLog,
  myMentees,
  recordCheckIn,
  scheduleCheckIn,
  type Allocation,
  type EscalationRow,
  type MeetingRow,
  type MenteeLog,
  type MenteeRow,
  type MentorLoad,
  type MentoringDeps,
  type StudentRow,
} from './application/mentoring.js';
export {
  CHECK_IN_DAYS,
  CONCERNS,
  ESCALATE_TO,
  type Concern,
  type EscalateTo,
  type MeetingState,
} from './domain/mentoring.js';
export { COPY as MENTORING_COPY, mentoringJobs } from './application/jobs.js';
