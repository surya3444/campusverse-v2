-- Academics › Course Registration (rule book §13.2, §16.6 step 2, P0 item 13): a registration
-- window per batch term with credit limits and elective seat caps; each student's courses for
-- that term, approved by an advisor. A window belongs to one term number of one batch, so only
-- that term's courses can ever be offered (the wrong-parity defect, §4). Owned by
-- academics/registration.

CREATE TABLE registration_window (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  batch_id uuid NOT NULL,
  term_number smallint NOT NULL CHECK (term_number BETWEEN 1 AND 16),
  opens_on date NOT NULL,
  closes_on date NOT NULL,
  min_credits numeric(4, 1) NOT NULL CHECK (min_credits >= 0),
  max_credits numeric(4, 1) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, batch_id, term_number),
  FOREIGN KEY (org_id, batch_id) REFERENCES academic_batch (org_id, id),
  CHECK (closes_on >= opens_on),
  CHECK (max_credits >= min_credits AND max_credits <= 60)
);

-- Seats in an elective for this window; no row means no cap.
CREATE TABLE registration_cap (
  org_id uuid NOT NULL REFERENCES organisation (id),
  window_id uuid NOT NULL,
  course_id uuid NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 5000),
  PRIMARY KEY (org_id, window_id, course_id),
  FOREIGN KEY (org_id, window_id) REFERENCES registration_window (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id)
);

CREATE TABLE course_registration (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  window_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('submitted', 'approved', 'returned')),
  credits numeric(4, 1) NOT NULL CHECK (credits >= 0),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_person_id uuid,
  decided_at timestamptz,
  decided_by_person_id uuid,
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, window_id, student_person_id),
  FOREIGN KEY (org_id, window_id) REFERENCES registration_window (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, submitted_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK ((status = 'submitted') = (decided_at IS NULL)),
  CHECK (status <> 'returned' OR note IS NOT NULL)
);

-- The courses on a registration, with credits as the regulation gave them.
CREATE TABLE course_registration_item (
  org_id uuid NOT NULL REFERENCES organisation (id),
  registration_id uuid NOT NULL,
  course_id uuid NOT NULL,
  credits numeric(4, 1) NOT NULL CHECK (credits >= 0),
  elective boolean NOT NULL,
  PRIMARY KEY (org_id, registration_id, course_id),
  FOREIGN KEY (org_id, registration_id) REFERENCES course_registration (org_id, id),
  FOREIGN KEY (org_id, course_id) REFERENCES academic_course (org_id, id)
);
CREATE INDEX course_registration_item_course_idx ON course_registration_item (org_id, course_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['registration_window', 'registration_cap', 'course_registration',
    'course_registration_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON registration_window, course_registration TO cv_app;
-- Caps and a registration's courses are replaced as a whole when they change.
GRANT SELECT, INSERT, UPDATE, DELETE ON registration_cap, course_registration_item TO cv_app;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue). The office registers students
-- from their forms; approval is for the principal and administrators until advisors are assigned.
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('academics.registration.manage'), ('academics.registration.approve')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'academics.registration.manage' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
