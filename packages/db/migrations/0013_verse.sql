-- Verse AI: one append-only row per question (what was asked, which tools ran with which data
-- classes, the answer, tokens and outcome), and a monthly token budget per plan.

CREATE TABLE verse_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  page text,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 1000),
  model text NOT NULL,
  -- [{tool, outcome, dataClasses}] in call order.
  tools jsonb NOT NULL DEFAULT '[]',
  data_classes text[] NOT NULL DEFAULT '{}',
  answer text,
  outcome text NOT NULL CHECK (outcome IN (
    'answered', 'refused', 'incomplete', 'switched_off', 'over_budget', 'error'
  )),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE INDEX verse_request_month_idx ON verse_request (org_id, created_at);
CREATE INDEX verse_request_person_idx ON verse_request (org_id, person_id, created_at);

ALTER TABLE verse_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE verse_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON verse_request
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON verse_request
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON verse_request
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
GRANT SELECT, INSERT ON verse_request TO cv_app;

ALTER TABLE control.plan ADD COLUMN ai_monthly_tokens integer NOT NULL DEFAULT 2000000
  CHECK (ai_monthly_tokens >= 0);
UPDATE control.plan SET ai_monthly_tokens = 10000000 WHERE code = 'standard';

-- Staff may ask Verse AI (parents later, in the app). Templates: SCHOOL_ROLES in school/setup.
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.verse.ask' FROM role r
WHERE r.key IN ('school_admin', 'principal', 'teacher', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
