// Public API of Campus Core › Workflow & Approvals (rule book §12.4 decision 6).
export {
  ApprovalError,
  approvalDesign,
  approvalStates,
  decideApproval,
  myDecisions,
  myWork,
  saveApprovalSteps,
  startApproval,
  withdrawApproval,
  type ApprovalErrorCode,
  type ApprovalState,
  type ProcessPolicy,
  type MyDecision,
  type WorkItem,
  type WorkflowDeps,
} from './application/workflow.js';
export {
  PROCESSES,
  type PolicyStep,
  type ProcessKey,
  type RequestStep,
} from './domain/workflow.js';
