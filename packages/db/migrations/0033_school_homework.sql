-- Homework and class diary, step 1 (docs/specs/HOMEWORK.md). Owned by school/homework.

CREATE TABLE school_homework (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 2000),
  set_on date NOT NULL,
  due_on date NOT NULL,
  set_by_person_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  FOREIGN KEY (org_id, set_by_person_id) REFERENCES person (org_id, id),
  CHECK (due_on >= set_on AND due_on <= set_on + 60)
);
CREATE INDEX school_homework_due_idx ON school_homework (org_id, institution_id, due_on);

CREATE TABLE school_homework_section (
  org_id uuid NOT NULL REFERENCES organisation (id),
  homework_id uuid NOT NULL,
  section_id uuid NOT NULL,
  PRIMARY KEY (org_id, homework_id, section_id),
  FOREIGN KEY (org_id, homework_id) REFERENCES school_homework (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id)
);
CREATE INDEX school_homework_section_idx ON school_homework_section (org_id, section_id);

CREATE TABLE school_homework_file (
  org_id uuid NOT NULL REFERENCES organisation (id),
  homework_id uuid NOT NULL,
  file_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
  PRIMARY KEY (org_id, homework_id, position),
  UNIQUE (org_id, homework_id, file_id),
  FOREIGN KEY (org_id, homework_id) REFERENCES school_homework (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id)
);

CREATE TABLE school_homework_done (
  org_id uuid NOT NULL REFERENCES organisation (id),
  homework_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  marked_by_person_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, homework_id, student_person_id),
  FOREIGN KEY (org_id, homework_id) REFERENCES school_homework (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, marked_by_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE school_diary_entry (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  section_id uuid NOT NULL,
  on_date date NOT NULL,
  -- Blank: a general note from the class teacher.
  subject_id uuid,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  written_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  FOREIGN KEY (org_id, written_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX school_diary_entry_section_idx ON school_diary_entry (org_id, section_id, on_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_homework', 'school_homework_section', 'school_homework_file',
    'school_homework_done', 'school_diary_entry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON school_homework, school_diary_entry TO cv_app;
-- Sections and files are replaced on edit; a done tick is removed on undo.
GRANT SELECT, INSERT, DELETE ON school_homework_section, school_homework_file, school_homework_done TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('school.homework.read'), ('school.homework.set'), ('school.homework.manage')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('school.homework.read'), ('school.homework.set')) AS p (permission)
WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'school.homework.read' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, p.permission, 'guardian' FROM role r
CROSS JOIN (VALUES ('school.homework.read'), ('school.homework.done')) AS p (permission)
WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
