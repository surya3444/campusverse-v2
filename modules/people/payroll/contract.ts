// Public API of payroll (docs/specs/PAYROLL.md): salaries, monthly runs approved by a second
// person, payslips. Money is integer paise; loss of pay comes from staff attendance.
export {
  PAYROLL_RUN_APPROVED,
  PAYROLL_RUN_PAID,
  PayrollError,
  approveRun,
  markRunPaid,
  myPayslips,
  payrollStatus,
  prepareRun,
  previewRun,
  runDetail,
  runs,
  salaries,
  salaryCard,
  salaryHistory,
  setSalary,
  type PayrollDeps,
  type RunPreview,
  type RunSummary,
  type SalaryInput,
  type SalaryRow,
  type SlipRow,
  type StaffSalary,
  type StoredSlip,
} from './application/payroll.js';
export {
  EARNINGS,
  arrearsFor,
  computeSlip,
  monthBounds,
  monthlyGross,
  roundRupee,
  type ArrearsDelta,
  type Earning,
  type Salary,
  type Slip,
} from './domain/pay.js';
export { statutoryReturns, type StatutoryReturns } from './application/statutory.js';
export {
  ESI_HEADER,
  ecrMember,
  ecrName,
  esiMember,
  wageRuleShortfall,
  type EcrInput,
  type EcrMember,
} from './domain/statutory.js';
export {
  SETTLEMENT_PAID,
  decideSettlement,
  markSettlementPaid,
  prepareSettlement,
  settlements,
  type SettlementRow,
} from './application/settlement.js';
export { addWorkingDays, settlementFor, type SettlementFigures } from './domain/settlement.js';
export {
  COLUMNS_24Q,
  COLUMNS_FORM16,
  deleteTdsChallan,
  form16Figures,
  recordTdsChallan,
  tdsQuarter,
  type Form16Row,
  type TdsChallan,
  type TdsQuarter,
} from './application/tds.js';
export { quarterOf, type Quarter } from './domain/tds.js';
