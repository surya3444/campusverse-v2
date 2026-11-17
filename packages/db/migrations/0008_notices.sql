-- Notices (compose, approve, send with an undo window), per-language versions, each guardian's
-- language, and in-app read and acknowledgement on messages. Owned by shared/communications.

CREATE TABLE notice (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('notice', 'circular', 'urgent')),
  -- {"type": "school"} or {"type": "groups", "groupIds": [...]}; groups are resolved by the academic module.
  audience jsonb NOT NULL CHECK (audience ->> 'type' IN ('school', 'groups')),
  needs_ack boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'approved', 'scheduled', 'sending', 'sent', 'cancelled')),
  created_by_person_id uuid NOT NULL,
  approved_by_person_id uuid,
  approved_at timestamptz,
  send_at timestamptz,
  sent_at timestamptz,
  recipients integer CHECK (recipients >= 0),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, approved_by_person_id) REFERENCES person (org_id, id),
  CHECK (state NOT IN ('scheduled', 'sending', 'sent') OR send_at IS NOT NULL),
  CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX notice_institution_idx ON notice (org_id, institution_id, created_at);

CREATE TABLE notice_version (
  org_id uuid NOT NULL REFERENCES organisation (id),
  notice_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'kn', 'te', 'ta', 'hi', 'ur')),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 4000),
  PRIMARY KEY (org_id, notice_id, language),
  FOREIGN KEY (org_id, notice_id) REFERENCES notice (org_id, id)
);

CREATE TABLE communication_preference (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'kn', 'te', 'ta', 'hi', 'ur')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, person_id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id)
);

ALTER TABLE notification_message
  ADD COLUMN notice_id uuid,
  ADD COLUMN about_person_id uuid,
  ADD COLUMN needs_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN read_at timestamptz,
  ADD COLUMN acknowledged_at timestamptz,
  ADD CONSTRAINT notification_message_notice_fk FOREIGN KEY (org_id, notice_id) REFERENCES notice (org_id, id),
  ADD CONSTRAINT notification_message_about_fk FOREIGN KEY (org_id, about_person_id) REFERENCES person (org_id, id),
  ADD CONSTRAINT notification_message_ack_check CHECK (acknowledged_at IS NULL OR needs_ack);
CREATE INDEX notification_message_notice_idx ON notification_message (org_id, notice_id) WHERE notice_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notice', 'notice_version', 'communication_preference'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON notice, communication_preference TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notice_version TO cv_app;
-- Only drafts' versions may be replaced; once approved, the text is what was approved.
CREATE POLICY edit_drafts_only ON notice_version AS RESTRICTIVE FOR DELETE
  USING (EXISTS (SELECT 1 FROM notice n WHERE n.org_id = notice_version.org_id
    AND n.id = notice_version.notice_id AND n.state = 'draft'));

-- New permissions for each school's copy of the role templates (also in SCHOOL_ROLES).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, g.permission
FROM role r JOIN (VALUES
  ('school_admin', 'communications.notice.compose'), ('school_admin', 'communications.notice.approve'),
  ('school_admin', 'communications.notice.send_urgent'), ('school_admin', 'communications.notice.track'),
  ('principal', 'communications.notice.compose'), ('principal', 'communications.notice.approve'),
  ('principal', 'communications.notice.send_urgent'), ('principal', 'communications.notice.track'),
  ('office', 'communications.notice.compose'), ('office', 'communications.notice.track')
) AS g (role_key, permission) ON g.role_key = r.key
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'communications.message.read_own', 'self' FROM role r WHERE r.key IN ('parent', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
