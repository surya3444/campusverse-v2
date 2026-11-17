-- Academics › Exams & Results › Re-exams (rule book §13.2: "revaluation, supplementary"; P0 item
-- 12): a published course grade looked at again. Supplementary for a failed course (internal marks
-- carry over); revaluation of the end-exam script (a grade never goes down). The new grade is
-- approved through the workflow engine, then overrides the published one in grade cards, CGPA and
-- the ABC file; the frozen exam_grade row never changes. Owned by academics/exams.

CREATE TABLE exam_reexam (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  result_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  course_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('revaluation', 'supplementary')),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'marked', 'approved', 'rejected')),
  -- The grade it starts from (the published one, or an earlier re-exam's).
  old_see numeric(5, 2),
  old_total numeric(6, 2) NOT NULL,
  old_grade text NOT NULL,
  old_point numeric(4, 2) NOT NULL,
  -- The new end-exam mark and the grade it gives on the term's frozen scale.
  see numeric(5, 2) CHECK (see >= 0 AND see <= 100),
  absent boolean,
  total numeric(6, 2),
  grade text,
  point numeric(4, 2) CHECK (point BETWEEN 0 AND 10),
  passed boolean,
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  marked_by_person_id uuid,
  marked_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, result_id, student_person_id, course_id)
    REFERENCES exam_grade (org_id, result_id, student_person_id, course_id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, marked_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'requested') = (marked_at IS NULL)),
  CHECK (marked_at IS NULL OR (grade IS NOT NULL AND point IS NOT NULL AND total IS NOT NULL
    AND absent IS NOT NULL AND passed IS NOT NULL)),
  CHECK ((state IN ('approved', 'rejected')) = (decided_at IS NOT NULL))
);
-- One open re-exam per course and student at a time.
CREATE UNIQUE INDEX exam_reexam_open_idx ON exam_reexam (org_id, result_id, student_person_id, course_id)
  WHERE state IN ('requested', 'marked');

ALTER TABLE exam_reexam ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_reexam FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_reexam
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON exam_reexam TO cv_app;
