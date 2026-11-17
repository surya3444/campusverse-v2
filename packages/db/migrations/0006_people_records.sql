-- Student and staff records: profiles, name history, memberships per institution, documents.
-- Backfills existing schools; the migration role may bypass RLS for exactly this.

-- Names keep their history and where each version came from.
CREATE TABLE person_name (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  source text NOT NULL CHECK (source IN ('admission', 'import', 'correction', 'board', 'signup')),
  reason text,
  import_batch_id uuid,
  recorded_by_account_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  CHECK (source <> 'correction' OR reason IS NOT NULL)
);
CREATE INDEX person_name_person_idx ON person_name (org_id, person_id, recorded_at);

-- Sensitive identifiers are sealed (AES-256-GCM, see packages/crypto); only the last four show.
CREATE TABLE student_profile (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('applicant', 'active', 'on_leave', 'left', 'passed_out', 'alumni')),
  gender text CHECK (gender IN ('female', 'male', 'other', 'not_stated')),
  -- APAAR never blocks admission: present, refused with evidence, or not generated with a reason.
  apaar_status text NOT NULL DEFAULT 'not_generated' CHECK (apaar_status IN ('present', 'refused', 'not_generated')),
  apaar_note text,
  apaar_sealed bytea,
  apaar_last4 text CHECK (apaar_last4 ~ '^\d{4}$'),
  aadhaar_sealed bytea,
  aadhaar_last4 text CHECK (aadhaar_last4 ~ '^\d{4}$'),
  import_batch_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, person_id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  CHECK ((apaar_status = 'present') = (apaar_sealed IS NOT NULL)),
  CHECK ((apaar_sealed IS NULL) = (apaar_last4 IS NULL)),
  CHECK ((aadhaar_sealed IS NULL) = (aadhaar_last4 IS NULL))
);

ALTER TABLE staff_profile
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'onboarding', 'active', 'on_leave', 'notice', 'left')),
  ADD COLUMN designation text,
  ADD COLUMN joined_on date,
  ADD COLUMN left_on date,
  ADD COLUMN pan_sealed bytea,
  ADD COLUMN pan_last4 text CHECK (pan_last4 ~ '^[A-Z0-9]{4}$'),
  ADD CONSTRAINT staff_pan_pair CHECK ((pan_sealed IS NULL) = (pan_last4 IS NULL)),
  ADD CONSTRAINT staff_left_has_date CHECK ((status = 'left') = (left_on IS NOT NULL));

-- A person's place in an institution, as student or staff. Shared: no academic detail here;
-- each academic type answers "where exactly" through its placement contract.
CREATE TABLE institution_membership (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('student', 'staff')),
  valid_during daterange NOT NULL,
  import_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, import_batch_id) REFERENCES import_batch (org_id, id),
  EXCLUDE USING gist (org_id WITH =, person_id WITH =, institution_id WITH =, kind WITH =, valid_during WITH &&)
);
CREATE INDEX institution_membership_institution_idx ON institution_membership (org_id, institution_id, kind);

-- Document checklist per person: what is needed, and whether it is in and checked.
CREATE TABLE person_document (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  requirement text NOT NULL CHECK (requirement IN ('required', 'conditional', 'optional')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'verified', 'rejected')),
  file_id uuid,
  note text,
  checked_by_account_id uuid,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id),
  UNIQUE (org_id, person_id, kind),
  CHECK (status = 'pending' OR status = 'rejected' OR file_id IS NOT NULL),
  CHECK (status <> 'rejected' OR note IS NOT NULL)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['person_name', 'student_profile', 'institution_membership', 'person_document'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
  -- Import undo may remove what an import created, and nothing else.
  FOREACH t IN ARRAY ARRAY['person_name', 'student_profile', 'institution_membership'] LOOP
    EXECUTE format('CREATE POLICY delete_imported_only ON %I AS RESTRICTIVE FOR DELETE '
      'USING (import_batch_id IS NOT NULL)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON person_name TO cv_app;
GRANT SELECT, INSERT, UPDATE ON student_profile, institution_membership, person_document TO cv_app;
GRANT DELETE ON person_name, student_profile, institution_membership TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON person_name FOR EACH ROW EXECUTE FUNCTION forbid_change();

------------------------------------------------------------------------------------------
-- Backfill existing schools
------------------------------------------------------------------------------------------
INSERT INTO person_name (org_id, person_id, legal_name, source, import_batch_id, recorded_at)
SELECT org_id, id, legal_name, CASE WHEN import_batch_id IS NULL THEN 'signup' ELSE 'import' END,
  import_batch_id, created_at
FROM person;

INSERT INTO student_profile (org_id, person_id, import_batch_id)
SELECT DISTINCT ON (e.org_id, e.person_id) e.org_id, e.person_id, e.import_batch_id
FROM school_enrolment e ORDER BY e.org_id, e.person_id, e.created_at;

INSERT INTO institution_membership (org_id, person_id, institution_id, kind, valid_during, import_batch_id)
SELECT org_id, person_id, institution_id, 'student', range_merge(range_agg(valid_during)), min(import_batch_id::text)::uuid
FROM school_enrolment GROUP BY org_id, person_id, institution_id;

INSERT INTO institution_membership (org_id, person_id, institution_id, kind, valid_during, import_batch_id)
SELECT DISTINCT ON (ra.org_id, ra.person_id, ra.scope_id)
  ra.org_id, ra.person_id, ra.scope_id, 'staff', ra.valid_during, ra.import_batch_id
FROM role_assignment ra JOIN role r ON r.org_id = ra.org_id AND r.id = ra.role_id
WHERE ra.scope_type = 'institution' AND r.key IN ('principal', 'teacher', 'office')
ORDER BY ra.org_id, ra.person_id, ra.scope_id, ra.created_at;

-- New permissions for each school's copy of the role templates.
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, g.permission
FROM role r JOIN (VALUES
  ('school_admin', 'people.student.update'), ('school_admin', 'people.student.read_full'),
  ('school_admin', 'people.student.reveal'), ('school_admin', 'people.staff.read'),
  ('school_admin', 'people.staff.update'), ('school_admin', 'people.staff.exit'),
  ('school_admin', 'people.staff.reveal'), ('school_admin', 'school.enrolment.change'),
  ('principal', 'people.student.update'), ('principal', 'people.student.read_full'),
  ('principal', 'people.staff.read'), ('principal', 'school.enrolment.change'),
  ('office', 'people.student.update'), ('office', 'people.student.read_full'),
  ('office', 'people.student.reveal'), ('office', 'people.staff.read')
) AS g (role_key, permission) ON g.role_key = r.key
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'people.student.read_full', 'guardian' FROM role r WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

-- Cached permission snapshots are keyed by this version: make every school's cache stale now.
UPDATE organisation SET permission_version = permission_version + 1;
