-- School structure, enrolment, staff profiles and Excel import batches.

ALTER TABLE institution ADD COLUMN state_code text CHECK (state_code ~ '^[A-Z]{2}$');

-- One upload of students or staff. Rows wait here as a preview until committed.
CREATE TABLE import_batch (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('students', 'staff')),
  file_name text NOT NULL CHECK (btrim(file_name) <> '' AND length(file_name) <= 200),
  status text NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'committing', 'committed', 'undone', 'failed')),
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  failure text,
  created_by_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  undone_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

-- Parsed rows with their problems. Holds personal data until committed; purge after use.
CREATE TABLE import_row (
  org_id uuid NOT NULL REFERENCES organisation (id),
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  status text NOT NULL CHECK (status IN ('valid', 'invalid', 'duplicate')),
  data jsonb NOT NULL,
  problems jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (org_id, batch_id, row_number),
  FOREIGN KEY (org_id, batch_id) REFERENCES import_batch (org_id, id)
);

-- Rows an import creates carry its batch, so the whole batch can be undone.
ALTER TABLE person ADD COLUMN import_batch_id uuid;
ALTER TABLE person ADD FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id);
ALTER TABLE guardian_link ADD COLUMN import_batch_id uuid;
ALTER TABLE guardian_link ADD FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id);
ALTER TABLE person_contact ADD COLUMN import_batch_id uuid;
ALTER TABLE person_contact ADD FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id);
ALTER TABLE role_assignment ADD COLUMN import_batch_id uuid;
ALTER TABLE role_assignment ADD FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id);

CREATE TABLE school_year (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  label text NOT NULL CHECK (label ~ '^\d{4}-\d{2}$'),
  valid_during daterange NOT NULL CHECK (NOT lower_inf(valid_during) AND NOT upper_inf(valid_during)),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, label),
  EXCLUDE USING gist (org_id WITH =, institution_id WITH =, valid_during WITH &&)
);

CREATE TABLE school_class (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  sequence integer NOT NULL CHECK (sequence >= 0),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, code)
);

-- A section belongs to one year, so sections can reshuffle each year.
CREATE TABLE school_section (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  year_id uuid NOT NULL,
  class_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[A-Z0-9]{1,4}$'),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 80),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  UNIQUE (org_id, year_id, class_id, name)
);

CREATE TABLE school_subject (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{2,8}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, code)
);

CREATE TABLE school_subject_offering (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  year_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  UNIQUE (org_id, year_id, class_id, subject_id)
);

-- Minimal now (employee code for import matching); Milestone 8 adds the full staff record.
CREATE TABLE staff_profile (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  employee_code text NOT NULL CHECK (employee_code ~ '^[A-Za-z0-9/_-]{1,30}$'),
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, person_id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  UNIQUE (org_id, employee_code)
);

-- Class teacher (one per section at a time) and subject teachers.
CREATE TABLE school_teacher_allocation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  section_id uuid NOT NULL,
  subject_id uuid,
  teacher_person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('class_teacher', 'subject_teacher')),
  valid_during daterange NOT NULL DEFAULT daterange(app_today(), NULL),
  import_batch_id uuid,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  FOREIGN KEY (org_id, teacher_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  CHECK ((kind = 'class_teacher') = (subject_id IS NULL)),
  EXCLUDE USING gist (org_id WITH =, section_id WITH =, valid_during WITH &&) WHERE (kind = 'class_teacher'),
  EXCLUDE USING gist (org_id WITH =, section_id WITH =, subject_id WITH =, teacher_person_id WITH =, valid_during WITH &&)
    WHERE (kind = 'subject_teacher')
);
CREATE INDEX school_teacher_allocation_teacher_idx ON school_teacher_allocation (org_id, teacher_person_id);

-- Dated enrolment: a section change is a new row, so old attendance stays with the old section.
CREATE TABLE school_enrolment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  section_id uuid NOT NULL,
  admission_number text NOT NULL CHECK (admission_number ~ '^[A-Za-z0-9/_-]{1,30}$'),
  roll_number integer CHECK (roll_number > 0),
  valid_during daterange NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'promoted', 'conditional', 'detained', 'transferred', 'withdrawn')),
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  -- In one place at a time.
  EXCLUDE USING gist (org_id WITH =, person_id WITH =, valid_during WITH &&),
  -- An admission number belongs to one person in a school, across years.
  EXCLUDE USING gist (org_id WITH =, institution_id WITH =, admission_number WITH =, person_id WITH <>),
  -- No two students share a roll number in a section at the same time.
  EXCLUDE USING gist (org_id WITH =, section_id WITH =, roll_number WITH =, valid_during WITH &&)
    WHERE (roll_number IS NOT NULL)
);
CREATE INDEX school_enrolment_section_idx ON school_enrolment (org_id, section_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_batch', 'import_row', 'school_year', 'school_class', 'school_section',
    'school_subject', 'school_subject_offering', 'staff_profile', 'school_teacher_allocation',
    'school_enrolment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;

  -- Undo: the app may delete only rows an import created. Everything else is never deleted.
  FOREACH t IN ARRAY ARRAY['person', 'guardian_link', 'person_contact', 'role_assignment',
    'staff_profile', 'school_teacher_allocation', 'school_enrolment']
  LOOP
    EXECUTE format('CREATE POLICY delete_imported_only ON %I AS RESTRICTIVE FOR DELETE '
      'USING (import_batch_id IS NOT NULL)', t);
    EXECUTE format('GRANT DELETE ON %I TO cv_app', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON import_batch, import_row, school_year, school_class, school_section,
  school_subject, school_subject_offering, staff_profile, school_teacher_allocation, school_enrolment
  TO cv_app;
-- Preview rows are replaced when a file is uploaded again.
GRANT DELETE ON import_row TO cv_app;
