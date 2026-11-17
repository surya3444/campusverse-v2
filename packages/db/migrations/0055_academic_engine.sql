-- The academic engine (rule book §12.3, §12.4 decisions 2–3, P0 item 3): institution profiles and
-- two of the three linked trees. Curriculum: program → regulation (versioned) → courses.
-- Cohort: batch → term → section → enrolment. A batch keeps the regulation version it started
-- with and advances one term at a time; nothing is ever copied into a new year.
-- Owned by academics/structure; the profile column by platform/organisation.

-- Institution profile (§12.3): switches modules, vocabulary and rule source per institution.
ALTER TABLE institution ADD COLUMN profile text;
UPDATE institution SET profile = CASE type WHEN 'college' THEN 'affiliated_college' ELSE type END;
ALTER TABLE institution
  ALTER COLUMN profile SET NOT NULL,
  ADD CONSTRAINT institution_profile_check CHECK (
    (type = 'school' AND profile = 'school')
    OR (type = 'college' AND profile IN ('affiliated_college', 'autonomous_college'))
    OR (type = 'university' AND profile = 'university'));

CREATE TABLE academic_program (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  level text NOT NULL CHECK (level IN ('certificate', 'diploma', 'ug', 'pg', 'doctoral')),
  term_kind text NOT NULL CHECK (term_kind IN ('semester', 'trimester', 'year')),
  terms smallint NOT NULL CHECK (terms BETWEEN 1 AND 16),
  -- A credit framework from packages/rules (CREDIT_FRAMEWORKS); null when the program sets none.
  framework text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, institution_id, code),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

-- A regulation is a numbered version of a program's rules. Published versions never change;
-- a change is a new version, and batches already running keep theirs.
CREATE TABLE academic_regulation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  program_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  version smallint NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  effective_from date NOT NULL,
  min_credits numeric(5, 1) CHECK (min_credits > 0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, program_id, id),
  UNIQUE (org_id, program_id, code, version),
  FOREIGN KEY (org_id, program_id) REFERENCES academic_program (org_id, id),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);
-- One draft per program and code at a time.
CREATE UNIQUE INDEX academic_regulation_draft_idx ON academic_regulation (org_id, program_id, code)
  WHERE status = 'draft';

CREATE TABLE academic_course (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, institution_id, code),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

-- A course in a regulation: its term, type and L-T-P credits, fixed with the regulation.
CREATE TABLE academic_curriculum (
  org_id uuid NOT NULL REFERENCES organisation (id),
  regulation_id uuid NOT NULL,
  course_id uuid NOT NULL,
  term_number smallint NOT NULL CHECK (term_number BETWEEN 1 AND 16),
  kind text NOT NULL CHECK (kind IN ('core', 'elective', 'open_elective', 'lab', 'project', 'value_added')),
  lecture smallint NOT NULL DEFAULT 0 CHECK (lecture BETWEEN 0 AND 12),
  tutorial smallint NOT NULL DEFAULT 0 CHECK (tutorial BETWEEN 0 AND 12),
  practical smallint NOT NULL DEFAULT 0 CHECK (practical BETWEEN 0 AND 24),
  credits numeric(4, 1) NOT NULL CHECK (credits >= 0 AND credits <= 30),
  PRIMARY KEY (org_id, regulation_id, course_id),
  FOREIGN KEY (org_id, regulation_id) REFERENCES academic_regulation (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id)
);
CREATE INDEX academic_curriculum_course_idx ON academic_curriculum (org_id, course_id);

-- A published regulation's curriculum is frozen, whoever writes.
CREATE FUNCTION academic_curriculum_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM academic_regulation r
             WHERE r.org_id = COALESCE(NEW.org_id, OLD.org_id)
               AND r.id = COALESCE(NEW.regulation_id, OLD.regulation_id)
               AND r.status = 'published') THEN
    RAISE EXCEPTION 'regulation is published' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER frozen BEFORE INSERT OR UPDATE OR DELETE ON academic_curriculum
  FOR EACH ROW EXECUTE FUNCTION academic_curriculum_frozen();

CREATE TABLE academic_batch (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  program_id uuid NOT NULL,
  regulation_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 40),
  start_year smallint NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  intake integer CHECK (intake > 0),
  current_term smallint NOT NULL DEFAULT 1 CHECK (current_term BETWEEN 1 AND 16),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, program_id, label),
  -- The regulation belongs to the batch's own program.
  FOREIGN KEY (org_id, program_id, regulation_id) REFERENCES academic_regulation (org_id, program_id, id)
);

CREATE TABLE academic_term (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  number smallint NOT NULL CHECK (number BETWEEN 1 AND 16),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, batch_id, number),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX academic_term_open_idx ON academic_term (org_id, batch_id) WHERE status = 'open';

CREATE TABLE academic_section (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  name text NOT NULL CHECK (name ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  capacity smallint NOT NULL DEFAULT 60 CHECK (capacity BETWEEN 1 AND 500),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, batch_id, id),
  UNIQUE (org_id, batch_id, name),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id)
);

-- A student in a batch section from one term until (and including) another. Moving section ends
-- one enrolment and starts another; history stays.
CREATE TABLE academic_enrolment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  section_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  register_number text CHECK (register_number ~ '^[A-Za-z0-9/-]{1,30}$'),
  from_term smallint NOT NULL CHECK (from_term BETWEEN 1 AND 16),
  until_term smallint CHECK (until_term BETWEEN 1 AND 16),
  ended_reason text CHECK (ended_reason IN ('completed', 'left', 'moved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, batch_id, section_id) REFERENCES academic_section (org_id, batch_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  CHECK (until_term IS NULL OR until_term >= from_term - 1),
  CHECK ((until_term IS NULL) = (ended_reason IS NULL))
);
CREATE UNIQUE INDEX academic_enrolment_current_idx ON academic_enrolment (org_id, batch_id, student_person_id)
  WHERE until_term IS NULL;
CREATE UNIQUE INDEX academic_enrolment_register_idx ON academic_enrolment (org_id, batch_id, register_number)
  WHERE until_term IS NULL AND register_number IS NOT NULL;
CREATE INDEX academic_enrolment_section_idx ON academic_enrolment (org_id, section_id);
CREATE INDEX academic_enrolment_student_idx ON academic_enrolment (org_id, student_person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_program', 'academic_regulation', 'academic_course', 'academic_curriculum',
    'academic_batch', 'academic_term', 'academic_section', 'academic_enrolment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON academic_program, academic_regulation, academic_course, academic_batch,
  academic_term, academic_section, academic_enrolment TO cv_app;
-- Draft curricula are edited row by row.
GRANT SELECT, INSERT, UPDATE, DELETE ON academic_curriculum TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue).
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('academics.structure.read'), ('academics.structure.manage'), ('academics.enrolment.manage'))
  AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.structure.read' FROM role r WHERE r.key IN ('office', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
