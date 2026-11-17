-- Milestone 19, step 4 (docs/specs/TIMETABLE.md): teaching groups. Sections that come together
-- in a period and split by subject (second language, electives): 6-A and 6-B → Hindi, Kannada,
-- Sanskrit, each with its teacher and room. A group lesson is a slot with the group instead of a
-- section, so the teacher and room unique indexes keep refusing clashes across both kinds.

CREATE TABLE school_timetable_group (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  timetable_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, timetable_id, id),
  FOREIGN KEY (org_id, timetable_id) REFERENCES school_timetable (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX school_timetable_group_name ON school_timetable_group
  (org_id, timetable_id, lower(name));

CREATE TABLE school_timetable_group_section (
  org_id uuid NOT NULL REFERENCES organisation (id),
  group_id uuid NOT NULL,
  section_id uuid NOT NULL,
  PRIMARY KEY (org_id, group_id, section_id),
  FOREIGN KEY (org_id, group_id) REFERENCES school_timetable_group (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id)
);

-- A slot belongs to a section or to a group, never both.
ALTER TABLE school_timetable_slot ALTER COLUMN section_id DROP NOT NULL;
ALTER TABLE school_timetable_slot ADD COLUMN group_id uuid;
ALTER TABLE school_timetable_slot
  ADD FOREIGN KEY (org_id, timetable_id, group_id)
    REFERENCES school_timetable_group (org_id, timetable_id, id) ON DELETE CASCADE,
  ADD CHECK ((section_id IS NULL) <> (group_id IS NULL));
-- One row per subject of a group in a period.
CREATE UNIQUE INDEX school_timetable_slot_group ON school_timetable_slot
  (org_id, timetable_id, group_id, weekday, period, subject_id) WHERE group_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_timetable_group', 'school_timetable_group_section'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_timetable_group, school_timetable_group_section TO cv_app;

-- A published version's groups never change either.
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON school_timetable_group
  FOR EACH ROW EXECUTE FUNCTION school_timetable_frozen();
CREATE FUNCTION school_timetable_group_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM school_timetable_group g JOIN school_timetable t
               ON t.org_id = g.org_id AND t.id = g.timetable_id
             WHERE g.org_id = COALESCE(NEW.org_id, OLD.org_id)
               AND g.id = COALESCE(NEW.group_id, OLD.group_id) AND t.state = 'published') THEN
    RAISE EXCEPTION 'timetable_published' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON school_timetable_group_section
  FOR EACH ROW EXECUTE FUNCTION school_timetable_group_frozen();
