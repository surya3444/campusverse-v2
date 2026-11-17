-- Milestone 20 (docs/specs/INSTITUTION_DEPTH.md): the full staff record, documents in folders
-- with versions (people/records), and staff attendance (shared/staff-attendance).

------------------------------------------------------------------------------------------
-- Staff record
------------------------------------------------------------------------------------------
ALTER TABLE staff_profile
  ADD COLUMN department text CHECK (department IS NULL OR length(department) <= 80),
  ADD COLUMN employment_type text
    CHECK (employment_type IN ('permanent', 'probation', 'contract', 'part_time', 'visiting')),
  ADD COLUMN qualifications text CHECK (qualifications IS NULL OR length(qualifications) <= 500),
  ADD COLUMN experience_months integer CHECK (experience_months BETWEEN 0 AND 720),
  ADD COLUMN gender text CHECK (gender IN ('female', 'male', 'other', 'not_stated')),
  ADD COLUMN emergency_name text CHECK (emergency_name IS NULL OR length(emergency_name) <= 120),
  ADD COLUMN emergency_phone text CHECK (emergency_phone ~ '^\+91[6-9][0-9]{9}$'),
  -- Sealed with packages/crypto; only the last four digits in clear (CLAUDE.md).
  ADD COLUMN aadhaar_sealed bytea,
  ADD COLUMN aadhaar_last4 text CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN bank_account_sealed bytea,
  ADD COLUMN bank_last4 text CHECK (bank_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN bank_ifsc text CHECK (bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ADD CONSTRAINT staff_aadhaar_pair CHECK ((aadhaar_sealed IS NULL) = (aadhaar_last4 IS NULL)),
  ADD CONSTRAINT staff_bank_pair CHECK ((bank_account_sealed IS NULL) = (bank_last4 IS NULL));

------------------------------------------------------------------------------------------
-- Documents in folders, with versions (people/records). A new upload of the same kind is a
-- new version; earlier versions stay, marked superseded.
------------------------------------------------------------------------------------------
CREATE TABLE record_document (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  folder text NOT NULL CHECK (folder IN (
    'identity', 'academic', 'qualifications', 'employment', 'payroll', 'medical', 'transfer', 'other')),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 120),
  file_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'verified', 'rejected', 'superseded')),
  note text CHECK (length(note) <= 300),
  expires_on date,
  uploaded_by_person_id uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  checked_by_person_id uuid,
  checked_at timestamptz,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id),
  FOREIGN KEY (org_id, uploaded_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, checked_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, person_id, kind, version),
  CHECK (status <> 'rejected' OR note IS NOT NULL),
  CHECK ((status IN ('verified', 'rejected')) <= (checked_by_person_id IS NOT NULL))
);
CREATE INDEX record_document_person_idx ON record_document (org_id, person_id, folder);

------------------------------------------------------------------------------------------
-- Staff attendance (shared/staff-attendance)
------------------------------------------------------------------------------------------
CREATE TABLE staff_attendance_settings (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  starts_at time NOT NULL DEFAULT '08:30',
  ends_at time NOT NULL DEFAULT '15:30',
  late_after_minutes integer NOT NULL DEFAULT 10 CHECK (late_after_minutes BETWEEN 0 AND 180),
  early_before_minutes integer NOT NULL DEFAULT 10 CHECK (early_before_minutes BETWEEN 0 AND 180),
  -- Less time than this between first in and last out is a half day.
  full_day_minutes integer NOT NULL DEFAULT 300 CHECK (full_day_minutes BETWEEN 60 AND 720),
  require_on_campus boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, institution_id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  CHECK (ends_at > starts_at)
);

-- Every check-in and check-out as it happened. Never changed: corrections go to the day.
CREATE TABLE staff_attendance_checkin (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL,
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('web', 'app')),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  accuracy_metres integer CHECK (accuracy_metres >= 0),
  distance_metres integer CHECK (distance_metres >= 0),
  on_campus boolean,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX staff_attendance_checkin_day_idx ON staff_attendance_checkin (org_id, institution_id, at);
CREATE INDEX staff_attendance_checkin_person_idx ON staff_attendance_checkin (org_id, person_id, at);

-- The day as it counts: from check-ins, or marked in the office register (which wins).
CREATE TABLE staff_attendance_day (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  on_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'on_leave', 'on_duty')),
  first_in timestamptz,
  last_out timestamptz,
  late boolean NOT NULL DEFAULT false,
  left_early boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('checkin', 'register')),
  marked_by_person_id uuid,
  reason text CHECK (length(reason) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, institution_id, on_date, person_id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, marked_by_person_id) REFERENCES person (org_id, id),
  CHECK (source <> 'register' OR marked_by_person_id IS NOT NULL)
);
CREATE INDEX staff_attendance_day_person_idx ON staff_attendance_day (org_id, person_id, on_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['record_document', 'staff_attendance_settings', 'staff_attendance_checkin',
    'staff_attendance_day'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON record_document, staff_attendance_settings, staff_attendance_day TO cv_app;
GRANT SELECT, INSERT ON staff_attendance_checkin TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON staff_attendance_checkin
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
-- Checking oneself in: a 'self' grant on every staff role.
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'staff.attendance.check_in', 'self' FROM role r WHERE r.key <> 'parent'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('staff.attendance.read'), ('staff.attendance.manage'), ('people.staff.documents'),
  ('people.staff.create')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('staff.attendance.read'), ('staff.attendance.manage')) AS p (permission)
WHERE r.key IN ('principal', 'office')
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
