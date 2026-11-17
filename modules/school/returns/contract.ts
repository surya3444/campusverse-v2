// Public API of school returns (rule book §13.11 Government Reports, school sub-modules): UDISE+
// readiness now; board registration (LOC) and state returns to follow.
export {
  ReturnsError,
  udiseReadiness,
  type ReturnsDeps,
  type UdiseReadiness,
  type UdiseRow,
} from './application/udise.js';
export { missingForUdise, type Missing } from './domain/udise.js';
export {
  reconcileApaar,
  type ApaarOutcome,
  type ApaarReconciliation,
} from './application/apaar.js';
export { namesAgree, parseApaarCsv } from './domain/apaar.js';
