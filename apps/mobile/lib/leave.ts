// A staff member's own leave, as the API sends it (docs/specs/STAFF_LEAVE.md).
export type LeaveType = {
  id: string;
  code: string;
  name: string;
  halfDay: boolean;
  active: boolean;
};
export type Balance = { typeId: string; left: number | null };
export type LeaveRequest = {
  id: string;
  typeCode: string;
  from: string;
  to: string;
  halfDay: boolean;
  days: number;
  state: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
};
export type MyLeave = { year: number; balances: Balance[]; requests: LeaveRequest[] };

/** Whole or half days: 2, 1.5. */
export const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
