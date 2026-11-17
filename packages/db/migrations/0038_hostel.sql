-- Hostel, step 1 (docs/specs/HOSTEL.md). Owned by shared/hostel.

CREATE TABLE hostel (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('boys', 'girls', 'mixed')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id)
);
CREATE UNIQUE INDEX hostel_name ON hostel (org_id, institution_id, lower(btrim(name)));

CREATE TABLE hostel_room (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  hostel_id uuid NOT NULL,
  number text NOT NULL CHECK (length(btrim(number)) BETWEEN 1 AND 20),
  floor text NOT NULL DEFAULT '' CHECK (length(floor) <= 20),
  beds smallint NOT NULL CHECK (beds BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, hostel_id) REFERENCES hostel (org_id, id)
);
CREATE UNIQUE INDEX hostel_room_number ON hostel_room (org_id, hostel_id, upper(btrim(number)));

CREATE TABLE hostel_allocation (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  hostel_id uuid NOT NULL,
  room_id uuid NOT NULL,
  bed_no smallint NOT NULL CHECK (bed_no BETWEEN 1 AND 20),
  student_person_id uuid NOT NULL,
  valid_during daterange NOT NULL,
  allocated_by_person_id uuid NOT NULL,
  ended_reason text CHECK (length(ended_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, hostel_id) REFERENCES hostel (org_id, id),
  FOREIGN KEY (org_id, room_id) REFERENCES hostel_room (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, allocated_by_person_id) REFERENCES person (org_id, id),
  CHECK (NOT isempty(valid_during) AND lower(valid_during) IS NOT NULL),
  -- One bed per student, one student per bed, at any time.
  EXCLUDE USING gist (org_id WITH =, student_person_id WITH =, valid_during WITH &&),
  EXCLUDE USING gist (org_id WITH =, room_id WITH =, bed_no WITH =, valid_during WITH &&)
);
CREATE INDEX hostel_allocation_hostel_idx ON hostel_allocation (org_id, hostel_id);

CREATE TABLE hostel_roll_call (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  hostel_id uuid NOT NULL,
  on_date date NOT NULL,
  session text NOT NULL CHECK (session IN ('night', 'morning')),
  taken_by_person_id uuid NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, hostel_id, on_date, session),
  FOREIGN KEY (org_id, hostel_id) REFERENCES hostel (org_id, id),
  FOREIGN KEY (org_id, taken_by_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE hostel_roll_mark (
  org_id uuid NOT NULL REFERENCES organisation (id),
  roll_call_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'on_leave')),
  PRIMARY KEY (org_id, roll_call_id, student_person_id),
  FOREIGN KEY (org_id, roll_call_id) REFERENCES hostel_roll_call (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id)
);

CREATE TABLE hostel_outpass (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  hostel_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  leaves_on date NOT NULL,
  back_by date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  collector_guardian_id uuid,
  collector_name text NOT NULL CHECK (length(btrim(collector_name)) BETWEEN 1 AND 200),
  collector_relation text NOT NULL CHECK (length(btrim(collector_relation)) BETWEEN 1 AND 50),
  collector_phone text CHECK (collector_phone ~ '^\+91[6-9][0-9]{9}$'),
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'rejected', 'out', 'returned', 'cancelled')),
  requested_by_person_id uuid NOT NULL,
  decided_by_person_id uuid,
  decided_at timestamptz,
  decision_note text CHECK (length(decision_note) <= 300),
  left_at timestamptz,
  left_by_person_id uuid,
  returned_at timestamptz,
  returned_by_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, hostel_id) REFERENCES hostel (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, collector_guardian_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, left_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, returned_by_person_id) REFERENCES person (org_id, id),
  CHECK (back_by >= leaves_on),
  CHECK (collector_guardian_id IS NOT NULL OR collector_phone IS NOT NULL),
  CHECK ((decided_by_person_id IS NULL) = (decided_at IS NULL)),
  CHECK (state NOT IN ('approved', 'rejected', 'out', 'returned') OR decided_by_person_id IS NOT NULL),
  CHECK (state <> 'rejected' OR length(btrim(decision_note)) >= 3),
  CHECK ((left_at IS NULL) = (left_by_person_id IS NULL)),
  CHECK ((returned_at IS NULL) = (returned_by_person_id IS NULL)),
  CHECK (state NOT IN ('out', 'returned') OR left_at IS NOT NULL),
  CHECK ((state = 'returned') = (returned_at IS NOT NULL))
);
CREATE INDEX hostel_outpass_state_idx ON hostel_outpass (org_id, hostel_id, state);
CREATE INDEX hostel_outpass_student_idx ON hostel_outpass (org_id, student_person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hostel', 'hostel_room', 'hostel_allocation', 'hostel_roll_call', 'hostel_roll_mark',
    'hostel_outpass'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON hostel, hostel_room, hostel_allocation, hostel_roll_call, hostel_outpass TO cv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hostel_roll_mark TO cv_app;

-- Hostel messages for guardians: push first, WhatsApp if push doesn't arrive.
ALTER TABLE notification_message DROP CONSTRAINT notification_message_kind_check;
ALTER TABLE notification_message ADD CONSTRAINT notification_message_kind_check CHECK (kind IN (
  'urgent', 'absence', 'fee_receipt', 'fee_reminder', 'circular', 'homework', 'notice', 'account',
  'transport', 'gate', 'hostel'
)) NOT VALID;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue) and the Hostel warden role
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('hostel.resident.read'), ('hostel.room.manage'), ('hostel.rollcall.mark'),
  ('hostel.outpass.decide')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'hostel.resident.read' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, p.permission, 'guardian' FROM role r
CROSS JOIN (VALUES ('hostel.resident.read'), ('hostel.outpass.request')) AS p (permission)
WHERE r.key = 'parent'
ON CONFLICT DO NOTHING;

INSERT INTO role (org_id, key, name)
SELECT org_id, 'warden', 'Hostel warden' FROM role WHERE key = 'owner'
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, g.relation FROM role r
CROSS JOIN (VALUES ('hostel.resident.read', NULL), ('hostel.room.manage', NULL), ('hostel.rollcall.mark', NULL),
  ('hostel.outpass.decide', NULL), ('people.profile.update_own', 'self'), ('staff.attendance.check_in', 'self'),
  ('staff.leave.apply', 'self')) AS g (permission, relation)
WHERE r.key = 'warden'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
