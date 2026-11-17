// Public API of transport (docs/specs/TRANSPORT.md, Milestone 18). Step 1: vehicles and their
// papers, stops, routes. Step 2: riders. Step 3: trips, marks, the empty-bus check, alerts.
export {
  TRANSPORT_ROUTE_SAVED,
  TRANSPORT_VEHICLE_SAVED,
  TransportError,
  addVehicleDocument,
  crewDuty,
  saveRoute,
  saveStop,
  saveVehicle,
  transportSetup,
  type Route,
  type RouteInput,
  type Stop,
  type StopInput,
  type TransportSetup,
  type CrewMember,
  type Vehicle,
  type VehicleInput,
} from './application/setup.js';
export {
  TRANSPORT_ASSIGNMENT_CHANGED,
  assignRider,
  commitRiderImport,
  endRider,
  listRiders,
  previewRiderImport,
  transportAudience,
  type BillRider,
  type ImportLine,
  type ImportPlan,
  type ImportProblem,
  type ImportRow,
  type Rider,
} from './application/riders.js';
export {
  BLOCKING_KINDS,
  DOCUMENT_KINDS,
  documentStatus,
  vehicleReadiness,
  type DocumentKind,
  type DocumentStatus,
} from './domain/vehicle.js';
export {
  NOT_CLEARED_AFTER_MIN,
  acceptMarks,
  TRANSPORT_STUDENT_MARKED,
  TRANSPORT_TRIP_ENDED,
  TRANSPORT_TRIP_STARTED,
  endTrip,
  recordMark,
  startTrip,
  todayTrips,
  tripSheet,
  type MarkInput,
  type MarkSync,
  type SheetRider,
  type TodayTrip,
  type TripInfo,
  type TripSheet,
} from './application/trips.js';
export {
  NOT_BOARDED_ALERT,
  TRIP_NOT_CLEARED,
  checkCleared,
  notBoarded,
  transportJobs,
} from './application/alerts.js';
export { MARKS, type MarkKind, type RiderState } from './domain/trip.js';
export { TRANSPORT_RIDE_SKIPPED, childBus, skipRide, type ChildBus } from './application/parent.js';
export {
  POSITION_RETENTION_DAYS,
  TRANSPORT_SOS,
  raiseSos,
  recordPositions,
  type Point,
} from './application/drive.js';
export {
  boardingLog,
  ridership,
  type BoardingLog,
  type BoardingRow,
  type RidershipRow,
} from './application/reports.js';
export { transportTools } from './application/verse.js';
