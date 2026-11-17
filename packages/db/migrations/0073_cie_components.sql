-- Academics › Assessments (rule book §13.2: "CIE Plan: weighted components from the regulation";
-- "Gradebook: marks per component; locks on submission"; P0 item 12). A course's internal
-- assessment components live on its curriculum row, so they are frozen with the regulation by the
-- existing trigger; each student's score per component is kept, and the internal (CIE) mark is
-- worked out from them. Owned by academics/structure (the plan) and academics/exams (the scores).

-- [{ "name": "Test 1", "maxMarks": 50, "weight": 40 }, …], weights adding up to 100; null: one CIE mark.
ALTER TABLE academic_curriculum ADD COLUMN cie_components jsonb
  CHECK (cie_components IS NULL OR (jsonb_typeof(cie_components) = 'array'
    AND jsonb_array_length(cie_components) BETWEEN 1 AND 8));

CREATE TABLE exam_cie_score (
  org_id uuid NOT NULL REFERENCES organisation (id),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL,
  course_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  -- The component's place in the course's plan (0-based).
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
  score numeric(6, 2) NOT NULL CHECK (score >= 0),
  PRIMARY KEY (org_id, batch_id, term_number, course_id, student_person_id, position),
  FOREIGN KEY (org_id, batch_id, term_number, course_id, student_person_id)
    REFERENCES exam_mark (org_id, batch_id, term_number, course_id, student_person_id)
);

ALTER TABLE exam_cie_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_cie_score FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_cie_score
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON exam_cie_score TO cv_app;
