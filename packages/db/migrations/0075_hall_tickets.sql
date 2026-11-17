-- Academics › Exams & Results › Hall Tickets & Eligibility (rule book §13.2: "Attendance, fee and
-- no-dues checks; QR admit cards"; §16: "Hall ticket in app; ineligibility notice with reason";
-- P0 item 12). One hall ticket per student per term: the courses they may sit, frozen in a
-- QR-verifiable document (platform/documents). Issued despite overdue fees only with a reason.
-- Owned by academics/exams.

CREATE TABLE exam_hall_ticket (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL CHECK (term_number BETWEEN 1 AND 16),
  student_person_id uuid NOT NULL,
  number text NOT NULL CHECK (length(number) BETWEEN 3 AND 60),
  -- The courses the student may sit, as printed (course ids, in order).
  course_ids uuid[] NOT NULL CHECK (cardinality(course_ids) >= 1),
  document_id uuid NOT NULL,
  -- Why it was issued although fees were overdue; null when they weren't.
  released_reason text CHECK (released_reason IS NULL OR length(btrim(released_reason)) BETWEEN 3 AND 300),
  issued_by_person_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, batch_id, term_number, student_person_id),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, document_id) REFERENCES issued_document (org_id, id),
  FOREIGN KEY (org_id, issued_by_person_id) REFERENCES person (org_id, id)
);

ALTER TABLE exam_hall_ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_hall_ticket FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exam_hall_ticket
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
-- Re-issued (a new document version) when the courses change, e.g. after a condonation.
GRANT SELECT, INSERT, UPDATE ON exam_hall_ticket TO cv_app;
