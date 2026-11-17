-- Milestone 18, step 4 (docs/specs/TRANSPORT.md): the driver shares the bus's position while a
-- trip runs, and anyone on the bus can raise an SOS. Positions are kept 30 days (decision 3).

CREATE TABLE transport_position (
  org_id uuid NOT NULL REFERENCES organisation (id),
  trip_id uuid NOT NULL,
  at timestamptz NOT NULL,
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  speed_kmh numeric(5, 1) CHECK (speed_kmh >= 0),
  accuracy_m integer CHECK (accuracy_m >= 0),
  -- One point per moment: a resent batch adds nothing.
  PRIMARY KEY (org_id, trip_id, at),
  FOREIGN KEY (org_id, trip_id) REFERENCES transport_trip (org_id, id)
);
CREATE INDEX transport_position_at_idx ON transport_position (org_id, at);

ALTER TABLE transport_position ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_position FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_position USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());
-- DELETE only for the 30-day retention.
GRANT SELECT, INSERT, DELETE ON transport_position TO cv_app;

ALTER TABLE transport_trip
  ADD COLUMN driver_person_id uuid,
  ADD COLUMN sos_at timestamptz,
  ADD COLUMN sos_by_person_id uuid,
  ADD COLUMN sos_note text CHECK (length(sos_note) <= 500),
  ADD CONSTRAINT transport_trip_driver_fk FOREIGN KEY (org_id, driver_person_id)
    REFERENCES person (org_id, id),
  ADD CONSTRAINT transport_trip_sos_fk FOREIGN KEY (org_id, sos_by_person_id)
    REFERENCES person (org_id, id);

------------------------------------------------------------------------------------------
-- Permission (also in SCHOOL_ROLES and the access catalogue) and the Driver role
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'transport.trip.drive' FROM role r WHERE r.key = 'owner'
ON CONFLICT DO NOTHING;

INSERT INTO role (org_id, key, name)
SELECT org_id, 'driver', 'Driver' FROM role WHERE key = 'owner'
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission, relation)
SELECT r.org_id, r.id, g.permission, g.relation FROM role r
CROSS JOIN (VALUES ('transport.trip.drive', NULL), ('people.profile.update_own', 'self'),
  ('staff.attendance.check_in', 'self')) AS g (permission, relation)
WHERE r.key = 'driver'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
