-- Visitors and gate, step 1 (docs/specs/VISITORS_GATE.md). Owned by shared/gate.

-- One per phone across the organisation, so a bar holds on every campus.
CREATE TABLE gate_visitor (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  phone text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  barred_at timestamptz,
  barred_reason text CHECK (length(barred_reason) BETWEEN 3 AND 300),
  barred_by_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, phone),
  FOREIGN KEY (org_id, barred_by_person_id) REFERENCES person (org_id, id),
  CHECK ((barred_at IS NULL) = (barred_reason IS NULL) AND (barred_at IS NULL) = (barred_by_person_id IS NULL))
);

CREATE TABLE gate_visit (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  visitor_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('parent_meeting', 'staff_meeting', 'admission_enquiry', 'delivery',
    'vendor', 'interview', 'official', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  host_person_id uuid,
  party_size smallint NOT NULL DEFAULT 1 CHECK (party_size BETWEEN 1 AND 50),
  vehicle_no text NOT NULL DEFAULT '' CHECK (length(vehicle_no) <= 20),
  badge_no text NOT NULL DEFAULT '' CHECK (length(badge_no) <= 20),
  state text NOT NULL CHECK (state IN ('expected', 'in', 'out', 'cancelled')),
  expected_on date,
  expected_by_person_id uuid,
  in_at timestamptz,
  in_by_person_id uuid,
  out_at timestamptz,
  out_by_person_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, visitor_id) REFERENCES gate_visitor (org_id, id),
  FOREIGN KEY (org_id, host_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, expected_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, in_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, out_by_person_id) REFERENCES person (org_id, id),
  CHECK ((expected_on IS NULL) = (expected_by_person_id IS NULL)),
  CHECK (state <> 'expected' OR expected_on IS NOT NULL),
  CHECK ((in_at IS NULL) = (in_by_person_id IS NULL)),
  CHECK ((out_at IS NULL) = (out_by_person_id IS NULL)),
  CHECK (state NOT IN ('in', 'out') OR in_at IS NOT NULL),
  CHECK ((state = 'out') = (out_at IS NOT NULL)),
  CHECK (out_at IS NULL OR out_at >= in_at)
);
CREATE INDEX gate_visit_inside_idx ON gate_visit (org_id, institution_id) WHERE state = 'in';
CREATE INDEX gate_visit_expected_idx ON gate_visit (org_id, institution_id, expected_on) WHERE state = 'expected';
CREATE INDEX gate_visit_day_idx ON gate_visit (org_id, institution_id, in_at);
CREATE INDEX gate_visit_visitor_idx ON gate_visit (org_id, visitor_id);

CREATE TABLE gate_pass (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  institution_id uuid NOT NULL,
  student_person_id uuid NOT NULL,
  collector_guardian_id uuid,
  collector_name text NOT NULL CHECK (length(btrim(collector_name)) BETWEEN 1 AND 200),
  collector_relation text NOT NULL CHECK (length(btrim(collector_relation)) BETWEEN 1 AND 50),
  collector_phone text CHECK (collector_phone ~ '^\+91[6-9][0-9]{9}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  issued_on date NOT NULL,
  issued_by_person_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued', 'left', 'cancelled')),
  left_at timestamptz,
  left_by_person_id uuid,
  cancel_reason text CHECK (length(cancel_reason) BETWEEN 3 AND 300),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, student_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, collector_guardian_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, issued_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, left_by_person_id) REFERENCES person (org_id, id),
  -- Someone who isn't a guardian on record leaves a phone the school can call.
  CHECK (collector_guardian_id IS NOT NULL OR collector_phone IS NOT NULL),
  CHECK ((state = 'left') = (left_at IS NOT NULL) AND (left_at IS NULL) = (left_by_person_id IS NULL)),
  CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX gate_pass_day_idx ON gate_pass (org_id, institution_id, issued_on);
CREATE INDEX gate_pass_student_idx ON gate_pass (org_id, student_person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gate_visitor', 'gate_visit', 'gate_pass'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON gate_visitor, gate_visit, gate_pass TO cv_app;

-- Gate messages for guardians and hosts: push first, WhatsApp if push doesn't arrive.
ALTER TABLE notification_message DROP CONSTRAINT notification_message_kind_check;
ALTER TABLE notification_message ADD CONSTRAINT notification_message_kind_check CHECK (kind IN (
  'urgent', 'absence', 'fee_receipt', 'fee_reminder', 'circular', 'homework', 'notice', 'account',
  'transport', 'gate'
)) NOT VALID;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue) and the Security guard role
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('gate.visitor.read'), ('gate.visitor.manage'), ('gate.visit.expect'), ('gate.pass.issue'))
  AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'gate.visitor.bar' FROM role r WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'gate.visit.expect' FROM role r WHERE r.key = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO role (org_id, key, name)
SELECT org_id, 'security', 'Security guard' FROM role WHERE key = 'owner'
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, g.relation FROM role r
CROSS JOIN (VALUES ('gate.visitor.read', NULL), ('gate.visitor.manage', NULL),
  ('people.profile.update_own', 'self'), ('staff.attendance.check_in', 'self'), ('staff.leave.apply', 'self'))
  AS g (permission, relation)
WHERE r.key = 'security'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
