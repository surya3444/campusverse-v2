-- Exam patterns, the year's final result, and the full report card (owner's brief, 21 Nov 2026;
-- rule book §13 Exams & Results: "Exam Setup: patterns … internal/external, practicals";
-- "Results … CBSE … grades; publish with approval"; "Report Cards & HPC: board report cards …
-- remarks"). Owned by school/exams.
--
-- 1. A subject's marks can be split into parts (Theory 80 + Practical 20, Theory 80 + Internal
--    assessment 20): each part is its own paper of the same subject, with its own maximum, marks
--    grid, date and submission. A paper with no split has the empty part ''. The subject's result
--    adds its parts up.
-- 2. Co-scholastic areas (Work Education, Art Education, Health & Physical Education,
--    Discipline …) per institution, graded A, B or C per student in each exam by the class
--    teacher, printed on the report card.
-- 3. A final result combines published exams with weights (Periodic test 10%, Half-yearly 30%,
--    Annual 60%) into each subject's year percentage, graded by the board's scheme, and issues the
--    year's report card. Final results are frozen once published.

ALTER TABLE school_exam_paper
  ADD COLUMN part text NOT NULL DEFAULT '' CHECK (length(part) <= 30),
  ADD COLUMN part_seq smallint NOT NULL DEFAULT 0 CHECK (part_seq BETWEEN 0 AND 9);

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'school_exam_paper'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (org_id, exam_id, class_id, subject_id)';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE school_exam_paper DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE school_exam_paper
  ADD CONSTRAINT school_exam_paper_part_key UNIQUE (org_id, exam_id, class_id, subject_id, part);
-- A subject's parts are replaced while no marks are in them.
GRANT DELETE ON school_exam_paper TO cv_app;

CREATE TABLE school_coscholastic_area (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),
  seq smallint NOT NULL DEFAULT 0,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  UNIQUE (org_id, institution_id, name)
);

CREATE TABLE school_exam_coscholastic (
  org_id uuid NOT NULL REFERENCES organisation (id),
  exam_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  area_id uuid NOT NULL,
  grade text NOT NULL CHECK (grade IN ('A', 'B', 'C')),
  entered_by_person_id uuid NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, exam_id, student_person_id, area_id),
  FOREIGN KEY (org_id, exam_id) REFERENCES school_exam (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, area_id) REFERENCES school_coscholastic_area (org_id, id),
  FOREIGN KEY (org_id, entered_by_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE school_result_plan (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
  class_ids uuid[] NOT NULL CHECK (cardinality(class_ids) > 0),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  grade_scheme text,
  created_by_person_id uuid NOT NULL,
  published_by_person_id uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, published_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'published') = (published_at IS NOT NULL AND grade_scheme IS NOT NULL))
);

CREATE TABLE school_result_plan_exam (
  org_id uuid NOT NULL REFERENCES organisation (id),
  plan_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  weight_bp integer NOT NULL CHECK (weight_bp BETWEEN 1 AND 10000),
  seq smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, plan_id, exam_id),
  FOREIGN KEY (org_id, plan_id) REFERENCES school_result_plan (org_id, id),
  FOREIGN KEY (org_id, exam_id) REFERENCES school_exam (org_id, id)
);

CREATE TABLE school_final_result (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  plan_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  class_id uuid NOT NULL,
  section_id uuid NOT NULL,
  subjects jsonb NOT NULL,
  percent numeric(5, 2),
  grade text,
  grade_scheme text NOT NULL,
  report_document_id uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, plan_id) REFERENCES school_result_plan (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, report_document_id) REFERENCES issued_document (org_id, id),
  UNIQUE (org_id, plan_id, student_person_id)
);
CREATE INDEX school_final_result_student_idx ON school_final_result (org_id, student_person_id, published_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON school_final_result
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON school_final_result
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_coscholastic_area', 'school_exam_coscholastic', 'school_result_plan',
    'school_result_plan_exam', 'school_final_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON school_coscholastic_area, school_result_plan TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_exam_coscholastic, school_result_plan_exam TO cv_app;
GRANT SELECT, INSERT ON school_final_result TO cv_app;
