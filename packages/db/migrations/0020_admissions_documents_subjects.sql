-- Milestone 21 (docs/specs/INSTITUTION_DEPTH.md): an applicant's photo and documents (carried
-- into the student's record on enrolment), and subjects managed on screen.

ALTER TABLE school_application ADD COLUMN photo_file_id uuid;
ALTER TABLE school_application ADD FOREIGN KEY (org_id, photo_file_id) REFERENCES stored_file (org_id, id);

CREATE TABLE school_application_document (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  application_id uuid NOT NULL,
  folder text NOT NULL DEFAULT 'identity' CHECK (folder IN ('identity', 'academic', 'medical', 'transfer', 'other')),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 120),
  file_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'verified', 'rejected')),
  note text CHECK (length(note) <= 300),
  uploaded_by_person_id uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  checked_by_person_id uuid,
  checked_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, application_id) REFERENCES school_application (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id),
  FOREIGN KEY (org_id, uploaded_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, checked_by_person_id) REFERENCES person (org_id, id),
  CHECK (status <> 'rejected' OR note IS NOT NULL)
);
CREATE INDEX school_application_document_idx ON school_application_document (org_id, application_id);

ALTER TABLE school_application_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_application_document FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_application_document
  USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());
GRANT SELECT, INSERT, UPDATE ON school_application_document TO cv_app;

-- Subjects: a type, retirement (past marks keep pointing at a retired subject), and periods per
-- week for each class's offering.
ALTER TABLE school_subject
  ADD COLUMN kind text NOT NULL DEFAULT 'scholastic'
    CHECK (kind IN ('scholastic', 'co_scholastic', 'language', 'elective')),
  ADD COLUMN retired_at timestamptz;
ALTER TABLE school_subject_offering
  ADD COLUMN periods_per_week integer CHECK (periods_per_week BETWEEN 0 AND 20);

GRANT SELECT, INSERT, UPDATE ON school_subject, school_subject_offering TO cv_app;
-- Taking a subject off a class: offerings hold no history (marks point at the subject).
GRANT DELETE ON school_subject_offering TO cv_app;
GRANT SELECT, INSERT, UPDATE ON school_teacher_allocation TO cv_app;
