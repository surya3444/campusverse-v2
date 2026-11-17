-- Staff leave, step 1 (docs/specs/STAFF_LEAVE.md): staff leave types, requests, balance
-- adjustments, and which register days an approved leave wrote. Owned by shared/staff-attendance.

CREATE TABLE staff_leave_type (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  paid boolean NOT NULL,
  -- Null: no limit (loss of pay).
  days_per_year numeric(5, 1) CHECK (days_per_year >= 0 AND days_per_year <= 366),
  carry_forward_max numeric(5, 1) NOT NULL DEFAULT 0 CHECK (carry_forward_max >= 0),
  half_day boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  -- The first leave year (April to March, named by its start): nothing carries in from before.
  since_year integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX staff_leave_type_code ON staff_leave_type (org_id, code);

CREATE TABLE staff_leave_request (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  institution_id uuid NOT NULL,
  type_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  days numeric(5, 1) NOT NULL CHECK (days > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by_person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by_person_id uuid,
  decided_at timestamptz,
  note text CHECK (length(note) <= 300),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, institution_id) REFERENCES institution (org_id, id),
  FOREIGN KEY (org_id, type_id) REFERENCES staff_leave_type (org_id, id),
  FOREIGN KEY (org_id, requested_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, decided_by_person_id) REFERENCES person (org_id, id),
  CHECK (to_date >= from_date),
  CHECK (NOT half_day OR from_date = to_date),
  -- Within one leave year (April to March).
  CHECK (date_trunc('year', from_date - interval '3 months') = date_trunc('year', to_date - interval '3 months')),
  -- Nobody decides their own leave.
  CHECK (decided_by_person_id IS NULL OR decided_by_person_id <> person_id),
  CHECK (state IN ('pending', 'cancelled') OR decided_by_person_id IS NOT NULL)
);
CREATE INDEX staff_leave_request_person_idx ON staff_leave_request (org_id, person_id, from_date);
CREATE INDEX staff_leave_request_institution_idx ON staff_leave_request (org_id, institution_id, state, from_date);

CREATE TABLE staff_leave_adjustment (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  person_id uuid NOT NULL,
  type_id uuid NOT NULL,
  leave_year integer NOT NULL,
  days numeric(5, 1) NOT NULL CHECK (days <> 0 AND abs(days) <= 366),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  by_person_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, type_id) REFERENCES staff_leave_type (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX staff_leave_adjustment_person_idx ON staff_leave_adjustment (org_id, person_id, type_id);

ALTER TABLE staff_attendance_day ADD COLUMN leave_request_id uuid;
ALTER TABLE staff_attendance_day ADD CONSTRAINT staff_attendance_day_leave_fk
  FOREIGN KEY (org_id, leave_request_id) REFERENCES staff_leave_request (org_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_leave_type', 'staff_leave_request', 'staff_leave_adjustment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON staff_leave_type, staff_leave_request TO cv_app;
GRANT SELECT, INSERT ON staff_leave_adjustment TO cv_app;
-- An approved leave cancelled before it starts takes its register days back.
GRANT DELETE ON staff_attendance_day TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON staff_leave_adjustment
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- The starting leave types for every existing organisation (new ones get them at sign-up).
INSERT INTO staff_leave_type (org_id, code, name, paid, days_per_year, carry_forward_max, since_year)
SELECT o.id, t.code, t.name, t.paid, t.days, t.carry,
  extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '3 months')::int
FROM organisation o
CROSS JOIN (VALUES ('CL', 'Casual leave', true, 12, 0), ('SL', 'Sick leave', true, 12, 30),
  ('EL', 'Earned leave', true, 15, 45), ('LOP', 'Loss of pay', false, NULL, 0))
  AS t (code, name, paid, days, carry)
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, 'staff.leave.apply', 'self' FROM role r WHERE r.key <> 'parent'
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('staff.leave.manage'), ('staff.leave.approve')) AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'staff.leave.manage' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
