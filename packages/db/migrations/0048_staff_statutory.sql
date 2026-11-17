-- Payroll (docs/specs/PAYROLL.md): the staff member's PF universal account number and ESI number,
-- needed on payslips and statutory returns. Identifiers, not secrets: kept in clear.
ALTER TABLE staff_profile
  ADD COLUMN pf_uan text CHECK (pf_uan ~ '^[0-9]{12}$'),
  ADD COLUMN esi_number text CHECK (esi_number ~ '^[0-9]{10,17}$');
