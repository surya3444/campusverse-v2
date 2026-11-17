-- Milestone 18, step 1 (docs/specs/TRANSPORT.md): vehicles with their documents, stops, and
-- routes with stops in order (shared/transport). Riders, trips and the apps come in later steps.

CREATE TABLE transport_vehicle (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  campus_id uuid NOT NULL,
  -- Stored without spaces, upper case: AP09AB1234.
  registration text NOT NULL CHECK (registration ~ '^[A-Z0-9]{4,12}$'),
  kind text NOT NULL CHECK (kind IN ('bus', 'van', 'auto')),
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 120),
  owned_by text NOT NULL DEFAULT 'school' CHECK (owned_by IN ('school', 'contractor')),
  contractor_name text CHECK (length(contractor_name) <= 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus (org_id, id),
  UNIQUE (org_id, registration),
  CHECK (owned_by = 'contractor' OR contractor_name IS NULL)
);

-- Every document as recorded; a renewal is a new row. The one valid longest counts.
CREATE TABLE transport_vehicle_document (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  vehicle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('registration', 'fitness', 'insurance', 'permit', 'pollution')),
  number text CHECK (length(number) <= 60),
  valid_until date NOT NULL,
  file_id uuid,
  recorded_by_person_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, vehicle_id) REFERENCES transport_vehicle (org_id, id),
  FOREIGN KEY (org_id, file_id) REFERENCES stored_file (org_id, id),
  FOREIGN KEY (org_id, recorded_by_person_id) REFERENCES person (org_id, id)
);
CREATE INDEX transport_vehicle_document_idx ON transport_vehicle_document (org_id, vehicle_id, kind);

CREATE TABLE transport_stop (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  campus_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
  landmark text CHECK (length(landmark) <= 120),
  latitude numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  -- Fees by distance: a fee plan will apply to a zone's riders (step 2).
  fare_zone integer CHECK (fare_zone BETWEEN 1 AND 20),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus (org_id, id),
  UNIQUE (org_id, campus_id, name),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE transport_route (
  org_id uuid NOT NULL REFERENCES organisation (id),
  id uuid NOT NULL DEFAULT uuidv7(),
  campus_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
  direction text NOT NULL CHECK (direction IN ('pickup', 'drop')),
  vehicle_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, campus_id) REFERENCES campus (org_id, id),
  FOREIGN KEY (org_id, vehicle_id) REFERENCES transport_vehicle (org_id, id),
  UNIQUE (org_id, campus_id, name, direction)
);

CREATE TABLE transport_route_stop (
  org_id uuid NOT NULL REFERENCES organisation (id),
  route_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 200),
  stop_id uuid NOT NULL,
  planned_at time NOT NULL,
  PRIMARY KEY (org_id, route_id, seq),
  FOREIGN KEY (org_id, route_id) REFERENCES transport_route (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, stop_id) REFERENCES transport_stop (org_id, id),
  UNIQUE (org_id, route_id, stop_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transport_vehicle', 'transport_vehicle_document', 'transport_stop',
    'transport_route', 'transport_route_stop'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = app_current_org()) '
      'WITH CHECK (org_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON transport_vehicle, transport_stop, transport_route TO cv_app;
-- Stops on a route are replaced as a whole when the route is saved.
GRANT SELECT, INSERT, DELETE ON transport_route_stop TO cv_app;
GRANT SELECT, INSERT ON transport_vehicle_document TO cv_app;
CREATE TRIGGER append_only BEFORE UPDATE ON transport_vehicle_document
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

------------------------------------------------------------------------------------------
-- Permissions (also in SCHOOL_ROLES and the access catalogue)
------------------------------------------------------------------------------------------
INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, p.permission FROM role r
CROSS JOIN (VALUES ('transport.trip.read'), ('transport.route.manage'), ('transport.vehicle.manage'))
  AS p (permission)
WHERE r.key IN ('owner', 'school_admin', 'principal')
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (org_id, role_id, permission)
SELECT r.org_id, r.id, 'transport.trip.read' FROM role r WHERE r.key = 'office'
ON CONFLICT DO NOTHING;

UPDATE organisation SET permission_version = permission_version + 1;
