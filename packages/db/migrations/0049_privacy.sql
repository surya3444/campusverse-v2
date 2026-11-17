-- Privacy & Consent, step 1 (rule book §13.12, §15): data-rights requests and the breach register,
-- beside the consent ledger. Owned by platform/consent.

-- A data principal's request (DPDP Act 2023): access, correction, erasure, grievance, nomination or
-- withdrawal of consent. Recorded by the Data Protection Officer's office; due by an internal target
-- that each organisation may tighten. Counsel confirms the statutory periods (rule book §15).
CREATE TABLE consent_rights_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  number integer NOT NULL CHECK (number > 0),
  kind text NOT NULL CHECK (kind IN ('access', 'correction', 'erasure', 'grievance', 'nomination', 'withdraw_consent')),
  requester_name text NOT NULL CHECK (length(btrim(requester_name)) BETWEEN 1 AND 120),
  requester_contact text CHECK (requester_contact IS NULL OR length(btrim(requester_contact)) BETWEEN 3 AND 160),
  requester_person_id uuid,
  subject_person_id uuid,
  details text NOT NULL CHECK (length(btrim(details)) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'done', 'rejected')),
  outcome text CHECK (outcome IS NULL OR length(btrim(outcome)) BETWEEN 1 AND 4000),
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  closed_at timestamptz,
  recorded_by_account_id uuid,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, number),
  FOREIGN KEY (org_id, requester_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, subject_person_id) REFERENCES person (org_id, id),
  CHECK (due_at > received_at),
  -- Closed means decided, with the outcome written down.
  CHECK ((state IN ('done', 'rejected')) = (closed_at IS NOT NULL)),
  CHECK (state NOT IN ('done', 'rejected') OR outcome IS NOT NULL)
);
CREATE INDEX consent_rights_request_queue_idx ON consent_rights_request (org_id, state, due_at);

-- The breach register. CERT-In wants incidents reported within 6 hours of noticing them; the
-- Data Protection Board and the people affected are told as the DPDP Rules require.
CREATE TABLE consent_breach (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  affected_count integer CHECK (affected_count IS NULL OR affected_count >= 0),
  discovered_at timestamptz NOT NULL,
  cert_in_reported_at timestamptz,
  board_reported_at timestamptz,
  people_informed_at timestamptz,
  closed_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_account_id uuid,
  PRIMARY KEY (org_id, id),
  CHECK (discovered_at <= recorded_at + interval '5 minutes'),
  CHECK (cert_in_reported_at IS NULL OR cert_in_reported_at >= discovered_at),
  CHECK (board_reported_at IS NULL OR board_reported_at >= discovered_at),
  CHECK (people_informed_at IS NULL OR people_informed_at >= discovered_at),
  CHECK (closed_at IS NULL OR closed_at >= discovered_at)
);
CREATE INDEX consent_breach_open_idx ON consent_breach (org_id, discovered_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consent_rights_request', 'consent_breach'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON consent_rights_request, consent_breach TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue, where it is sensitive)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.privacy.manage' FROM role r WHERE r.key IN ('owner', 'school_admin')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
