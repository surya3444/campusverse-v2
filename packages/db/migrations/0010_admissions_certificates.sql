-- Admissions (enquiry to enrolment) and certificates (TC, bonafide, fee paid), school academic.

CREATE TABLE school_admission_seat (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  class_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('general', 'rte', 'staff', 'management')),
  seats integer NOT NULL CHECK (seats >= 0),
  PRIMARY KEY (org_id, institution_id, year_label, class_id, category),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id)
);

CREATE TABLE school_application (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  class_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'rte', 'staff', 'management')),
  source text NOT NULL CHECK (source IN ('walk_in', 'phone', 'website', 'referral', 'rte_portal', 'other')),
  state text NOT NULL DEFAULT 'enquiry' CHECK (state IN (
    'enquiry', 'contacted', 'applied', 'documents_pending', 'under_review', 'offered', 'waitlisted',
    'confirmed', 'enrolled', 'lost', 'withdrawn', 'rejected'
  )),
  child_name text NOT NULL CHECK (btrim(child_name) <> ''),
  date_of_birth date,
  gender text CHECK (gender IN ('female', 'male', 'other', 'not_stated')),
  guardian_name text NOT NULL CHECK (btrim(guardian_name) <> ''),
  guardian_phone text NOT NULL CHECK (guardian_phone ~ '^\+91[6-9][0-9]{9}$'),
  guardian_relationship text NOT NULL DEFAULT 'parent',
  previous_school text,
  notes text,
  next_follow_up date,
  -- A current student's guardian has this phone: a likely sibling (shown, never merged).
  sibling_of_person_id uuid,
  age_override_reason text,
  age_order_ref text,
  offer_expires_on date,
  waitlist_position integer CHECK (waitlist_position >= 1),
  closed_reason text,
  student_person_id uuid,
  created_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, class_id) REFERENCES school_class (org_id, id),
  FOREIGN KEY (org_id, sibling_of_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, created_by_person_id) REFERENCES person (org_id, id),
  CHECK (state NOT IN ('lost', 'withdrawn', 'rejected') OR closed_reason IS NOT NULL),
  CHECK ((state = 'enrolled') = (student_person_id IS NOT NULL)),
  CHECK (age_override_reason IS NULL OR age_order_ref IS NOT NULL)
);
CREATE INDEX school_application_pipeline_idx ON school_application (org_id, institution_id, year_label, state);
CREATE INDEX school_application_phone_idx ON school_application (org_id, guardian_phone);

-- Append-only: every move through the pipeline, with who and why.
CREATE TABLE school_application_event (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  application_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  reason text,
  actor_person_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, application_id) REFERENCES school_application (org_id, id)
);
CREATE INDEX school_application_event_idx ON school_application_event (org_id, application_id, at);

-- Admission numbers and certificate numbers: per institution, by kind and year, never reused.
CREATE TABLE school_number_counter (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('admission', 'tc', 'bonafide', 'fee_paid')),
  year_label text NOT NULL CHECK (year_label ~ '^\d{4}-\d{2}$'),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  PRIMARY KEY (org_id, institution_id, kind, year_label),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

CREATE TABLE school_certificate_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tc', 'bonafide', 'fee_paid')),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN (
    'requested', 'clearance_pending', 'ready_for_review', 'approved', 'issued', 'delivered', 'cancelled', 'superseded'
  )),
  purpose text,
  leaving_date date,
  leaving_reason text,
  -- The draft as checked and approved: label and value pairs, exactly what will be printed.
  fields jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  due_by date,
  requested_by_person_id uuid NOT NULL,
  checked_by_person_id uuid,
  checked_at timestamptz,
  approved_by_person_id uuid,
  approved_at timestamptz,
  number text,
  issued_document_id uuid,
  issued_at timestamptz,
  external_number text,
  portal_export_done_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, issued_document_id) REFERENCES issued_document (org_id, id),
  CHECK (kind <> 'tc' OR state IN ('requested', 'cancelled') OR leaving_date IS NOT NULL),
  CHECK (state NOT IN ('issued', 'delivered') OR number IS NOT NULL),
  CHECK (state <> 'cancelled' OR cancelled_reason IS NOT NULL),
  -- The person who checks a TC is not the one who approves it.
  CHECK (approved_by_person_id IS NULL OR approved_by_person_id IS DISTINCT FROM checked_by_person_id)
);
CREATE INDEX school_certificate_request_idx ON school_certificate_request (org_id, institution_id, state);
-- One open TC per student.
CREATE UNIQUE INDEX school_certificate_one_open_tc ON school_certificate_request (org_id, student_person_id)
  WHERE kind = 'tc' AND state NOT IN ('cancelled', 'superseded');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_admission_seat', 'school_application', 'school_application_event',
    'school_number_counter', 'school_certificate_request'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON school_admission_seat, school_application, school_number_counter,
  school_certificate_request TO cv_app;
GRANT SELECT, INSERT ON school_application_event TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON school_application_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- New permissions for each school's copy of the role templates (also in SCHOOL_ROLES).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, g.permission
FROM role r JOIN (VALUES
  ('school_admin', 'school.admission.manage'), ('school_admin', 'school.admission.offer'),
  ('school_admin', 'school.admission.enrol'), ('school_admin', 'school.certificate.request'),
  ('school_admin', 'school.certificate.check'), ('school_admin', 'school.certificate.approve'),
  ('school_admin', 'school.certificate.issue'),
  ('principal', 'school.admission.manage'), ('principal', 'school.admission.offer'),
  ('principal', 'school.admission.enrol'), ('principal', 'school.certificate.request'),
  ('principal', 'school.certificate.check'), ('principal', 'school.certificate.approve'),
  ('principal', 'school.certificate.issue'),
  ('office', 'school.admission.manage'), ('office', 'school.admission.enrol'),
  ('office', 'school.certificate.request'), ('office', 'school.certificate.issue'),
  ('teacher', 'school.certificate.check')
) AS g (role_key, permission) ON g.role_key = r.key
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
