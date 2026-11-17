-- Privacy & Consent › guardian verification (rule book §13.4 Consent at Entry, §15 DPDP s.9 and
-- Rule 10, §17.5 gate: "consent and guardian verification live before 13 May 2027"). Before a
-- guardian's consent for a child counts, the institution checks that they are an identifiable
-- adult. Only the kind of document seen is kept, never its number. Append-only: a later row
-- (verified again, or revoked) replaces the earlier one. Owned by platform/consent.

CREATE TABLE consent_guardian_check (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  guardian_person_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('verified', 'revoked')),
  -- Rule 10: identity and age details already held, an identity document shown, or a virtual token.
  method text CHECK (method IN ('known_record', 'document_seen', 'digilocker_token')),
  document text CHECK (document IN ('aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id', 'other')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 300),
  checked_by_person_id uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, guardian_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, checked_by_person_id) REFERENCES person (org_id, id),
  CHECK ((outcome = 'verified') = (method IS NOT NULL)),
  CHECK (method = 'document_seen' OR document IS NULL),
  CHECK (method <> 'document_seen' OR document IS NOT NULL),
  CHECK (outcome = 'verified' OR note IS NOT NULL)
);
CREATE INDEX consent_guardian_check_latest_idx
  ON consent_guardian_check (org_id, guardian_person_id, id DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON consent_guardian_check
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE consent_guardian_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_guardian_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_guardian_check
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT ON consent_guardian_check TO cv_app;

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.consent.verify_guardian' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
