-- Milestone 19, step 1 (docs/specs/TIMETABLE.md): timetable versions with their bell schedule,
-- and one slot per section, day and period. Clashes (a teacher or a room in two places at once)
-- are refused by unique indexes; clashes across institutions are checked when publishing.

CREATE TABLE school_timetable (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  -- Weekdays as ISO numbers, 1 = Monday.
  days smallint[] NOT NULL CHECK (days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND cardinality(days) > 0),
  effective_from date,
  copied_from_id uuid,
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by_person_id uuid,
  published_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, copied_from_id) REFERENCES school_timetable (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, published_by_person_id) REFERENCES person (org_id, id),
  -- Published means dated and signed.
  CHECK ((state = 'published') = (effective_from IS NOT NULL AND published_at IS NOT NULL
    AND published_by_person_id IS NOT NULL))
);
-- Two published versions never take effect the same day.
CREATE UNIQUE INDEX school_timetable_effective ON school_timetable (org_id, institution_id, effective_from)
  WHERE state = 'published';

CREATE TABLE school_timetable_period (
  org_id uuid NOT NULL REFERENCES organisation (id),
  timetable_id uuid NOT NULL,
  number smallint NOT NULL CHECK (number BETWEEN 1 AND 16),
  starts_at time NOT NULL,
  ends_at time NOT NULL CHECK (ends_at > starts_at),
  kind text NOT NULL DEFAULT 'class' CHECK (kind IN ('class', 'break')),
  label text CHECK (length(label) <= 40),
  PRIMARY KEY (org_id, timetable_id, number),
  FOREIGN KEY (org_id, timetable_id) REFERENCES school_timetable (org_id, id) ON DELETE CASCADE
);

CREATE TABLE school_timetable_slot (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  timetable_id uuid NOT NULL,
  section_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  period smallint NOT NULL,
  subject_id uuid NOT NULL,
  teacher_person_id uuid,
  room text CHECK (length(btrim(room)) BETWEEN 1 AND 40),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, timetable_id, period) REFERENCES school_timetable_period (org_id, timetable_id, number)
    ON DELETE CASCADE,
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  FOREIGN KEY (org_id, teacher_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, timetable_id, section_id, weekday, period)
);
CREATE UNIQUE INDEX school_timetable_slot_teacher ON school_timetable_slot
  (org_id, timetable_id, weekday, period, teacher_person_id) WHERE teacher_person_id IS NOT NULL;
CREATE UNIQUE INDEX school_timetable_slot_room ON school_timetable_slot
  (org_id, timetable_id, weekday, period, lower(room)) WHERE room IS NOT NULL;
CREATE INDEX school_timetable_slot_teacher_idx ON school_timetable_slot (org_id, teacher_person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_timetable', 'school_timetable_period', 'school_timetable_slot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON school_timetable TO cv_app;
-- Drafts only: a draft's bell schedule and slots are replaced while it's edited.
GRANT SELECT, INSERT, UPDATE, DELETE ON school_timetable_period, school_timetable_slot TO cv_app;
-- A published version is history: its periods and slots never change.
CREATE FUNCTION school_timetable_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM school_timetable
             WHERE org_id = COALESCE(NEW.org_id, OLD.org_id)
               AND id = COALESCE(NEW.timetable_id, OLD.timetable_id) AND state = 'published') THEN
    RAISE EXCEPTION 'timetable_published' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON school_timetable_period
  FOR EACH ROW EXECUTE FUNCTION school_timetable_frozen();
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON school_timetable_slot
  FOR EACH ROW EXECUTE FUNCTION school_timetable_frozen();

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.timetable.read' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'teacher', 'office')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.timetable.manage' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
