-- Syllabus and lesson plans, step 1 (docs/specs/SYLLABUS.md). Owned by school/syllabus.

CREATE TABLE school_syllabus_unit (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  year_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 500),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  planned_month date CHECK (extract(day FROM planned_month) = 1),
  periods smallint CHECK (periods BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id)
);
CREATE INDEX school_syllabus_unit_idx ON school_syllabus_unit (org_id, year_id, class_id, subject_id, position);

CREATE TABLE school_syllabus_progress (
  org_id uuid NOT NULL REFERENCES organisation (id),
  unit_id uuid NOT NULL,
  section_id uuid NOT NULL,
  completed_on date NOT NULL,
  completed_by_person_id uuid NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  PRIMARY KEY (org_id, unit_id, section_id),
  FOREIGN KEY (org_id, unit_id) REFERENCES school_syllabus_unit (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, completed_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX school_syllabus_progress_section_idx ON school_syllabus_progress (org_id, section_id);

CREATE TABLE school_lesson_plan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  section_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  unit_id uuid,
  on_date date NOT NULL,
  plan text NOT NULL CHECK (length(btrim(plan)) BETWEEN 1 AND 2000),
  written_by_person_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, section_id, subject_id, on_date),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  FOREIGN KEY (org_id, unit_id) REFERENCES school_syllabus_unit (org_id, id),
  FOREIGN KEY (org_id, written_by_person_id) REFERENCES person (org_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_syllabus_unit', 'school_syllabus_progress', 'school_lesson_plan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON school_syllabus_unit, school_syllabus_progress TO cv_app;
GRANT SELECT, INSERT, UPDATE ON school_lesson_plan TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('school.syllabus.read'), ('school.syllabus.teach'), ('school.syllabus.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('school.syllabus.read'), ('school.syllabus.teach')) AS p (permission)
WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.syllabus.read' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
