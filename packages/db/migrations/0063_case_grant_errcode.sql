-- Case grants refuse changes with the same code as every append-only table (42501), not a check
-- violation: a change other than ending a grant is a privilege the app never has.
CREATE OR REPLACE FUNCTION access_case_grant_end_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.ended_at IS NOT NULL
     OR (NEW.org_id, NEW.grantee_person_id, NEW.permission, NEW.subject_person_id, NEW.reason,
         NEW.granted_by_person_id, NEW.granted_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.org_id, OLD.grantee_person_id, OLD.permission, OLD.subject_person_id, OLD.reason,
         OLD.granted_by_person_id, OLD.granted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a case grant can only be ended' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
