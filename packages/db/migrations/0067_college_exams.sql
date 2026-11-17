-- Academics › Exams & Results for colleges and universities (rule book §13.2 Assessments, Exams &
-- Results; P0 item 12): internal (CIE) and end-exam (SEE) marks per course of a batch's term,
-- locked when submitted; results graded on the credits pack's scale, SGPA and CGPA, published only
-- with a second person's approval. Owned by academics/exams.

CREATE TABLE exam_mark (
  org_id uuid NOT NULL REFERENCES organisation (id),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL CHECK (term_number BETWEEN 1 AND 16),
  course_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  cie numeric(5, 2) CHECK (cie >= 0 AND cie <= 100),
  see numeric(5, 2) CHECK (see >= 0 AND see <= 100),
  absent boolean NOT NULL DEFAULT false,
  entered_by_person_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, batch_id, term_number, course_id, student_person_id),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, entered_by_person_id) REFERENCES person (org_id, id),
  CHECK (NOT absent OR see IS NULL)
);

-- A course's marks, submitted: no more changes unless the exam controller unlocks it.
CREATE TABLE exam_course_lock (
  org_id uuid NOT NULL REFERENCES organisation (id),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL,
  course_id uuid NOT NULL,
  locked_by_person_id uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, batch_id, term_number, course_id),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id),
  FOREIGN KEY (org_id, locked_by_person_id) REFERENCES person (org_id, id)
);

-- A term's results: computed and frozen when sent for approval; seen by students once published.
CREATE TABLE exam_result (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'rejected')),
  -- The grading scale used, kept with the result so a later pack version never regrades it.
  grading jsonb NOT NULL,
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_note text,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX exam_result_live_idx ON exam_result (org_id, batch_id, term_number)
  WHERE state <> 'rejected';

CREATE TABLE exam_grade (
  org_id uuid NOT NULL REFERENCES organisation (id),
  result_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  course_id uuid NOT NULL,
  credits numeric(4, 1) NOT NULL CHECK (credits >= 0),
  cie numeric(5, 2),
  see numeric(5, 2),
  absent boolean NOT NULL,
  total numeric(6, 2) NOT NULL,
  grade text NOT NULL,
  point numeric(4, 2) NOT NULL CHECK (point BETWEEN 0 AND 10),
  PRIMARY KEY (org_id, result_id, student_person_id, course_id),
  FOREIGN KEY (org_id, result_id) REFERENCES exam_result (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id)
);

CREATE TABLE exam_gpa (
  org_id uuid NOT NULL REFERENCES organisation (id),
  result_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  credits numeric(5, 1) NOT NULL,
  credits_earned numeric(5, 1) NOT NULL,
  sgpa numeric(4, 2),
  cgpa numeric(4, 2),
  PRIMARY KEY (org_id, result_id, student_person_id),
  FOREIGN KEY (org_id, result_id) REFERENCES exam_result (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id)
);

-- Frozen grades never change.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON exam_grade
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON exam_gpa
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_mark', 'exam_course_lock', 'exam_result', 'exam_grade', 'exam_gpa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON exam_mark, exam_result TO cv_app;
GRANT SELECT, INSERT, DELETE ON exam_course_lock TO cv_app;
GRANT SELECT, INSERT ON exam_grade, exam_gpa TO cv_app;

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('academics.exam.marks'), ('academics.exam.manage'), ('academics.exam.publish'))
  AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.exam.marks' FROM role r WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
