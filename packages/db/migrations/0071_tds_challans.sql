-- Payroll › Statutory, TDS (rule book §13.7 "TDS (24Q), Form 16"; §15; P0 item 14). The legal
-- entity's TAN (it deducts the tax) and the TDS challans deposited for each month's salaries,
-- which the quarterly 24Q statement links each employee's deduction to. Owned by people/payroll
-- (the challans) and platform/organisation (the TAN).

ALTER TABLE legal_entity ADD COLUMN tan text CHECK (tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$');

CREATE TABLE payroll_tds_challan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  -- The salary month the tax was deducted in (the 1st).
  month date NOT NULL CHECK (extract(day from month) = 1),
  bsr_code text NOT NULL CHECK (bsr_code ~ '^[0-9]{7}$'),
  challan_serial text NOT NULL CHECK (challan_serial ~ '^[0-9]{5}$'),
  deposited_on date NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  recorded_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, bsr_code, deposited_on, challan_serial),
  CHECK (deposited_on >= month)
);
CREATE INDEX payroll_tds_challan_month_idx ON payroll_tds_challan (org_id, institution_id, month);

ALTER TABLE payroll_tds_challan ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_tds_challan FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_tds_challan
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
-- A challan is a fact at the bank: recorded once, never edited (a wrong one is deleted and re-entered).
GRANT SELECT, INSERT, DELETE ON payroll_tds_challan TO cv_app;
