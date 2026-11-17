-- Verse AI first (decision 0021, docs/specs/VERSE_AI_FIRST.md): conversations, and actions Verse AI
-- prepares that only the person can confirm. Owned by platform/verse.

ALTER TABLE verse_request ADD COLUMN conversation_id uuid;
CREATE INDEX verse_request_conversation_idx ON verse_request (org_id, person_id, conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE verse_action (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  request_id uuid NOT NULL,
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  tool text NOT NULL CHECK (tool ~ '^[a-z_]+(\.[a-z_]+)+$'),
  input jsonb NOT NULL,
  preview jsonb NOT NULL,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'done', 'failed', 'dismissed')),
  outcome text CHECK (length(outcome) <= 500),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, request_id) REFERENCES verse_request (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  CHECK ((state = 'proposed') = (decided_at IS NULL))
);
CREATE INDEX verse_action_request_idx ON verse_action (org_id, request_id);

ALTER TABLE verse_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE verse_action FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON verse_action
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON verse_action TO cv_app;

-- Wardens and security guards may ask Verse AI too (also in SCHOOL_ROLES).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'platform.verse.ask' FROM role r WHERE r.key IN ('warden', 'security', 'owner')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
