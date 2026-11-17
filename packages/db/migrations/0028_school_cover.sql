-- Milestone 19, step 2 (docs/specs/TIMETABLE.md): cover for an absent teacher's lessons. One
-- live cover per lesson and day; a covering teacher covers one lesson per period. A change
-- cancels the old row and adds a new one, so who covered what stays on record.

CREATE TABLE school_cover (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  cover_date date NOT NULL,
  slot_id uuid NOT NULL,
  -- Copied from the slot, for the one-lesson-per-period rule.
  period smallint NOT NULL,
  absent_person_id uuid NOT NULL,
  -- 'teacher': covered by covering_person_id; 'combined': joined with another class;
  -- 'supervised': watched without a teacher of the subject (no covering teacher).
  kind text NOT NULL CHECK (kind IN ('teacher', 'combined', 'supervised')),
  covering_person_id uuid,
  note text CHECK (length(note) <= 300),
  assigned_by_person_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by_person_id uuid,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, slot_id) REFERENCES school_timetable_slot (org_id, id),
  FOREIGN KEY (org_id, absent_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, covering_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, assigned_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, cancelled_by_person_id) REFERENCES person (org_id, id),
  CHECK ((kind = 'teacher') = (covering_person_id IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by_person_id IS NULL))
);
CREATE UNIQUE INDEX school_cover_once ON school_cover (org_id, slot_id, cover_date)
  WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX school_cover_one_place ON school_cover (org_id, institution_id, cover_date, period, covering_person_id)
  WHERE cancelled_at IS NULL AND covering_person_id IS NOT NULL;
CREATE INDEX school_cover_day_idx ON school_cover (org_id, institution_id, cover_date);

ALTER TABLE school_cover ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_cover FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_cover USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
-- Cancelled, never deleted.
GRANT SELECT, INSERT, UPDATE ON school_cover TO cv_app;

-- Permission (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.cover.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
