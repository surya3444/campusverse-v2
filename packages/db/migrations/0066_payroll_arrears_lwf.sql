-- Payroll (rule book §13.7 Assignments & Arrears, Statutory Payroll): arrears from back-dated
-- salary revisions paid in a later month, and the state labour welfare fund (LWF). Owned by
-- people/payroll.

ALTER TABLE payroll_slip
  ADD COLUMN arrears_paise bigint NOT NULL DEFAULT 0 CHECK (arrears_paise >= 0),
  ADD COLUMN lwf_paise bigint NOT NULL DEFAULT 0 CHECK (lwf_paise >= 0),
  ADD COLUMN employer_lwf_paise bigint NOT NULL DEFAULT 0 CHECK (employer_lwf_paise >= 0);

-- Gross now includes arrears; net also takes off LWF. Existing rows have zeros, so they still hold.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'payroll_slip'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%gross_paise = (%' OR pg_get_constraintdef(oid) LIKE '%net_paise = (%')
  LOOP
    EXECUTE format('ALTER TABLE payroll_slip DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE payroll_slip
  ADD CONSTRAINT payroll_slip_gross_check CHECK (gross_paise = basic_paise + da_paise + hra_paise
    + conveyance_paise + special_paise + other_paise + arrears_paise),
  ADD CONSTRAINT payroll_slip_net_check CHECK (net_paise = gross_paise - pf_paise - esi_paise - pt_paise
    - lwf_paise - tds_paise - other_deduction_paise);

-- What a later run paid for an earlier month after a back-dated revision, so it is paid once.
CREATE TABLE payroll_arrear (
  org_id uuid NOT NULL REFERENCES organisation (id),
  run_id uuid NOT NULL,
  person_id uuid NOT NULL,
  for_month date NOT NULL CHECK (extract(day from for_month) = 1),
  salary_id uuid NOT NULL,
  gross_paise bigint NOT NULL CHECK (gross_paise > 0),
  pf_paise bigint NOT NULL CHECK (pf_paise >= 0),
  employer_pf_paise bigint NOT NULL CHECK (employer_pf_paise >= 0),
  esi_paise bigint NOT NULL CHECK (esi_paise >= 0),
  employer_esi_paise bigint NOT NULL CHECK (employer_esi_paise >= 0),
  PRIMARY KEY (org_id, run_id, person_id, for_month),
  FOREIGN KEY (org_id, run_id, person_id) REFERENCES payroll_slip (org_id, run_id, person_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, salary_id) REFERENCES payroll_salary (org_id, id)
);
CREATE INDEX payroll_arrear_person_idx ON payroll_arrear (org_id, person_id, for_month);

ALTER TABLE payroll_arrear ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_arrear FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_arrear
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
-- Draft runs are recomputed: their slips (and these rows, by cascade) are replaced.
GRANT SELECT, INSERT, DELETE ON payroll_arrear TO cv_app;
