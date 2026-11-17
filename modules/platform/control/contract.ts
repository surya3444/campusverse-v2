// Public API of the control module: the Campusverse super admin. Global tables in schema
// control; customers are reached only through withTenant, with audit rows on both sides.
export { ControlError, controlStep, type Staff } from './application/common.js';
export { staffCan, type StaffAction, type StaffRole } from './domain/roles.js';
export {
  authenticateStaff,
  completeRegistration,
  completeSignIn,
  createStaff,
  disableStaff,
  listStaff,
  registrationOptions,
  reissueEnrolment,
  signInOptions,
  signOutStaff,
  type RelyingParty,
  type StaffRow,
  type StaffSession,
} from './application/auth.js';
export {
  aiMonthlyTokens,
  createCustomer,
  customerAccess,
  customerDetail,
  listCustomers,
  registerCustomer,
  requestStatusChange,
  setPlan,
  type ControlPorts,
  type CustomerDetail,
  type CustomerStatus,
  type CustomerSummary,
  type NewCustomer,
} from './application/customers.js';
export { decideApproval, listApprovals, type ApprovalRow } from './application/approvals.js';
export {
  endGrant,
  listGrants,
  requestSupportAccess,
  supportView,
  type GrantRow,
} from './application/support.js';
export {
  deliveryHealth,
  flagOn,
  listFlags,
  listPlans,
  listSwitches,
  savePlan,
  searchAudit,
  setFlag,
  setFlagDefault,
  setSwitch,
  switchOn,
  type AuditRow,
  type DeliveryHealth,
  type FlagRow,
  type Plan,
  type SwitchKey,
  type SwitchRow,
} from './application/settings.js';
export {
  listIncidents,
  openIncident,
  recordIncidentStep,
  type IncidentRow,
  type IncidentStep,
} from './application/incidents.js';
export { incidentClocks, type Clock } from './domain/incident.js';
export {
  cancelInvite,
  completeInvite,
  inviteAdmin,
  SELF_SIGNUP_PLAN,
  selfSignup,
  type SelfSignupInput,
  listInvites,
  pendingInvite,
  saveInviteDraft,
  type InviteRow,
  type PendingInvite,
} from './application/invites.js';
