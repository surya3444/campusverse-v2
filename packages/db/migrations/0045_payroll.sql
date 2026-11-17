-- Payroll, step 1 (docs/specs/PAYROLL.md): dated salaries, monthly runs approved by a second person,
-- and payslips frozen at approval. Money is bigint paise; loss of pay is in half days.

CREATE TABLE payroll_salary (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  person_id uuid NOT NULL,
  effective_from date NOT NULL,
  basic_paise bigint NOT NULL CHECK (basic_paise >= 0),
  da_paise bigint NOT NULL DEFAULT 0 CHECK (da_paise >= 0),
  hra_paise bigint NOT NULL DEFAULT 0 CHECK (hra_paise >= 0),
  conveyance_paise bigint NOT NULL DEFAULT 0 CHECK (conveyance_paise >= 0),
  special_paise bigint NOT NULL DEFAULT 0 CHECK (special_paise >= 0),
  other_paise bigint NOT NULL DEFAULT 0 CHECK (other_paise >= 0),
  pf boolean NOT NULL DEFAULT true,
  esi boolean NOT NULL DEFAULT true,
  pt boolean NOT NULL DEFAULT true,
  tds_paise bigint NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  other_deduction_paise bigint NOT NULL DEFAULT 0 CHECK (other_deduction_paise >= 0),
  set_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, set_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, institution_id, person_id, effective_from),
  CHECK (basic_paise + da_paise + hra_paise + conveyance_paise + special_paise + other_paise > 0)
);

CREATE TABLE payroll_run (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  month date NOT NULL CHECK (extract(day from month) = 1),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved', 'paid')),
  attendance_through date NOT NULL,
  prepared_by_person_id uuid NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  approved_by_person_id uuid,
  approved_at timestamptz,
  paid_on date,
  payment_mode text CHECK (payment_mode IN ('bank', 'cash', 'cheque')),
  payment_ref text CHECK (length(payment_ref) <= 80),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, prepared_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, approved_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, institution_id, month),
  -- Maker and checker are different people.
  CHECK (approved_by_person_id IS DISTINCT FROM prepared_by_person_id),
  CHECK ((state = 'draft') = (approved_at IS NULL)),
  CHECK ((state = 'paid') = (paid_on IS NOT NULL AND payment_mode IS NOT NULL))
);

CREATE TABLE payroll_slip (
  org_id uuid NOT NULL REFERENCES organisation (id),
  run_id uuid NOT NULL,
  person_id uuid NOT NULL,
  salary_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  calendar_days smallint NOT NULL CHECK (calendar_days BETWEEN 28 AND 31),
  lop_halves smallint NOT NULL CHECK (lop_halves BETWEEN 0 AND 62),
  basic_paise bigint NOT NULL CHECK (basic_paise >= 0),
  da_paise bigint NOT NULL CHECK (da_paise >= 0),
  hra_paise bigint NOT NULL CHECK (hra_paise >= 0),
  conveyance_paise bigint NOT NULL CHECK (conveyance_paise >= 0),
  special_paise bigint NOT NULL CHECK (special_paise >= 0),
  other_paise bigint NOT NULL CHECK (other_paise >= 0),
  gross_paise bigint NOT NULL CHECK (gross_paise >= 0),
  pf_paise bigint NOT NULL CHECK (pf_paise >= 0),
  esi_paise bigint NOT NULL CHECK (esi_paise >= 0),
  pt_paise bigint NOT NULL CHECK (pt_paise >= 0),
  tds_paise bigint NOT NULL CHECK (tds_paise >= 0),
  other_deduction_paise bigint NOT NULL CHECK (other_deduction_paise >= 0),
  net_paise bigint NOT NULL CHECK (net_paise >= 0),
  employer_pf_paise bigint NOT NULL CHECK (employer_pf_paise >= 0),
  employer_esi_paise bigint NOT NULL CHECK (employer_esi_paise >= 0),
  PRIMARY KEY (org_id, run_id, person_id),
  FOREIGN KEY (org_id, run_id) REFERENCES payroll_run (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, salary_id) REFERENCES payroll_salary (org_id, id),
  CHECK (gross_paise = basic_paise + da_paise + hra_paise + conveyance_paise + special_paise + other_paise),
  CHECK (net_paise = gross_paise - pf_paise - esi_paise - pt_paise - tds_paise - other_deduction_paise)
);
CREATE INDEX payroll_slip_person_idx ON payroll_slip (org_id, person_id);

-- A slip changes only while its run is a draft (recompute replaces them); then it's frozen.
CREATE FUNCTION payroll_slip_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM payroll_run
  WHERE org_id = COALESCE(OLD.org_id, NEW.org_id) AND id = COALESCE(OLD.run_id, NEW.run_id);
  IF s IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'payroll_slip: run is %', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER payroll_slip_frozen BEFORE INSERT OR UPDATE OR DELETE ON payroll_slip
  FOR EACH ROW EXECUTE FUNCTION payroll_slip_frozen();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_salary', 'payroll_run', 'payroll_slip'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON payroll_salary TO cv_app;
GRANT SELECT, INSERT, UPDATE ON payroll_run TO cv_app;
GRANT SELECT, INSERT, DELETE ON payroll_slip TO cv_app;

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p FROM role r
CROSS JOIN unnest(ARRAY['payroll.salary.manage', 'payroll.run.prepare', 'payroll.run.approve']) p
WHERE r.key IN ('owner', 'school_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'payroll.run.prepare' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'payroll.run.approve' FROM role r WHERE r.key = 'principal'
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'payroll.slip.self', 'self' FROM role r WHERE r.key <> 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
