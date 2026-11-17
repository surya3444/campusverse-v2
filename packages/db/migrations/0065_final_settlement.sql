-- Payroll › Gratuity & Final Settlement (rule book §13.7, §15 Labour Codes in force since
-- 21 Nov 2025): what a leaver is owed — salary to the last day and gratuity (fixed-term staff
-- after one year) — due within two working days of the last working day. Approved through the
-- workflow engine; paid with a reference. Owned by people/payroll.

CREATE TABLE payroll_settlement (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  person_id uuid NOT NULL,
  last_day date NOT NULL,
  due_on date NOT NULL,
  -- Salary for the final month's days not already in an approved pay run, after deductions.
  salary_days smallint NOT NULL CHECK (salary_days BETWEEN 0 AND 31),
  salary_net_paise bigint NOT NULL CHECK (salary_net_paise >= 0),
  -- Gratuity: wages are basic + DA plus any wage-rule shortfall (Labour Codes wage definition).
  gratuity_wages_paise bigint NOT NULL CHECK (gratuity_wages_paise >= 0),
  service_months integer NOT NULL CHECK (service_months >= 0),
  gratuity_years smallint NOT NULL CHECK (gratuity_years >= 0),
  gratuity_paise bigint NOT NULL CHECK (gratuity_paise >= 0),
  fixed_term boolean NOT NULL,
  total_paise bigint NOT NULL CHECK (total_paise = salary_net_paise + gratuity_paise),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'approved', 'rejected', 'paid')),
  prepared_by_person_id uuid NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_note text,
  paid_on date,
  payment_reference text CHECK (payment_reference IS NULL OR length(btrim(payment_reference)) BETWEEN 1 AND 80),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, prepared_by_person_id) REFERENCES person (org_id, id),
  CHECK (due_on > last_day),
  CHECK ((state = 'paid') = (paid_on IS NOT NULL)),
  CHECK (paid_on IS NULL OR paid_on >= last_day)
);
-- One live settlement per leaver and institution; a rejected one can be prepared again.
CREATE UNIQUE INDEX payroll_settlement_live_idx ON payroll_settlement (org_id, institution_id, person_id)
  WHERE state <> 'rejected';

ALTER TABLE payroll_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_settlement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payroll_settlement
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON payroll_settlement TO cv_app;
