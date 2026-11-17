-- Identity & Access (rule book §10.3, P0 item 6): "Sensitive data is opt-in per role. Group owners
-- and principals see health totals, never names, unless granted for a case. Every such grant is
-- logged." A case grant lets one person use one sensitive permission about one person, for a
-- reason, until it expires or is ended. Owned by platform/permissions (read by the snapshot);
-- granted through platform/access.

CREATE TABLE access_case_grant (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  grantee_person_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  subject_person_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  granted_by_person_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by_person_id uuid,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, grantee_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, subject_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, granted_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, ended_by_person_id) REFERENCES person (org_id, id),
  CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '7 days'),
  CHECK (grantee_person_id <> granted_by_person_id),
  CHECK ((ended_at IS NULL) = (ended_by_person_id IS NULL))
);
CREATE INDEX access_case_grant_grantee_idx ON access_case_grant (org_id, grantee_person_id, expires_at);

-- Only ending a grant is an update; everything else stays as granted.
CREATE FUNCTION access_case_grant_end_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.ended_at IS NOT NULL
     OR (NEW.grantee_person_id, NEW.permission, NEW.subject_person_id, NEW.reason, NEW.granted_by_person_id,
         NEW.granted_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.grantee_person_id, OLD.permission, OLD.subject_person_id, OLD.reason, OLD.granted_by_person_id,
         OLD.granted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a case grant can only be ended' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER end_only BEFORE UPDATE OR DELETE ON access_case_grant
  FOR EACH ROW EXECUTE FUNCTION access_case_grant_end_only();

ALTER TABLE access_case_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_case_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON access_case_grant
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON access_case_grant TO cv_app;
