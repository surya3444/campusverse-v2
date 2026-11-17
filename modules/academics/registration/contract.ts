// Public API of Academics › Course Registration (rule book §13.2, §16.6 step 2).
export {
  REGISTRATION_APPROVED,
  REGISTRATION_SUBMITTED,
  RegistrationError,
  approvedCourses,
  decideRegistration,
  register,
  registrationBoard,
  saveWindow,
  type RegistrationBoard,
  type RegistrationDeps,
  type RegistrationErrorCode,
} from './application/registration.js';
export { CHOSEN_KINDS, type SelectionProblem } from './domain/registration.js';
