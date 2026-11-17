-- Exams (papers, marks, locks, frozen results), the section planner and year rollover. School academic.

CREATE TABLE school_exam (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  class_ids uuid[] NOT NULL CHECK (cardinality(class_ids) > 0),
  state text NOT NULL DEFAULT 'marks_open' CHECK (state IN ('marks_open', 'marks_locked', 'published', 'cancelled')),
  starts_on date,
  ends_on date,
  grade_scheme text,
  created_by_person_id uuid NOT NULL,
  locked_by_person_id uuid,
  locked_at timestamptz,
  published_by_person_id uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  CHECK (state <> 'published' OR (published_at IS NOT NULL AND grade_scheme IS NOT NULL))
);

CREATE TABLE school_exam_paper (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  exam_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  max_marks numeric(6, 2) NOT NULL CHECK (max_marks > 0),
  on_date date,
  submitted_by_person_id uuid,
  submitted_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, exam_id) REFERENCES school_exam (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  FOREIGN KEY (org_id, subject_id) REFERENCES school_subject (org_id, id),
  UNIQUE (org_id, exam_id, class_id, subject_id)
);

-- A value or a code, never both. No row (or neither) is blank, and blank is never zero.
CREATE TABLE school_exam_mark (
  org_id uuid NOT NULL REFERENCES organisation (id),
  paper_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  value numeric(6, 2) CHECK (value >= 0),
  code text CHECK (code IN ('AB', 'ML', 'UFM', 'EX', 'NA')),
  entered_by_person_id uuid NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, paper_id, student_person_id),
  FOREIGN KEY (org_id, paper_id) REFERENCES school_exam_paper (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  CHECK (value IS NULL OR code IS NULL)
);

-- After the lock: one person asks with a reason, a different person decides.
CREATE TABLE school_exam_mark_change (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  paper_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  new_value numeric(6, 2) CHECK (new_value >= 0),
  new_code text CHECK (new_code IN ('AB', 'ML', 'UFM', 'EX', 'NA')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'rejected')),
  requested_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, paper_id) REFERENCES school_exam_paper (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  CHECK ((new_value IS NULL) <> (new_code IS NULL)),
  CHECK (decided_by_person_id IS DISTINCT FROM requested_by_person_id)
);

CREATE TABLE school_exam_remark (
  org_id uuid NOT NULL REFERENCES organisation (id),
  exam_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  remark text NOT NULL CHECK (btrim(remark) <> '' AND length(remark) <= 300),
  written_by_person_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, exam_id, student_person_id),
  FOREIGN KEY (org_id, exam_id) REFERENCES school_exam (org_id, id)
);

-- Append-only: each student's result as published, with the grading scheme version it used.
CREATE TABLE school_exam_result (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  exam_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  class_id uuid NOT NULL,
  section_id uuid NOT NULL,
  subjects jsonb NOT NULL,
  marks numeric(8, 2) NOT NULL,
  max_marks numeric(8, 2) NOT NULL,
  percent numeric(5, 2),
  grade text,
  grade_scheme text NOT NULL,
  report_document_id uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, exam_id) REFERENCES school_exam (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, report_document_id) REFERENCES issued_document (org_id, id),
  UNIQUE (org_id, exam_id, student_person_id)
);

CREATE TABLE school_section_plan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  to_year_id uuid NOT NULL,
  class_id uuid NOT NULL,
  -- {"<studentId>": "<sectionId>"} for the coming year.
  assignments jsonb NOT NULL DEFAULT '{}',
  keep_apart jsonb NOT NULL DEFAULT '[]',
  updated_by_person_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, to_year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  UNIQUE (org_id, to_year_id, class_id)
);

CREATE TABLE school_rollover (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  from_year_id uuid NOT NULL,
  to_year_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'committed' CHECK (state IN ('committed', 'undone')),
  -- What was decided per student: outcome, next class and section, and any override reason.
  rows jsonb NOT NULL,
  committed_by_person_id uuid NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  undone_by_person_id uuid,
  undone_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, from_year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, to_year_id) REFERENCES school_year (org_id, id),
  CHECK ((state = 'undone') = (undone_at IS NOT NULL))
);
CREATE UNIQUE INDEX school_rollover_one_live ON school_rollover (org_id, from_year_id) WHERE state = 'committed';

-- Enrolments a rollover created, so it can be undone while the new year is unused.
ALTER TABLE school_enrolment ADD COLUMN rollover_id uuid;
ALTER TABLE school_enrolment ADD CONSTRAINT school_enrolment_rollover_fk
  FOREIGN KEY (org_id, rollover_id) REFERENCES school_rollover (org_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_exam', 'school_exam_paper', 'school_exam_mark', 'school_exam_mark_change',
    'school_exam_remark', 'school_exam_result', 'school_section_plan', 'school_rollover'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON school_exam, school_exam_paper, school_exam_mark, school_exam_mark_change,
  school_exam_remark, school_section_plan, school_rollover TO cv_app;
GRANT SELECT, INSERT ON school_exam_result TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON school_exam_result FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, g.permission
FROM role r JOIN (VALUES
  ('school_admin', 'school.exam.manage'), ('school_admin', 'school.exam.enter_marks'), ('school_admin', 'school.exam.lock'),
  ('school_admin', 'school.exam.publish'), ('school_admin', 'school.exam.read'), ('school_admin', 'school.rollover.manage'),
  ('principal', 'school.exam.manage'), ('principal', 'school.exam.enter_marks'), ('principal', 'school.exam.lock'),
  ('principal', 'school.exam.publish'), ('principal', 'school.exam.read'), ('principal', 'school.rollover.manage'),
  ('teacher', 'school.exam.enter_marks'), ('teacher', 'school.exam.read')
) AS g (role_key, permission) ON g.role_key = r.key
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'school.exam.read', 'guardian' FROM role r WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
