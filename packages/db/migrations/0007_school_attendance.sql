-- School attendance: device events (accepted once each), the day read model, sessions,
-- conflicts for review, leave, holidays, substitutes, shortage notices and condonation.

CREATE TABLE school_attendance_settings (
  org_id uuid NOT NULL REFERENCES organisation (id),
  institution_id uuid NOT NULL,
  -- Parents of absentees are told this long after submission, so a late arrival can be fixed first.
  alert_delay_minutes integer NOT NULL DEFAULT 30 CHECK (alert_delay_minutes BETWEEN 0 AND 480),
  sign_off_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, institution_id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);

CREATE TABLE school_holiday (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  on_date date NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  declared_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, declared_by_person_id) REFERENCES person (org_id, id),
  UNIQUE (org_id, institution_id, on_date)
);

-- Append-only. event_id is made on the device, so a resent event is recognised and accepted once.
CREATE TABLE school_attendance_event (
  org_id uuid NOT NULL REFERENCES organisation (id),
  event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('submit', 'correction', 'holiday', 'conflict_resolution')),
  section_id uuid NOT NULL,
  on_date date NOT NULL,
  actor_person_id uuid NOT NULL,
  device_id text CHECK (length(device_id) <= 100),
  -- Only the students not marked present: [{ "personId": ..., "status": ... }].
  marks jsonb NOT NULL DEFAULT '[]',
  reason text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, event_id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, actor_person_id) REFERENCES person (org_id, id),
  CHECK (kind NOT IN ('correction', 'conflict_resolution') OR reason IS NOT NULL)
);
CREATE INDEX school_attendance_event_section_idx ON school_attendance_event (org_id, section_id, on_date);

CREATE TABLE school_attendance_session (
  org_id uuid NOT NULL REFERENCES organisation (id),
  section_id uuid NOT NULL,
  on_date date NOT NULL,
  first_event_id uuid NOT NULL,
  submitted_by_person_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  signed_off_by_person_id uuid,
  signed_off_at timestamptz,
  PRIMARY KEY (org_id, section_id, on_date),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, first_event_id) REFERENCES school_attendance_event (org_id, event_id),
  FOREIGN KEY (org_id, submitted_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, signed_off_by_person_id) REFERENCES person (org_id, id)
);

-- Read model: each student's state for the day, derived from the events.
CREATE TABLE school_attendance_day (
  org_id uuid NOT NULL REFERENCES organisation (id),
  person_id uuid NOT NULL,
  on_date date NOT NULL,
  section_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'present', 'absent', 'late', 'half_day', 'approved_leave', 'medical_leave', 'school_duty', 'holiday'
  )),
  source_event_id uuid NOT NULL,
  absence_alerted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, person_id, on_date),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, source_event_id) REFERENCES school_attendance_event (org_id, event_id)
);
CREATE INDEX school_attendance_day_section_idx ON school_attendance_day (org_id, section_id, on_date);

-- A later submission that disagrees is kept for review, never applied silently.
CREATE TABLE school_attendance_conflict (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  section_id uuid NOT NULL,
  on_date date NOT NULL,
  person_id uuid NOT NULL,
  current_status text NOT NULL,
  incoming_status text NOT NULL,
  incoming_event_id uuid NOT NULL,
  resolution text CHECK (resolution IN ('kept', 'applied')),
  resolved_by_person_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, incoming_event_id) REFERENCES school_attendance_event (org_id, event_id),
  FOREIGN KEY (org_id, resolved_by_person_id) REFERENCES person (org_id, id),
  CHECK ((resolution IS NULL) = (resolved_at IS NULL))
);
CREATE INDEX school_attendance_conflict_open_idx ON school_attendance_conflict (org_id, on_date)
  WHERE resolution IS NULL;

CREATE TABLE school_leave_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  requested_by_person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('leave', 'medical')),
  valid_during daterange NOT NULL CHECK (NOT lower_inf(valid_during) AND NOT upper_inf(valid_during)),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by_person_id uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK (status <> 'rejected' OR note IS NOT NULL)
);
CREATE INDEX school_leave_request_student_idx ON school_leave_request (org_id, student_person_id);

-- Temporary permission to mark one section on one day.
CREATE TABLE school_attendance_substitute (
  org_id uuid NOT NULL REFERENCES organisation (id),
  section_id uuid NOT NULL,
  on_date date NOT NULL,
  person_id uuid NOT NULL,
  granted_by_person_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, section_id, on_date, person_id),
  FOREIGN KEY (org_id, section_id) REFERENCES school_section (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, granted_by_person_id) REFERENCES person (org_id, id)
);

-- Shortage warnings keep the messages that carried them: their delivery status is the proof.
CREATE TABLE school_attendance_notice (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  year_id uuid NOT NULL,
  percent numeric(5, 2) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  message_ids uuid[] NOT NULL,
  sent_by_person_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, sent_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX school_attendance_notice_student_idx ON school_attendance_notice (org_id, student_person_id);

CREATE TABLE school_condonation_case (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  student_person_id uuid NOT NULL,
  year_id uuid NOT NULL,
  percent numeric(5, 2) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  file_ids uuid[] NOT NULL DEFAULT '{}',
  deadline date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'granted', 'refused')),
  opened_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, year_id) REFERENCES school_year (org_id, id),
  FOREIGN KEY (org_id, opened_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK ((status = 'open') = (decided_at IS NULL)),
  CHECK (status = 'open' OR note IS NOT NULL)
);
CREATE UNIQUE INDEX school_condonation_case_one_open ON school_condonation_case (org_id, student_person_id, year_id)
  WHERE status = 'open';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_attendance_settings', 'school_holiday', 'school_attendance_event',
    'school_attendance_session', 'school_attendance_day', 'school_attendance_conflict', 'school_leave_request',
    'school_attendance_substitute', 'school_attendance_notice', 'school_condonation_case'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON school_attendance_event, school_attendance_notice, school_holiday TO cv_app;
GRANT SELECT, INSERT, UPDATE ON school_attendance_settings, school_attendance_session, school_attendance_day,
  school_attendance_conflict, school_leave_request, school_condonation_case TO cv_app;
GRANT SELECT, INSERT, DELETE ON school_attendance_substitute TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON school_attendance_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON school_attendance_notice
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON school_attendance_event
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- New permissions for each school's copy of the role templates (also in SCHOOL_ROLES).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, g.permission
FROM role r JOIN (VALUES
  ('school_admin', 'school.attendance.mark'), ('school_admin', 'school.attendance.read'),
  ('school_admin', 'school.attendance.manage'), ('school_admin', 'school.attendance.sign_off'),
  ('school_admin', 'school.attendance.leave_decide'),
  ('principal', 'school.attendance.mark'), ('principal', 'school.attendance.read'),
  ('principal', 'school.attendance.manage'), ('principal', 'school.attendance.sign_off'),
  ('principal', 'school.attendance.leave_decide'),
  ('teacher', 'school.attendance.mark'), ('teacher', 'school.attendance.leave_decide'),
  ('office', 'school.attendance.read'), ('office', 'school.attendance.leave_request')
) AS g (role_key, permission) ON g.role_key = r.key
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, 'guardian'
FROM role r CROSS JOIN (VALUES ('school.attendance.read'), ('school.attendance.leave_request')) AS g (permission)
WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
