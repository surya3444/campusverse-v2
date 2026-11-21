-- Students › Mentoring (rule book §13.5, §16.4; P1 item 22; docs/specs/MENTORING.md). Owned by
-- shared/mentoring. One mentor per student at a time; check-ins with notes and a concern level;
-- escalations to the head of department, the counsellor or the parent.

CREATE TABLE mentor_assignment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  mentor_person_id uuid NOT NULL,
  valid_during daterange NOT NULL CHECK (NOT isempty(valid_during)),
  assigned_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, mentor_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, assigned_by_person_id) REFERENCES person (org_id, id),
  -- One mentor per student at a time, in each institution.
  EXCLUDE USING gist (org_id WITH =, institution_id WITH =, student_person_id WITH =, valid_during WITH &&)
);
CREATE INDEX mentor_assignment_mentor_idx ON mentor_assignment (org_id, mentor_person_id);

CREATE TABLE mentor_meeting (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  mentor_person_id uuid NOT NULL,
  scheduled_for date NOT NULL,
  state text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'held', 'missed', 'cancelled')),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  concern text CHECK (concern IN ('fine', 'watch', 'concern')),
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, mentor_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'held') = (concern IS NOT NULL)),
  CHECK ((state = 'scheduled') = (recorded_at IS NULL))
);
CREATE INDEX mentor_meeting_student_idx ON mentor_meeting (org_id, student_person_id, scheduled_for DESC);

CREATE TABLE mentor_escalation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  raised_by_person_id uuid NOT NULL,
  escalated_to text NOT NULL CHECK (escalated_to IN ('hod', 'counsellor', 'parent')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  closed_by_person_id uuid,
  closed_at timestamptz,
  closing_note text CHECK (closing_note IS NULL OR length(btrim(closing_note)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, raised_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, closed_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL) AND (closed_at IS NULL) = (closed_by_person_id IS NULL))
);
CREATE INDEX mentor_escalation_open_idx ON mentor_escalation (org_id, institution_id, state, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mentor_assignment', 'mentor_meeting', 'mentor_escalation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON mentor_assignment, mentor_meeting, mentor_escalation TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue).
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('mentoring.allocation.manage'), ('mentoring.mentee.mentor'), ('mentoring.escalation.counsel')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'mentoring.mentee.mentor' FROM role r WHERE r.key IN ('teacher')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
