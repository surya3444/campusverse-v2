-- Milestone 18, step 3 (docs/specs/TRANSPORT.md): today's trips, the attendant's boarding marks
-- (append-only, accepted once by the device's event id) and the empty-bus check.

-- One trip per route per day, made when the attendant starts it. The empty-bus check is part of
-- ending it: a trip can't be ended without one.
CREATE TABLE transport_trip (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  route_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('pickup', 'drop')),
  trip_date date NOT NULL,
  vehicle_id uuid,
  started_by_person_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the vehicle's papers were not in order and the trip ran anyway (audited).
  override_reason text CHECK (length(override_reason) BETWEEN 3 AND 500),
  ended_by_person_id uuid,
  ended_at timestamptz,
  check_outcome text CHECK (check_outcome IN ('empty', 'child_found')),
  check_note text CHECK (length(check_note) <= 500),
  not_cleared_alerted_at timestamptz,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, route_id, trip_date),
  FOREIGN KEY (org_id, route_id, direction) REFERENCES transport_route (org_id, id, direction),
  FOREIGN KEY (org_id, vehicle_id) REFERENCES transport_vehicle (org_id, id),
  FOREIGN KEY (org_id, started_by_person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, ended_by_person_id) REFERENCES person (org_id, id),
  -- Ended means checked: who, when and what they found, all together.
  CHECK ((ended_at IS NULL) = (check_outcome IS NULL)
    AND (ended_at IS NULL) = (ended_by_person_id IS NULL))
);

-- Each tap of the attendant. The id is the device's event id, so a resend is a no-op.
CREATE TABLE transport_boarding_event (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL,
  trip_id uuid NOT NULL,
  person_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('boarded', 'not_boarded', 'dropped', 'nobody_at_stop',
    'handed_to_school')),
  stop_id uuid,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  by_person_id uuid NOT NULL,
  device_id text NOT NULL CHECK (length(device_id) <= 100),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, trip_id) REFERENCES transport_trip (org_id, id),
  FOREIGN KEY (org_id, person_id) REFERENCES person (org_id, id),
  FOREIGN KEY (org_id, stop_id) REFERENCES transport_stop (org_id, id),
  FOREIGN KEY (org_id, by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX transport_boarding_event_trip_idx ON transport_boarding_event (org_id, trip_id, person_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transport_trip', 'transport_boarding_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON transport_trip TO cv_app;
GRANT SELECT, INSERT ON transport_boarding_event TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON transport_boarding_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Bus alerts for guardians: push first, WhatsApp if push doesn't arrive.
ALTER TABLE notification_message DROP CONSTRAINT notification_message_kind_check;
ALTER TABLE notification_message ADD CONSTRAINT notification_message_kind_check CHECK (kind IN (
  'urgent', 'absence', 'fee_receipt', 'fee_reminder', 'circular', 'homework', 'notice', 'account',
  'transport'
)) NOT VALID;

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue) and the Bus attendant role
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'transport.trip.attend' FROM role r
WHERE r.key IN ('owner', 'school_admin', 'principal', 'office')
ON CONFLICT DO NOTHING;

INSERT INTO role (org_id, key, name)
SELECT org_id, 'bus_attendant', 'Bus attendant' FROM role WHERE key = 'owner'
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, g.relation FROM role r
CROSS JOIN (VALUES ('transport.trip.read', NULL), ('transport.trip.attend', NULL),
  ('people.profile.update_own', 'self'), ('staff.attendance.check_in', 'self'))
  AS g (permission, relation)
WHERE r.key = 'bus_attendant'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
