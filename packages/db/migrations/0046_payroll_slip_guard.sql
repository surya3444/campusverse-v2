-- A slip whose run this tenant can't see is left to RLS and the foreign key to refuse; the guard
-- only stops changes to slips of approved or paid runs.
CREATE OR REPLACE FUNCTION payroll_slip_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM payroll_run
  WHERE org_id = COALESCE(OLD.org_id, NEW.org_id) AND id = COALESCE(OLD.run_id, NEW.run_id);
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'payroll_slip: run is %', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
