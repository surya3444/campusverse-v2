-- Academics › Attendance for colleges and universities (rule book §13.2: "period-wise (college)";
-- "Shortage & Condonation: threshold from rule pack, alerts, condonation approval, feeds exam
-- eligibility"). A teacher takes a session (a period of a course for a section on a date) and
-- marks each student; percentages are per student per course for the term; a student below the
-- minimum but within the condonable band can be condoned through the workflow engine.
-- Owned by academics/attendance. Schools keep school/attendance (day-wise).

CREATE TABLE course_attendance_session (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL CHECK (term_number BETWEEN 1 AND 16),
  section_id uuid NOT NULL,
  course_id uuid NOT NULL,
  on_date date NOT NULL,
  period smallint NOT NULL CHECK (period BETWEEN 1 AND 12),
  taken_by_person_id uuid NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, section_id, on_date, period),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, batch_id, section_id) REFERENCES academic_section (org_id, batch_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id),
  FOREIGN KEY (org_id, taken_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX course_attendance_session_course_idx
  ON course_attendance_session (org_id, batch_id, term_number, course_id);

CREATE TABLE course_attendance_mark (
  org_id uuid NOT NULL REFERENCES organisation (id),
  session_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  -- On duty (sports, an event for the college) counts as present.
  status text NOT NULL CHECK (status IN ('present', 'absent', 'on_duty')),
  PRIMARY KEY (org_id, session_id, student_person_id),
  FOREIGN KEY (org_id, session_id) REFERENCES course_attendance_session (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id)
);

-- A shortage condoned (or refused) for a student's course in a term, through the workflow engine.
CREATE TABLE course_attendance_condonation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL,
  course_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  -- The percentage when asked, in basis points, and why.
  basis_points integer NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'granted', 'refused')),
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decision_note text,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  CHECK ((state = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX course_attendance_condonation_live_idx
  ON course_attendance_condonation (org_id, batch_id, term_number, course_id, student_person_id)
  WHERE state <> 'refused';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['course_attendance_session', 'course_attendance_mark', 'course_attendance_condonation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON course_attendance_session TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_attendance_mark TO cv_app;
GRANT SELECT, INSERT, UPDATE ON course_attendance_condonation TO cv_app;

-- Permissions (also in SCHOOL_ROLES and the access catalogue).
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('academics.attendance.mark'), ('academics.attendance.read'), ('academics.attendance.condone'))
  AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.attendance.mark' FROM role r WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.attendance.read' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
