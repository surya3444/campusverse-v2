// Public API of school admissions: one pipeline from enquiry to enrolment. Owns school_application*,
// school_admission_seat and the admission number counter.
export {
  addEnquiry,
  AdmissionError,
  APPLICATION_CONFIRMED,
  applicationDetail,
  confirm,
  enrolApplicant,
  lapseOffers,
  moveApplication,
  offer,
  OFFER_DAYS,
  pipeline,
  setSeats,
  STUDENT_ENROLLED,
  updateApplication,
  type AdmissionsDeps,
  type ApplicationDetail,
  type Category,
  type Enrolled,
  type EnquiryInput,
  type Pipeline,
} from './application/admissions.js';
export { STATES, type AgeCheck, type State } from './domain/pipeline.js';
export {
  addApplicationDocument,
  applicationCheck,
  applicationDocuments,
  applicationPhoto,
  checkApplicationDocument,
  openApplicationDocument,
  setApplicationPhoto,
  type ApplicantDocument,
  type ApplicantFolder,
} from './application/documents.js';
export { admissionTools } from './application/verse.js';
export {
  APPLIED_ONLINE,
  MAX_PER_PHONE,
  admissionForms,
  applicationStatus,
  publicForm,
  requestApplicationCode,
  saveAdmissionForm,
  submitOnlineApplication,
  type AdmissionForm,
  type FamilyStatus,
  type FormInput,
  type OnlineApplication,
  type PublicForm,
} from './application/online.js';
export { admissionsJobs } from './application/jobs.js';
