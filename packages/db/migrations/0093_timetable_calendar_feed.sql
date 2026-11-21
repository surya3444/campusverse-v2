-- My Timetable's calendar link (rule book §13 Timetable › My Timetable: "Teacher's week; Google or
-- Outlook calendar sync"). Owned by school/timetable.
--
-- A teacher subscribes Google Calendar or Outlook to a private link. Only the SHA-256 of its
-- secret is kept; the link is shown once, and making a new one ends the old one. The feed is
-- built on each fetch and checks the person may still read the timetable, so a leaver's link
-- goes empty.

CREATE TABLE school_timetable_feed (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_fetched_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, token_hash)
);
-- One live link per person.
CREATE UNIQUE INDEX school_timetable_feed_live ON school_timetable_feed (org_id, person_id)
  WHERE revoked_at IS NULL;

ALTER TABLE school_timetable_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_timetable_feed FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_timetable_feed
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON school_timetable_feed TO cv_app;
