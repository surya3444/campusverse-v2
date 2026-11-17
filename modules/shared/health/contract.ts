// Public API of Health Connect (rule book §13.9): the health vault, sick-room visits, totals for
// management and break-glass for emergencies.
export {
  HEALTH_BREAK_GLASS_OPENED,
  HEALTH_RECORD_UPDATED,
  HEALTH_VISIT_RECORDED,
  HealthError,
  healthRecord,
  healthTotals,
  openBreakGlass,
  recordVisit,
  saveHealthRecord,
  visitsToday,
  type EmergencyView,
  type HealthDeps,
  type HealthRecordView,
  type HealthTotals,
  type HealthVisit,
  type VisitRow,
} from './application/health.js';
export {
  BLOOD_GROUPS,
  BREAK_GLASS_MINUTES,
  EMPTY_VAULT,
  VISIT_OUTCOMES,
  type BloodGroup,
  type Vault,
  type VisitNotes,
  type VisitOutcome,
} from './domain/health.js';
export { COPY as HEALTH_COPY, healthJobs } from './application/jobs.js';
